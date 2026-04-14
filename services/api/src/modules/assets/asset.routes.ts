import { Router } from 'express';
import { authMiddleware, requirePermissionsOrRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';
import { assetController } from './asset.controller';

const router = Router();

router.use(authMiddleware);

router.get(
  '/cards',
  requirePermissionsOrRoles(['asset:view'], 'boss', 'supervisor', 'warehouse', 'purchase', 'purchaser'),
  asyncHandler(assetController.listCards.bind(assetController)),
);

router.get(
  '/cards/:id',
  requirePermissionsOrRoles(['asset:view'], 'boss', 'supervisor', 'warehouse', 'purchase', 'purchaser'),
  asyncHandler(assetController.getCardById.bind(assetController)),
);

router.post(
  '/acceptance',
  requirePermissionsOrRoles(['asset:acceptance:create'], 'boss', 'supervisor', 'warehouse'),
  asyncHandler(assetController.acceptAssets.bind(assetController)),
);

router.post(
  '/cards/:id/transfer',
  requirePermissionsOrRoles(['asset:transfer'], 'boss', 'supervisor'),
  asyncHandler(assetController.transferCard.bind(assetController)),
);

router.post(
  '/cards/:id/return',
  requirePermissionsOrRoles(['asset:return'], 'boss', 'supervisor', 'warehouse'),
  asyncHandler(assetController.returnCard.bind(assetController)),
);

router.post(
  '/cards/:id/scrap',
  requirePermissionsOrRoles(['asset:scrap'], 'boss', 'supervisor'),
  asyncHandler(assetController.scrapCard.bind(assetController)),
);

export default router;
