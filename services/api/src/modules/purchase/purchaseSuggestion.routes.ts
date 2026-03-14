import { Router } from 'express';
import { purchaseSuggestionController } from './purchaseSuggestion.controller';
import { authMiddleware, requireRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();
router.use(authMiddleware);

// 采购建议列表（支持 source 筛选）
router.get('/',
  asyncHandler(purchaseSuggestionController.list.bind(purchaseSuggestionController)),
);

// 审批通过
router.put('/:id/approve',
  requireRoles('boss', 'supervisor'),
  asyncHandler(purchaseSuggestionController.approve.bind(purchaseSuggestionController)),
);

// 驳回
router.put('/:id/reject',
  requireRoles('boss', 'supervisor'),
  asyncHandler(purchaseSuggestionController.reject.bind(purchaseSuggestionController)),
);

// 批量转采购订单
router.post('/batch-to-po',
  requireRoles('purchase', 'supervisor', 'boss'),
  asyncHandler(purchaseSuggestionController.batchToPO.bind(purchaseSuggestionController)),
);

export default router;
