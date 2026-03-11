import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { AppError } from '../shared/AppError';
import { ResponseCode } from '../shared/ApiResponse';

// BLK-002: JWT_SECRET 强制校验 — 生产环境由 index.ts 启动时拦截
// 开发环境若未配置也使用弱默认值（已在 index.ts 打印 warn）
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || (JWT_SECRET + '_refresh');

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('[Security] JWT_SECRET 未配置，拒绝启动。请设置环境变量。');
}

export { JWT_REFRESH_SECRET };

/**
 * Refresh Token 有效期（秒）
 * 与 Cookie maxAge 及 Redis TTL 保持一致：7 天
 */
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 3600;

/**
 * Access Token JWT Payload 结构
 */
export interface JwtPayload {
  userId: number;
  tenantId: number;
  username: string;
  roles: string[];
  iat?: number;
  exp?: number;
}

/**
 * Refresh Token JWT Payload 结构
 * jti: JWT ID，用于 Redis 中唯一标识该令牌（吊销机制）
 */
export interface RefreshTokenPayload {
  userId: number;
  tenantId: number;
  type: 'refresh';
  jti: string;
  iat?: number;
  exp?: number;
}

/**
 * Redis Refresh Token Key 构造器
 * key 格式：rt:{jti}
 * value 格式：{userId}:{tenantId}
 */
export const RefreshTokenRedisKey = {
  byJti: (jti: string) => `rt:${jti}`,
} as const;

/**
 * 扩展 Express Request 类型，携带租户和用户上下文
 */
declare global {
  namespace Express {
    interface Request {
      user: JwtPayload;
      tenantId: number;
      userId: number;
      /** JWT payload 中解析出的用户角色列表，由 authMiddleware 写入 */
      roles: string[];
    }
  }
}

/**
 * JWT 认证中间件
 * 从 Authorization: Bearer <token> 解析用户身份
 */
export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw AppError.unauthorized('缺少认证令牌');
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload & { type?: string };
    if (payload.type === 'refresh') {
      throw AppError.unauthorized('Refresh Token 不能用于 API 认证');
    }
    req.user = payload;
    req.tenantId = payload.tenantId;
    req.userId = payload.userId;
    next();
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    if (err instanceof jwt.TokenExpiredError) {
      throw new AppError('令牌已过期，请重新登录', ResponseCode.UNAUTHORIZED, 401);
    }
    throw AppError.unauthorized('无效的认证令牌');
  }
}

/**
 * 角色权限中间件工厂
 * 用法：requireRoles('boss', 'purchaser')
 */
export function requireRoles(...allowedRoles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const userRoles = req.user?.roles ?? [];
    const hasRole = allowedRoles.some((role) => userRoles.includes(role));
    if (!hasRole) {
      throw AppError.forbidden(`该操作需要以下角色之一：${allowedRoles.join(', ')}`);
    }
    next();
  };
}

/**
 * 签发 Access Token
 */
export function signToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: (process.env.JWT_EXPIRES_IN ?? '2h') as string & jwt.SignOptions['expiresIn'],
  } as jwt.SignOptions);
}

/**
 * 签发 Refresh Token
 * 每次签发生成唯一 jti，用于 Redis 吊销跟踪。
 * 返回 token 字符串和 jti，调用方负责将 jti 写入 Redis。
 */
export function signRefreshToken(
  userId: number,
  tenantId: number,
): { token: string; jti: string } {
  const jti = randomUUID();
  const token = jwt.sign(
    { userId, tenantId, type: 'refresh', jti } satisfies Omit<RefreshTokenPayload, 'iat' | 'exp'>,
    JWT_REFRESH_SECRET,
    { expiresIn: REFRESH_TOKEN_TTL_SECONDS },
  );
  return { token, jti };
}

/**
 * 验证 Refresh Token 签名并返回 Payload（不检查 Redis，由 Service 层负责）
 */
export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, JWT_REFRESH_SECRET) as RefreshTokenPayload;
}
