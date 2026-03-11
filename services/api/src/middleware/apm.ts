import { Request, Response, NextFunction, RequestHandler } from 'express';

// ── 常量 ────────────────────────────────────────────────────────────────────

/** 滑动窗口最大容量（条） */
const WINDOW_SIZE = 1000;

/** P95 告警阈值（毫秒） */
const P95_WARN_THRESHOLD_MS = 2000;

// ── 内存滑动窗口 ──────────────────────────────────────────────────────────

/**
 * 固定容量的循环缓冲区，用于存储最近 WINDOW_SIZE 条请求的响应时间（ms）。
 * 写入复杂度 O(1)，内存占用固定，不依赖外部存储。
 */
const responseTimesBuffer: number[] = new Array(WINDOW_SIZE).fill(0);

/** 当前写入位置（循环覆盖） */
let bufferHead = 0;

/** 已写入的有效数据条数（上限 WINDOW_SIZE） */
let bufferCount = 0;

/** 总请求计数 */
let totalRequests = 0;

/** 慢请求计数（响应时间 > P95_WARN_THRESHOLD_MS） */
let slowRequests = 0;

// ── 分位数计算 ────────────────────────────────────────────────────────────

/**
 * 对有效窗口内的响应时间排序后，按百分位索引取值。
 * 有效数据不足时返回 0。
 *
 * @param percentile 百分位（0-100）
 */
function calcPercentile(sortedSample: number[], percentile: number): number {
  if (sortedSample.length === 0) return 0;
  const idx = Math.ceil((percentile / 100) * sortedSample.length) - 1;
  return sortedSample[Math.max(0, idx)];
}

/**
 * 从循环缓冲区中取出所有有效数据并排序，返回排序副本。
 * 排序复杂度 O(n log n)，n <= WINDOW_SIZE，仅在 metrics 查询时触发。
 */
function getSortedSample(): number[] {
  const valid = responseTimesBuffer.slice(0, bufferCount);
  return valid.sort((a, b) => a - b);
}

// ── 指标快照类型 ──────────────────────────────────────────────────────────

export interface ApmMetrics {
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  totalRequests: number;
  slowRequests: number;
  /** 慢请求比例（0.00 ~ 1.00） */
  slowRequestRate: number;
  windowSize: number;
  sampleCount: number;
  p95ThresholdMs: number;
}

/**
 * 获取当前 APM 指标快照。
 * 供 /api/health/metrics 端点调用。
 */
export function getApmMetrics(): ApmMetrics {
  const sorted = getSortedSample();
  const p50Ms = calcPercentile(sorted, 50);
  const p95Ms = calcPercentile(sorted, 95);
  const p99Ms = calcPercentile(sorted, 99);

  return {
    p50Ms,
    p95Ms,
    p99Ms,
    totalRequests,
    slowRequests,
    slowRequestRate: totalRequests > 0 ? slowRequests / totalRequests : 0,
    windowSize: WINDOW_SIZE,
    sampleCount: bufferCount,
    p95ThresholdMs: P95_WARN_THRESHOLD_MS,
  };
}

// ── Express 中间件 ─────────────────────────────────────────────────────────

/**
 * APM 中间件（BE-P2-012）
 *
 * 职责：
 * 1. 在请求开始时记录高精度时间戳
 * 2. 在响应发出后将响应时间写入滑动窗口
 * 3. P95 超过阈值时打印结构化 WARN 日志
 *
 * 使用方式：在所有路由注册之前 app.use(apmMiddleware)
 */
export const apmMiddleware: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const startAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startAt) / 1_000_000;

    // 写入循环缓冲区
    responseTimesBuffer[bufferHead] = durationMs;
    bufferHead = (bufferHead + 1) % WINDOW_SIZE;
    if (bufferCount < WINDOW_SIZE) bufferCount++;

    totalRequests++;
    if (durationMs > P95_WARN_THRESHOLD_MS) {
      slowRequests++;
    }

    // 每写入一条新数据后检查当前 P95（使用实时排序）
    const sorted = getSortedSample();
    const currentP95 = calcPercentile(sorted, 95);

    if (currentP95 > P95_WARN_THRESHOLD_MS) {
      console.warn(
        JSON.stringify({
          level: 'WARN',
          tag: '[APM]',
          message: `P95 响应时间超阈值`,
          p95Ms: Math.round(currentP95),
          thresholdMs: P95_WARN_THRESHOLD_MS,
          currentRequestMs: Math.round(durationMs),
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          totalRequests,
          slowRequests,
          timestamp: new Date().toISOString(),
        }),
      );
    }
  });

  next();
};

// ── /api/health/metrics 路由处理器 ───────────────────────────────────────

/**
 * GET /api/health/metrics
 *
 * 返回当前滑动窗口内的 APM 指标，无需鉴权。
 * 供运维监控、Prometheus scrape、前端健康看板使用。
 */
export const metricsHandler: RequestHandler = (_req: Request, res: Response): void => {
  const metrics = getApmMetrics();

  res.json({
    code: 0,
    data: {
      latency: {
        p50Ms: metrics.p50Ms,
        p95Ms: metrics.p95Ms,
        p99Ms: metrics.p99Ms,
        p95ThresholdMs: metrics.p95ThresholdMs,
        p95Exceeded: metrics.p95Ms > metrics.p95ThresholdMs,
      },
      requests: {
        total: metrics.totalRequests,
        slow: metrics.slowRequests,
        slowRate: Number(metrics.slowRequestRate.toFixed(4)),
      },
      window: {
        capacity: metrics.windowSize,
        sampleCount: metrics.sampleCount,
      },
      collectedAt: new Date().toISOString(),
    },
    message: 'ok',
  });
};
