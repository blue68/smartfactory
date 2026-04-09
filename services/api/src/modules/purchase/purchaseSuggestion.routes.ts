import { Router } from 'express';
import { purchaseSuggestionController } from './purchaseSuggestion.controller';
import { authMiddleware, requirePermissionsOrRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();
router.use(authMiddleware);

// 采购建议列表（支持 source 筛选）
router.get('/',
  requirePermissionsOrRoles(['purchase:suggestion:view'], 'boss', 'supervisor', 'purchase', 'purchaser'),
  asyncHandler(purchaseSuggestionController.list.bind(purchaseSuggestionController)),
);

// 审批通过
router.put('/:id/approve',
  requirePermissionsOrRoles(['purchase:suggestion:approve'], 'boss', 'supervisor'),
  asyncHandler(purchaseSuggestionController.approve.bind(purchaseSuggestionController)),
);

// 驳回
router.put('/:id/reject',
  requirePermissionsOrRoles(['purchase:suggestion:approve'], 'boss', 'supervisor'),
  asyncHandler(purchaseSuggestionController.reject.bind(purchaseSuggestionController)),
);

// 批量转采购订单
router.post('/batch-to-po',
  requirePermissionsOrRoles(['purchase:order:create'], 'purchase', 'purchaser', 'supervisor', 'boss'),
  asyncHandler(purchaseSuggestionController.batchToPO.bind(purchaseSuggestionController)),
);

export default router;
