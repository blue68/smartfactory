import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { authMiddleware } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();
router.use(authMiddleware);

// Ensure upload directory exists
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || '/app/uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
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
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx', '.xls', '.xlsx'];
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
      originalName: path.basename(req.file.originalname)
        .replace(/[\r\n\t]/g, '')
        .replace(/[<>"'&]/g, '')
        .slice(0, 255),
      size: req.file.size,
    },
    message: 'ok',
  });
}));

export default router;
