import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../shared/AppError';
import { ResponseCode } from '../shared/ApiResponse';

/**
 * 统一错误处理中间件
 * 必须注册为 Express 的最后一个中间件（4个参数）
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // 记录错误日志
  const logLevel = isClientError(err) ? 'warn' : 'error';
  console[logLevel](`[${req.method}] ${req.path}`, {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    tenantId: req.tenantId,
    userId: req.userId,
  });

  // 业务错误（已知错误）
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      code: err.code,
      data: err.data ?? null,
      message: err.message,
    });
    return;
  }

  // Zod 参数校验错误
  if (err instanceof ZodError) {
    const details = err.errors.map((e) => `${e.path.join('.')}: ${e.message}`);
    res.status(400).json({
      code: ResponseCode.INVALID_PARAMS,
      data: { details },
      message: `参数校验失败：${details[0]}`,
    });
    return;
  }

  // TypeORM 重复键错误
  if (isDuplicateKeyError(err)) {
    res.status(409).json({
      code: ResponseCode.CONFLICT,
      data: null,
      message: '数据已存在，请勿重复提交',
    });
    return;
  }

  // 未知错误（服务端错误，隐藏内部细节）
  res.status(500).json({
    code: ResponseCode.INTERNAL_ERROR,
    data: null,
    message: '服务内部错误，请稍后重试',
  });
}

function isClientError(err: unknown): boolean {
  return err instanceof AppError && err.statusCode < 500;
}

function isDuplicateKeyError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // MySQL 重复键错误码 1062
  return (err as NodeJS.ErrnoException).code === 'ER_DUP_ENTRY' ||
    err.message.includes('Duplicate entry');
}
