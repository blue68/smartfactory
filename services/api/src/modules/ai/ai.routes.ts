/**
 * [artifact:AI接口] — AI 模块路由
 *
 * 路由总览：
 *   POST /api/ai/chat             — 用户发送消息，SSE 流式响应
 *   GET  /api/ai/suggestions      — 获取 AI 主动建议列表
 *   PUT  /api/ai/suggestions/:id  — 更新建议状态（已读/采纳/忽略）
 *   POST /api/ai/feedback         — 提交消息反馈（有用/无用）
 *   POST /api/ai/scan             — 触发一次主动建议扫描（仅限 boss/supervisor）
 *
 * SSE 说明（POST /api/ai/chat）：
 *   - 请求方式：POST + Content-Type: application/json
 *   - 请求体：{ "message": "用户自然语言输入" }
 *   - 响应体：text/event-stream，帧格式见 response.generator.ts
 *   - 前端兼容：AiChatPanel.tsx 已按此格式解析
 *
 * 限流策略：
 *   - /api/ai/chat：每 IP 每分钟最多 20 次（防止 SSE 滥用）
 *   - 其余接口：继承全局 300 次/分钟限制
 */

import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { authMiddleware } from '../../middleware/auth';
import { requireRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';
import { AiService, ChatRequest, FeedbackParams } from './ai.service';
import { ProactiveService } from './proactive.service';
import { ResponseGenerator } from './response.generator';
import { success, error, ResponseCode } from '../../shared/ApiResponse';

const router = Router();

// 所有 AI 路由均需要登录
router.use(authMiddleware);

// ── AI 对话限流（比全局更严格） ───────────────────────────────

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 分钟窗口
  max: 20,               // 每 IP 每分钟最多 20 次对话请求
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 1099, data: null, message: 'AI 对话请求过于频繁，请稍候再试' },
  // 对 SSE 长连接跳过计数（已完成的请求才算）
  skipFailedRequests: true,
});

// ─── POST /api/ai/chat — SSE 流式对话 ───────────────────────

router.post(
  '/chat',
  chatLimiter as RequestHandler,
  // asyncHandler 不适用于 SSE（SSE 不应等 Promise resolve 后才 next），
  // 这里单独实现错误兜底，保证 SSE 帧始终关闭
  (req: Request, res: Response, next: NextFunction): void => {
    const ctx = extractTenantContext(req, res);
    if (!ctx) return;

    const body = req.body as Partial<ChatRequest>;
    const message = body.message?.trim() ?? '';

    if (!message) {
      error(res, ResponseCode.INVALID_PARAMS, '消息内容不能为空');
      return;
    }

    if (message.length > 500) {
      error(res, ResponseCode.INVALID_PARAMS, '消息长度不能超过500字');
      return;
    }

    const svc = new AiService(ctx);
    svc.handleChat({ message, sessionId: body.sessionId }, res).catch((err: unknown) => {
      // SSE 头若已发送则不能再 next，改为写错误帧
      if (res.headersSent) {
        ResponseGenerator.writeError(res, 'AI 服务内部错误');
        res.end();
      } else {
        next(err);
      }
    });
  },
);

// ─── GET /api/ai/suggestions — 获取主动建议列表 ─────────────

router.get(
  '/suggestions',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const ctx = extractTenantContext(req, res);
    if (!ctx) return;

    const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10));
    const pageSize = Math.min(50, Math.max(1, parseInt((req.query.pageSize as string) ?? '10', 10)));
    const status = req.query.status as 'unread' | 'read' | 'adopted' | 'ignored' | undefined;

    const validStatuses = ['unread', 'read', 'adopted', 'ignored'];
    if (status && !validStatuses.includes(status)) {
      error(res, ResponseCode.INVALID_PARAMS, `status 参数无效，可选值：${validStatuses.join('、')}`);
      return;
    }

    const svc = new AiService(ctx);
    const result = await svc.getSuggestions({ page, pageSize, status });
    success(res, result, '获取成功');
  }),
);

// ─── PUT /api/ai/suggestions/:id — 更新建议状态 ─────────────

router.put(
  '/suggestions/:id',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const ctx = extractTenantContext(req, res);
    if (!ctx) return;

    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      error(res, ResponseCode.INVALID_PARAMS, '建议ID无效');
      return;
    }

    const { status } = req.body as { status?: string };
    const validStatuses = ['read', 'adopted', 'ignored'];

    if (!status || !validStatuses.includes(status)) {
      error(res, ResponseCode.INVALID_PARAMS, `status 参数无效，可选值：${validStatuses.join('、')}`);
      return;
    }

    const svc = new AiService(ctx);
    await svc.updateSuggestionStatus(id, status as 'read' | 'adopted' | 'ignored');
    success(res, null, '状态已更新');
  }),
);

// ─── POST /api/ai/feedback — 提交消息反馈 ───────────────────

router.post(
  '/feedback',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const ctx = extractTenantContext(req, res);
    if (!ctx) return;

    const body = req.body as Partial<FeedbackParams>;

    if (!body.messageId) {
      error(res, ResponseCode.INVALID_PARAMS, 'messageId 不能为空');
      return;
    }

    if (!body.rating || !['helpful', 'unhelpful'].includes(body.rating)) {
      error(res, ResponseCode.INVALID_PARAMS, 'rating 只能是 helpful 或 unhelpful');
      return;
    }

    if (body.comment && body.comment.length > 200) {
      error(res, ResponseCode.INVALID_PARAMS, '反馈内容不能超过200字');
      return;
    }

    const svc = new AiService(ctx);
    await svc.saveFeedback({
      messageId: body.messageId,
      rating: body.rating,
      comment: body.comment,
    });

    success(res, null, '感谢您的反馈');
  }),
);

// ─── BE-P1-016: AI 对话历史接口 ──────────────────────────────

router.get(
  '/conversations',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const ctx = extractTenantContext(req, res);
    if (!ctx) return;
    const svc = new AiService(ctx);
    const result = await svc.listConversations();
    success(res, result, '获取成功');
  }),
);

router.get(
  '/conversations/:sessionId/messages',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const ctx = extractTenantContext(req, res);
    if (!ctx) return;
    const sessionId = req.params.sessionId;
    if (!sessionId) {
      error(res, ResponseCode.INVALID_PARAMS, 'sessionId 不能为空');
      return;
    }
    const svc = new AiService(ctx);
    const result = await svc.getConversationMessages(sessionId);
    success(res, result, '获取成功');
  }),
);

router.delete(
  '/conversations/:sessionId',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const ctx = extractTenantContext(req, res);
    if (!ctx) return;
    const sessionId = req.params.sessionId;
    if (!sessionId) {
      error(res, ResponseCode.INVALID_PARAMS, 'sessionId 不能为空');
      return;
    }
    const svc = new AiService(ctx);
    await svc.clearConversation(sessionId);
    success(res, null, '会话已清除');
  }),
);

// ─── POST /api/ai/scan — 手动触发主动建议扫描（管理员） ──────

router.post(
  '/scan',
  requireRoles('boss', 'supervisor'),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const ctx = extractTenantContext(req, res);
    if (!ctx) return;

    const svc = new ProactiveService(ctx);
    const result = await svc.runAllScans();

    success(res, result, `扫描完成，新增${result.inserted}条建议，跳过${result.skipped}条`);
  }),
);

// ─── 辅助：从 request 中提取租户上下文 ───────────────────────

/**
 * authMiddleware 在 req 上注入了 tenantId 和 userId（见 auth.middleware.ts 实现）。
 * 通过类型断言获取，若缺失则返回 401 并返回 null。
 */
function extractTenantContext(
  req: Request,
  res: Response,
): { tenantId: number; userId: number } | null {
  const r = req as Request & { tenantId?: number; userId?: number };

  if (!r.tenantId || !r.userId) {
    error(res, ResponseCode.UNAUTHORIZED, '请先登录', 401);
    return null;
  }

  return { tenantId: r.tenantId, userId: r.userId };
}

export default router;
