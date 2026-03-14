import express, { Request, Response, NextFunction, RequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import cors, { CorsOptions } from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { errorHandler } from './middleware/errorHandler';
import { apmMiddleware, metricsHandler } from './middleware/apm';
import { authMiddleware, requireRoles } from './middleware/auth';

// 路由模块
import authRoutes      from './modules/auth/auth.routes';
import skuRoutes       from './modules/sku/sku.routes';
import bomRoutes       from './modules/bom/bom.routes';
import inventoryRoutes from './modules/inventory/inventory.routes';
import purchaseRoutes  from './modules/purchase/purchase.routes';
import salesRoutes     from './modules/sales/sales.routes';
import productionRoutes from './modules/production/production.routes';
import qualityRoutes   from './modules/quality/quality.routes';
import aiRoutes        from './modules/ai/ai.routes';
import supplierRoutes  from './modules/supplier/supplier.routes';
import priceRoutes     from './modules/price/price.routes';
import processConfigRoutes from './modules/process-config/processConfig.routes';
import customerRoutes  from './modules/sales-customer/customer.routes';
import salesOrderRoutes from './modules/sales-order/salesOrder.routes';
import skuCategoryRoutes from './modules/sku-category/skuCategory.routes';
import wageRoutes      from './modules/report/wage.routes';
import analyticsRoutes from './modules/analytics/analytics.routes';
import uploadRoutes    from './modules/upload/upload.routes';
// Sprint 3 新增模块
import incomingInspectionRoutes from './modules/incoming-inspection/incomingInspection.routes';
import returnOrderRoutes from './modules/return-order/returnOrder.routes';
import mrpRoutes from './modules/mrp/mrp.routes';
import purchaseSuggestionRoutes from './modules/purchase/purchaseSuggestion.routes';
// Sprint 4 新增模块
import scheduleSuggestionRoutes from './modules/schedule-suggestion/schedule-suggestion.routes';

const app = express();

// Nginx 反向代理时需要信任代理头
app.set('trust proxy', 1);

// ── CORS 白名单配置（SEC-012）────────────────────────────────────────
// 允许的来源从环境变量 CORS_ORIGINS 读取（逗号分隔），
// 未配置时退回开发默认值，不允许通配符 *。
const allowedOrigins: string[] = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

if (allowedOrigins.length === 0) {
  allowedOrigins.push('http://localhost:5173', 'http://localhost:3000');
}

const corsOptions: CorsOptions = {
  origin: (
    requestOrigin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ) => {
    // 无 Origin 头（服务器间调用、curl 等）直接放行
    if (!requestOrigin) {
      callback(null, true);
      return;
    }
    if (allowedOrigins.includes(requestOrigin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS policy: origin '${requestOrigin}' is not allowed`));
    }
  },
  credentials: true,                                              // 支持 Cookie 传递（配合 SEC-003 HttpOnly Cookie）
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,                                                  // 预检缓存 24 小时，减少 OPTIONS 请求
};

app.use(cors(corsOptions));

// ── Cookie 解析（SEC-003 HttpOnly Cookie）────────────────────────
app.use(cookieParser());

// ── APM 性能监控中间件（BE-P2-012）──────────────────────────────
// 在路由之前注册，确保所有请求的响应时间均被采集
app.use(apmMiddleware);

// ── 基础中间件 ──────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── 安全头（SEC M-003：补充 CSP/HSTS/Referrer-Policy）─────────
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
  }
  next();
});

// ── 上传文件静态服务（SEC：需认证才能访问）───────────────────────
// 文件下载须经认证中间件，防止未授权枚举访问敏感附件
app.use('/uploads', authMiddleware, (req, res, next) => {
  // 防路径穿越：仅允许 basename，不允许含 ..
  const fileName = path.basename(req.path);
  if (fileName !== req.path.replace(/^\//, '')) {
    res.status(400).json({ code: 1003, data: null, message: '非法文件路径' });
    return;
  }
  next();
}, express.static(path.resolve(process.env.UPLOAD_DIR || '/app/uploads')));

// ── 全局限流（防暴力请求） ─────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 分钟窗口
  max: 300,              // 每 IP 每分钟最多 300 次请求
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 1099, data: null, message: '请求过于频繁，请稍后重试' },
});
app.use('/api', globalLimiter as RequestHandler);

// 登录接口单独限流（防暴力破解）
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 20,
  message: { code: 1002, data: null, message: '登录尝试次数过多，请15分钟后再试' },
});
app.use('/api/auth/login', authLimiter as RequestHandler);

// ── 健康检查（不需认证） ────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// ── APM 指标端点（BE-P2-012，需认证 + boss 角色）──────────
app.get('/api/health/metrics', authMiddleware, requireRoles('boss'), metricsHandler);

// ── API 路由注册 ────────────────────────────────────────────
app.use('/api/auth',       authRoutes);
app.use('/api/skus',       skuRoutes);
app.use('/api/bom',        bomRoutes);
app.use('/api/inventory',  inventoryRoutes);
app.use('/api/purchase',   purchaseRoutes);
// modules/sales → /api/sales/orders
// 职责：约束引擎（产能/库存可行性校验）、紧急插单分析、发货/收货/结算流程
// 调用方：modules/production（排产约束检查）
// GAP-R08-22 双轨分析结论：
//   sales.service（此路由）与 salesOrder.service（/api/sales-orders）职责不重叠：
//   - sales       负责约束检查/插单分析/发货收货/财务结算（供应链复杂流程）
//   - sales-order 负责订单 CRUD/状态机/审批工作流（前端主交互路由）
//   两个模块均需保留，不做合并。
app.use('/api/sales/orders', salesRoutes);
app.use('/api/production', productionRoutes);
app.use('/api/quality',    qualityRoutes);
app.use('/api/ai',         aiRoutes);
app.use('/api/suppliers',  supplierRoutes);
app.use('/api/prices',     priceRoutes);
app.use('/api/process-configs', processConfigRoutes);
// GAP-R07-G07：/api/customers 已挂载完整版 sales-customer 模块（含联系人/订单子资源）
// modules/customer（简版）未被任何路由引用，可在后续清理 Sprint 中安全删除。
app.use('/api/customers',  customerRoutes);
// modules/sales-order → /api/sales-orders
// 职责：销售订单完整 CRUD、状态机流转、审批工作流（提交/审批/驳回/撤回）
// 调用方：前端 SalesOrderListPage（api/salesOrder.ts）
// 审批权限：requireRoles('boss')，系统中无 admin 角色
app.use('/api/sales-orders', salesOrderRoutes);
app.use('/api/sku-categories', skuCategoryRoutes);
app.use('/api/reports/wages', wageRoutes);
app.use('/api/analytics',  analyticsRoutes);
app.use('/api/upload',     uploadRoutes);
// Sprint 3 新增路由
app.use('/api/incoming-inspections', incomingInspectionRoutes);
app.use('/api/return-orders',        returnOrderRoutes);
app.use('/api/mrp',                  mrpRoutes);
app.use('/api/purchase-suggestions', purchaseSuggestionRoutes);
// Sprint 4 路由
app.use('/api/schedule-suggestions', scheduleSuggestionRoutes);

// ── 404 处理 ────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ code: 1004, data: null, message: '接口不存在' });
});

// ── 统一错误处理（必须放最后，4个参数） ──────────────────────
app.use(errorHandler);

/**
 * asyncHandler — 将 async 控制器包装为 Express 兼容的错误转发
 * 所有 async 路由处理器都通过此函数包装，确保 Promise rejection 被 errorHandler 捕获
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export default app;
