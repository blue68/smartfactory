import { Router } from 'express';
import { processConfigController } from './processConfig.controller';
import { authMiddleware } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();

router.use(authMiddleware);

router.get('/',         asyncHandler(processConfigController.list.bind(processConfigController)));
router.get('/:id',      asyncHandler(processConfigController.getOne.bind(processConfigController)));
router.post('/',        asyncHandler(processConfigController.create.bind(processConfigController)));
router.put('/:id',      asyncHandler(processConfigController.update.bind(processConfigController)));
router.delete('/:id',   asyncHandler(processConfigController.remove.bind(processConfigController)));

export default router;
