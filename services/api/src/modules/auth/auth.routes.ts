import { Router } from 'express';
import { authController } from './auth.controller';
import { asyncHandler } from '../../app';
import { authMiddleware } from '../../middleware/auth';

const router = Router();

/**
 * POST /api/auth/login          — 账号密码登录，refresh token 写入 HttpOnly Cookie
 * POST /api/auth/wechat-login   — 微信小程序登录，refresh token 写入 HttpOnly Cookie
 * POST /api/auth/refresh        — 从 Cookie 读取 refresh token，刷新 Access Token，旋转 Cookie
 * POST /api/auth/logout         — 清除 Cookie 并吊销 Redis jti
 */
router.post('/login',
  authController.loginValidator,
  asyncHandler(authController.login.bind(authController)),
);

router.post('/wechat-login',
  authController.wechatLoginValidator,
  asyncHandler(authController.wechatLogin.bind(authController)),
);

router.post('/refresh',
  asyncHandler(authController.refreshToken.bind(authController)),
);

router.post('/switch-tenant',
  authMiddleware,
  authController.switchTenantValidator,
  asyncHandler(authController.switchTenant.bind(authController)),
);

router.post('/exit-tenant-context',
  authMiddleware,
  asyncHandler(authController.exitTenantContext.bind(authController)),
);

router.post('/logout',
  asyncHandler(authController.logout.bind(authController)),
);

export default router;
