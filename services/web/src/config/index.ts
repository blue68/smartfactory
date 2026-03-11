/**
 * [artifact:前端代码] — 环境配置
 */

const env = import.meta.env;

export const config = {
  /** API 基础地址 */
  apiBaseUrl: env.VITE_API_BASE_URL ?? '',

  /** 应用标题 */
  appTitle: env.VITE_APP_TITLE ?? '智造管家',

  /** 当前环境 */
  appEnv: (env.VITE_APP_ENV ?? 'development') as 'development' | 'staging' | 'production',

  /** 默认租户编码（私有化部署时固定） */
  tenantCode: env.VITE_TENANT_CODE ?? 'FACTORY001',

  /** 是否开发环境 */
  isDev: (env.VITE_APP_ENV ?? 'development') === 'development',

  /** Token 存储 key（Refresh Token 已改为 HttpOnly Cookie，不再存 localStorage） */
  tokenKey: 'sf_access_token',
  userKey: 'sf_user',

  /** 请求超时（毫秒） */
  requestTimeout: 30_000,

  /** AI 长请求超时（排产、插单分析等） */
  aiRequestTimeout: 60_000,

  /** 分页默认值 */
  defaultPageSize: 20,

  /** 4003 锁冲突自动重试次数和延迟 */
  lockRetryCount: 1,
  lockRetryDelay: 500,
} as const;

export type AppConfig = typeof config;
