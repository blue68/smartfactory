import crypto from 'crypto';
import fs from 'fs/promises';
import http from 'http';
import https from 'https';
import path from 'path';
import { URL } from 'url';
import { AppDataSource } from '../../config/database';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';

export type UploadStorageDriver = 'local' | 'oss';

type UploadedFileRow = {
  id: number;
  tenant_id: number;
  original_name: string;
  stored_name: string;
  storage_driver: UploadStorageDriver;
  storage_path: string;
  public_url: string | null;
  mime_type: string | null;
  file_size: number;
  bucket_name: string | null;
  object_key: string | null;
};

export type StoredUploadFile = {
  id: number;
  url: string;
  originalName: string;
  size: number;
  path: string;
  storageDriver: UploadStorageDriver;
};

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function resolveStorageDriver(): UploadStorageDriver {
  const raw = String(process.env.FILE_STORAGE_DRIVER ?? (isProduction() ? 'oss' : 'local')).trim().toLowerCase();
  return raw === 'oss' ? 'oss' : 'local';
}

function getUploadDir(): string {
  return path.resolve(process.env.UPLOAD_DIR || '/app/uploads');
}

function normalizePrefix(rawPrefix: string | undefined): string {
  const trimmed = String(rawPrefix ?? 'smartfactory').trim().replace(/^\/+|\/+$/g, '');
  return trimmed || 'smartfactory';
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function buildObjectKey(tenantId: number, originalName: string): { objectKey: string; storedName: string } {
  const ext = path.extname(originalName).toLowerCase();
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const hash = crypto.randomBytes(16).toString('hex');
  const storedName = `${Date.now()}-${hash}${ext}`;
  const prefix = normalizePrefix(process.env.OSS_PATH_PREFIX);
  const objectKey = path.posix.join(prefix, `tenant-${tenantId}`, year, month, sanitizePathSegment(storedName));
  return { objectKey, storedName };
}

function encodeObjectPath(objectKey: string): string {
  return `/${objectKey.split('/').map((segment) => encodeURIComponent(segment)).join('/')}`;
}

function getOssConfig() {
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET;
  const bucket = process.env.OSS_BUCKET;
  const endpoint = process.env.OSS_ENDPOINT;

  if (!accessKeyId || !accessKeySecret || !bucket || !endpoint) {
    throw new AppError('OSS 配置不完整，请检查 FILE_STORAGE_DRIVER 与 OSS 基础参数', ResponseCode.INTERNAL_ERROR, 500);
  }

  const parsed = endpoint.startsWith('http://') || endpoint.startsWith('https://')
    ? new URL(endpoint)
    : new URL(`https://${endpoint}`);

  return {
    accessKeyId,
    accessKeySecret,
    bucket,
    protocol: parsed.protocol,
    host: parsed.host.startsWith(`${bucket}.`) ? parsed.host : `${bucket}.${parsed.host}`,
    pathnamePrefix: parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, ''),
  };
}

async function sendOssRequest(params: {
  method: 'PUT' | 'GET';
  objectKey: string;
  contentType?: string;
  body?: Buffer;
}): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  const config = getOssConfig();
  const date = new Date().toUTCString();
  const contentType = params.contentType ?? '';
  const contentMd5 = '';
  const canonicalizedResource = `/${config.bucket}/${params.objectKey}`;
  const stringToSign = [
    params.method,
    contentMd5,
    contentType,
    date,
    canonicalizedResource,
  ].join('\n');
  const signature = crypto
    .createHmac('sha1', config.accessKeySecret)
    .update(stringToSign)
    .digest('base64');

  const requestPath = `${config.pathnamePrefix}${encodeObjectPath(params.objectKey)}`;
  const headers: Record<string, string> = {
    Date: date,
    Host: config.host,
    Authorization: `OSS ${config.accessKeyId}:${signature}`,
  };

  if (contentType) headers['Content-Type'] = contentType;
  if (params.body) headers['Content-Length'] = String(params.body.length);

  const transport = config.protocol === 'http:' ? http : https;

  return await new Promise((resolve, reject) => {
    const req = transport.request(
      {
        protocol: config.protocol,
        host: config.host.split(':')[0],
        port: config.host.includes(':') ? Number(config.host.split(':')[1]) : undefined,
        method: params.method,
        path: requestPath,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 500,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    req.on('error', reject);
    if (params.body) req.write(params.body);
    req.end();
  });
}

async function saveToLocal(objectKey: string, buffer: Buffer): Promise<void> {
  const absolutePath = path.resolve(getUploadDir(), objectKey);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, buffer);
}

async function readFromLocal(objectKey: string): Promise<Buffer> {
  const absolutePath = path.resolve(getUploadDir(), objectKey);
  return await fs.readFile(absolutePath);
}

async function saveToOss(objectKey: string, buffer: Buffer, contentType: string): Promise<void> {
  const response = await sendOssRequest({
    method: 'PUT',
    objectKey,
    contentType,
    body: buffer,
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new AppError(`OSS 上传失败，状态码 ${response.statusCode}`, ResponseCode.INTERNAL_ERROR, 500);
  }
}

async function readFromOss(objectKey: string): Promise<Buffer> {
  const response = await sendOssRequest({
    method: 'GET',
    objectKey,
  });
  if (response.statusCode === 404) {
    throw AppError.notFound('上传文件不存在');
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new AppError(`OSS 文件获取失败，状态码 ${response.statusCode}`, ResponseCode.INTERNAL_ERROR, 500);
  }
  return response.body;
}

function isInlineContentType(mimeType: string | null): boolean {
  return Boolean(mimeType && (mimeType.startsWith('image/') || mimeType === 'application/pdf'));
}

export class UploadService {
  constructor(
    private readonly tenantId: number,
    private readonly userId: number,
  ) {}

  async saveUploadedFile(file: Express.Multer.File, originalName: string): Promise<StoredUploadFile> {
    const driver = resolveStorageDriver();
    const { objectKey, storedName } = buildObjectKey(this.tenantId, originalName);
    const contentType = file.mimetype || 'application/octet-stream';

    if (driver === 'oss') {
      await saveToOss(objectKey, file.buffer, contentType);
    } else {
      await saveToLocal(objectKey, file.buffer);
    }

    const bucketName = driver === 'oss' ? getOssConfig().bucket : null;
    const insertResult = await AppDataSource.query(
      `INSERT INTO uploaded_files
         (tenant_id, original_name, stored_name, storage_driver, storage_path, public_url, mime_type, file_size, bucket_name, object_key, created_by)
       VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?)`,
      [
        this.tenantId,
        originalName,
        storedName,
        driver,
        objectKey,
        contentType,
        file.size,
        bucketName,
        objectKey,
        this.userId,
      ],
    ) as { insertId?: number };

    const fileId = Number(insertResult?.insertId ?? 0);
    if (!Number.isInteger(fileId) || fileId <= 0) {
      throw new AppError('上传记录写入失败', ResponseCode.INTERNAL_ERROR, 500);
    }

    const publicUrl = `/api/upload/files/${fileId}/content`;
    await AppDataSource.query(
      `UPDATE uploaded_files SET public_url = ? WHERE id = ? AND tenant_id = ?`,
      [publicUrl, fileId, this.tenantId],
    );

    return {
      id: fileId,
      url: publicUrl,
      originalName,
      size: file.size,
      path: objectKey,
      storageDriver: driver,
    };
  }

  async getFileContent(fileId: number): Promise<{
    buffer: Buffer;
    mimeType: string | null;
    originalName: string;
    size: number;
    inline: boolean;
  }> {
    const rows = await AppDataSource.query<UploadedFileRow[]>(
      `SELECT id, tenant_id, original_name, stored_name, storage_driver, storage_path, public_url,
              mime_type, file_size, bucket_name, object_key
         FROM uploaded_files
        WHERE id = ? AND tenant_id = ?
        LIMIT 1`,
      [fileId, this.tenantId],
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) {
      throw AppError.notFound('上传文件不存在');
    }

    const objectKey = row.object_key || row.storage_path;
    const buffer = row.storage_driver === 'oss'
      ? await readFromOss(objectKey)
      : await readFromLocal(objectKey);

    return {
      buffer,
      mimeType: row.mime_type,
      originalName: row.original_name,
      size: row.file_size,
      inline: isInlineContentType(row.mime_type),
    };
  }
}
