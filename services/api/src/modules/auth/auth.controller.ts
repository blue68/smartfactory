import { Request, Response } from 'express';
import { z } from 'zod';
import { authService } from './auth.service';
import { success } from '../../shared/ApiResponse';
import { validate } from '../../middleware/validator';
import { REFRESH_TOKEN_TTL_SECONDS } from '../../middleware/auth';

// ─────────────────────────────────────────────
// Zod Schemas
// ─────────────────────────────────────────────

const LoginSchema = z.object({
  loginMode: z.enum(['tenant', 'platform']).optional(),
  username: z.string().min(1, '用户名不能为空'),
  password: z.string().min(1, '密码不能为空'),
  tenantCode: z.string().optional(),
}).superRefine((value, ctx) => {
  if ((value.loginMode ?? 'tenant') === 'tenant' && !value.tenantCode?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['tenantCode'],
      message: '租户编码不能为空',
    });
  }
});

const SwitchTenantSchema = z.object({
  targetTenantId: z.coerce.number().int().positive('目标租户不能为空'),
});

const WechatLoginSchema = z.object({
  openid: z.string().min(1),
  tenantCode: z.string().min(1),
});

// ─────────────────────────────────────────────
// Cookie 配置
// SEC-003: refresh token 存储在 HttpOnly Cookie 中
// ─────────────────────────────────────────────

const REFRESH_COOKIE_NAME = 'rt';
const REFRESH_COOKIE_PATH = '/api/auth';

/**
 * 构造 Refresh Token Cookie 选项
 * 非 production 环境下关闭 Secure（开发环境无 HTTPS）
 */
function buildRefreshCookieOptions(): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'strict';
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000, // maxAge 单位为毫秒
  };
}

/**
 * 清除 Refresh Token Cookie
 */
function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
  });
}

// ─────────────────────────────────────────────
// Controller
// ─────────────────────────────────────────────

export class AuthController {
  readonly loginValidator = validate('body', LoginSchema);
  readonly wechatLoginValidator = validate('body', WechatLoginSchema);
  readonly switchTenantValidator = validate('body', SwitchTenantSchema);

  /**
   * POST /api/auth/login
   * SEC-003: refresh token 写入 HttpOnly Cookie，不在 response body 中返回
   */
  async login(req: Request, res: Response): Promise<void> {
    const result = await authService.login(req.body as z.infer<typeof LoginSchema>);

    // 将 refresh token 写入 HttpOnly Cookie
    res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, buildRefreshCookieOptions());

    // response body 中不暴露 refresh token
    success(res, {
      accessToken: result.accessToken,
      permissionSnapshot: result.permissionSnapshot,
      user: result.user,
    }, '登录成功');
  }

  /**
   * POST /api/auth/wechat-login
   * SEC-003: refresh token 写入 HttpOnly Cookie
   */
  async wechatLogin(req: Request, res: Response): Promise<void> {
    const { openid, tenantCode } = req.body as z.infer<typeof WechatLoginSchema>;
    const result = await authService.wechatLogin(openid, tenantCode);

    res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, buildRefreshCookieOptions());

    success(res, {
      accessToken: result.accessToken,
      permissionSnapshot: result.permissionSnapshot,
      user: result.user,
    }, '微信登录成功');
  }

  /**
   * POST /api/auth/refresh
   * SEC-003: 从 Cookie 中读取 refresh token，而非 request body
   * SEC-004: 旋转后将新 refresh token 写回 Cookie
   */
  async refreshToken(req: Request, res: Response): Promise<void> {
    const refreshTokenStr = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
    if (!refreshTokenStr) {
      res.status(401).json({ code: 401, data: null, message: '缺少刷新令牌，请重新登录' });
      return;
    }

    const result = await authService.refreshToken(refreshTokenStr);

    // 旋转：写入新的 refresh token Cookie
    res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, buildRefreshCookieOptions());

    success(res, {
      accessToken: result.accessToken,
      permissionSnapshot: result.permissionSnapshot,
    }, '令牌已刷新');
  }

  /**
   * POST /api/auth/logout
   * SEC-003: 清除 Cookie
   * SEC-004: 吊销 Redis 中的 jti
   */
  async logout(req: Request, res: Response): Promise<void> {
    const refreshTokenStr = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;

    if (refreshTokenStr) {
      // 尽力吊销，失败不影响登出流程
      await authService.logout(refreshTokenStr).catch((err) =>
        console.error('[AuthController] logout Redis 吊销失败:', err),
      );
    }

    clearRefreshCookie(res);
    success(res, null, '已退出登录');
  }

  async switchTenant(req: Request, res: Response): Promise<void> {
    const result = await authService.switchTenantContext({
      userId: req.userId,
      username: req.user.username,
      originTenantId: req.originTenantId,
      roles: req.roles,
      scopeLevel: req.scopeLevel,
      targetTenantId: Number((req.body as z.infer<typeof SwitchTenantSchema>).targetTenantId),
    });

    res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, buildRefreshCookieOptions());
    success(res, {
      accessToken: result.accessToken,
      permissionSnapshot: result.permissionSnapshot,
      user: result.user,
    }, '已进入目标租户上下文');
  }

  async exitTenantContext(req: Request, res: Response): Promise<void> {
    const result = await authService.exitTenantContext({
      userId: req.userId,
      originTenantId: req.originTenantId,
      contextTenantId: req.contextTenantId,
      scopeLevel: req.scopeLevel,
    });

    res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, buildRefreshCookieOptions());
    success(res, {
      accessToken: result.accessToken,
      permissionSnapshot: result.permissionSnapshot,
      user: result.user,
    }, '已退出租户上下文');
  }
}

export const authController = new AuthController();
