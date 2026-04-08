import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { authMiddleware } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();
router.use(authMiddleware);

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || '/app/uploads');

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

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    try {
      if (!fs.existsSync(UPLOAD_DIR)) {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      }
      cb(null, UPLOAD_DIR);
    } catch (error) {
      cb(error as Error, UPLOAD_DIR);
    }
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const hash = crypto.randomBytes(16).toString('hex');
    cb(null, `${Date.now()}-${hash}${ext}`);
  },
});

const upload = multer({
  storage,
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

router.post('/', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400).json({ code: 1001, data: null, message: '请选择要上传的文件' });
    return;
  }
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({
    code: 0,
    data: {
      url: fileUrl,
      originalName: normalizeUploadOriginalName(req.file.originalname),
      size: req.file.size,
    },
    message: 'ok',
  });
}));

export default router;
