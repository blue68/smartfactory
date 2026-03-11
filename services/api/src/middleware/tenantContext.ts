import { Request, Response, NextFunction } from 'express';
import { AppError } from '../shared/AppError';

/**
 * 租户上下文中间件
 * 必须在 authMiddleware 之后使用
 * 确保 req.tenantId 已被设置，防止遗漏
 */
export function tenantContextMiddleware(req: Request, _res: Response, next: NextFunction): void {
  if (!req.tenantId || !req.userId) {
    throw AppError.unauthorized('无法解析租户上下文，请确保已通过认证');
  }
  next();
}
