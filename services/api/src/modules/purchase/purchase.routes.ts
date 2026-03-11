import { Router } from 'express';
import { purchaseController } from './purchase.controller';
import { authMiddleware, requireRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();
router.use(authMiddleware);

// 采购建议
router.post('/suggestions/generate',
  requireRoles('boss', 'purchaser'),
  asyncHandler(purchaseController.generateSuggestions.bind(purchaseController)),
);
router.get('/suggestions',  asyncHandler(purchaseController.listSuggestions.bind(purchaseController)));
router.post('/suggestions/:id/approve',
  requireRoles('boss'),
  asyncHandler(purchaseController.approveSuggestion.bind(purchaseController)),
);

// 采购订单
router.get('/orders',       asyncHandler(purchaseController.listPOs.bind(purchaseController)));
router.post('/orders',
  requireRoles('purchaser', 'boss'),
  asyncHandler(purchaseController.createPO.bind(purchaseController)),
);
router.post('/orders/:id/delivery',
  requireRoles('purchaser'),
  asyncHandler(purchaseController.createDeliveryNote.bind(purchaseController)),
);

// 三单匹配
router.post('/three-way-match',
  requireRoles('purchaser'),
  asyncHandler(purchaseController.runMatch.bind(purchaseController)),
);
router.get('/three-way-match',  asyncHandler(purchaseController.listMatches.bind(purchaseController)));
router.post('/three-way-match/:id/confirm',
  requireRoles('purchaser'),
  asyncHandler(purchaseController.confirmDiff.bind(purchaseController)),
);

export default router;
