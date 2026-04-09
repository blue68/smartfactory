/**
 * BE-S4-13~15: 调度建议模块路由
 *
 * 路由前缀（在 app.ts 中注册）：/api/schedule-suggestions
 *
 * 路由设计原则：
 *   - 固定路径段（/calculate、/status、/latest、/history、/purchase-steps/:id）
 *     必须注册在参数路由 /:id 之前，防止路径被参数捕获
 *   - 所有路由均通过 authMiddleware 保护
 *   - 写操作（POST）通过 requireRoles 限制角色
 */

import { Router } from 'express';
import { authMiddleware, requirePermissionsOrRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';
import { scheduleSuggestionController as ctrl } from './schedule-suggestion.controller';

const router = Router();

// 所有路由均需认证
router.use(authMiddleware);

// ── 固定路径段（必须在参数路由 /:id 之前注册）──────────────────────────────

/**
 * POST /api/schedule-suggestions/calculate
 * 触发调度建议计算，仅 supervisor / boss 可操作
 */
router.post(
  '/calculate',
  requirePermissionsOrRoles(['schedule:suggestion:trigger'], 'supervisor', 'boss'),
  asyncHandler(ctrl.triggerCalculation.bind(ctrl)),
);

/**
 * GET /api/schedule-suggestions/status?jobId=xxx
 * 查询计算状态
 */
router.get(
  '/status',
  requirePermissionsOrRoles(['schedule:suggestion:purchase:view', 'schedule:suggestion:production:view'], 'supervisor', 'boss', 'purchase', 'purchaser'),
  asyncHandler(ctrl.getStatus.bind(ctrl)),
);

/**
 * GET /api/schedule-suggestions/latest
 * 获取最近一次计算完成的建议（角色过滤：purchase 仅见采购建议）
 */
router.get(
  '/latest',
  requirePermissionsOrRoles(['schedule:suggestion:purchase:view', 'schedule:suggestion:production:view'], 'supervisor', 'boss', 'purchase', 'purchaser'),
  asyncHandler(ctrl.getLatest.bind(ctrl)),
);

/**
 * GET /api/schedule-suggestions/history?page=1&pageSize=20
 * 历史批次分页列表
 */
router.get(
  '/history',
  requirePermissionsOrRoles(['schedule:suggestion:purchase:view', 'schedule:suggestion:production:view'], 'supervisor', 'boss', 'purchase', 'purchaser'),
  asyncHandler(ctrl.getHistory.bind(ctrl)),
);

/**
 * POST /api/schedule-suggestions/items/:itemId/accept
 * 接受建议（可选传 modifiedQty 修改数量）
 */
router.post(
  '/items/:itemId/accept',
  requirePermissionsOrRoles(['schedule:suggestion:purchase:view', 'schedule:suggestion:production:view'], 'supervisor', 'boss', 'purchase', 'purchaser'),
  asyncHandler(ctrl.acceptItem.bind(ctrl)),
);

/**
 * POST /api/schedule-suggestions/items/:itemId/reject
 * 驳回建议（必须提供 reason）
 */
router.post(
  '/items/:itemId/reject',
  requirePermissionsOrRoles(['schedule:suggestion:purchase:view', 'schedule:suggestion:production:view'], 'supervisor', 'boss', 'purchase', 'purchaser'),
  asyncHandler(ctrl.rejectItem.bind(ctrl)),
);

/**
 * POST /api/schedule-suggestions/items/:itemId/apply
 * 应用排产建议（写入 priority_score），仅 supervisor / boss 可操作
 */
router.post(
  '/items/:itemId/apply',
  requirePermissionsOrRoles(['production:schedule:confirm'], 'supervisor', 'boss'),
  asyncHandler(ctrl.applyProduction.bind(ctrl)),
);

/**
 * GET /api/schedule-suggestions/purchase-steps/:id
 * 获取采购建议计算步骤（calc_steps 透传）
 * 注意：必须在 /:id 参数路由之前注册
 */
router.get(
  '/purchase-steps/:id',
  requirePermissionsOrRoles(['schedule:suggestion:purchase:view'], 'supervisor', 'boss', 'purchase', 'purchaser'),
  asyncHandler(ctrl.getPurchaseSteps.bind(ctrl)),
);

// ── 参数路由（放最后，防止覆盖固定路径段）────────────────────────────────────

/**
 * GET /api/schedule-suggestions/:id
 * 历史批次详情（含明细列表）
 */
router.get(
  '/:id',
  requirePermissionsOrRoles(['schedule:suggestion:purchase:view', 'schedule:suggestion:production:view'], 'supervisor', 'boss', 'purchase', 'purchaser'),
  asyncHandler(ctrl.getHistoryDetail.bind(ctrl)),
);

export default router;
