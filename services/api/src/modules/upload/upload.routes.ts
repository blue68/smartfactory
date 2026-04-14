import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { authMiddleware } from '../../middleware/auth';
import { asyncHandler } from '../../app';
import { AppError } from '../../shared/AppError';
import { UploadService } from './upload.service';

const router = Router();
router.use(authMiddleware);

function sanitizeFileName(name: string): string {
  return path.basename(name)
    .replace(/[\r\n\t]/g, '')
    .replace(/[<>"'&]/g, '')
    .slice(0, 255);
}

function mojibakeScore(text: string): number {
  const garbledChars = text.match(/[ÃÂÅÆÇÐØÞæçðøþ]/g)?.length ?? 0;
  const replacementPenalty = text.includes('�') ? 3 : 0;
  return garbledChars + replacementPenalty;
}

function normalizeUploadOriginalName(rawName: string): string {
  const base = sanitizeFileName(rawName);
  if (!base) return 'file';

  // 已正确包含中文时直接返回，避免重复解码导致乱码。
  if (/[\u4e00-\u9fff]/u.test(base)) {
    return base;
  }

  // 兼容 multipart filename 被 latin1 读取导致的 UTF-8 乱码。
  const decoded = sanitizeFileName(Buffer.from(base, 'latin1').toString('utf8'));
  if (!decoded || decoded.includes('�')) {
    return base;
  }

  if (/[\u4e00-\u9fff]/u.test(decoded)) {
    return decoded;
  }

  return mojibakeScore(decoded) < mojibakeScore(base) ? decoded : base;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.doc', '.docx', '.xls', '.xlsx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的文件类型'));
    }
  },
});

router.get('/files/:id/content', asyncHandler(async (req, res) => {
  const fileId = Number(req.params.id);
  if (!Number.isInteger(fileId) || fileId <= 0) {
    throw AppError.badRequest('无效的文件 ID');
  }

  const svc = new UploadService(req.tenantId, req.userId);
  const file = await svc.getFileContent(fileId);
  const encodedFilename = encodeURIComponent(file.originalName);

  res.setHeader('Content-Type', file.mimeType ?? 'application/octet-stream');
  res.setHeader('Content-Length', String(file.buffer.length));
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader(
    'Content-Disposition',
    `${file.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodedFilename}`,
  );
  res.end(file.buffer);
}));

router.post('/', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400).json({ code: 1001, data: null, message: '请选择要上传的文件' });
    return;
  }
  const originalName = normalizeUploadOriginalName(req.file.originalname);
  const svc = new UploadService(req.tenantId, req.userId);
  const stored = await svc.saveUploadedFile(req.file, originalName);
  res.json({
    code: 0,
    data: {
      id: stored.id,
      url: stored.url,
      originalName: stored.originalName,
      size: stored.size,
      path: stored.path,
      storageDriver: stored.storageDriver,
    },
    message: 'ok',
  });
}));

export default router;
