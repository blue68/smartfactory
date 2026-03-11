/**
 * 私有化部署配置（BE-P2-013）
 *
 * 通过环境变量控制部署模式，支持 SaaS 多租户模式与私有化单租户模式。
 * 所有配置在进程启动时一次性读取，后续通过 deploymentConfig 对象或
 * isPrivateDeployment() / isOfflineMode() 辅助函数访问。
 *
 * 环境变量说明：
 *   DEPLOYMENT_MODE  saas（默认）| private  — 部署模式
 *   OFFLINE_MODE     true | false（默认）    — 是否开启离线模式（仅 private 模式有意义）
 */

// ── 类型定义 ──────────────────────────────────────────────────────────────

export type DeploymentMode = 'saas' | 'private';

export interface DeploymentConfig {
  /**
   * 当前部署模式。
   * saas     - 标准 SaaS 多租户，tenantId 由 JWT 鉴权中间件注入
   * private  - 私有化单租户，tenantId 固定为 fixedTenantId
   */
  mode: DeploymentMode;

  /**
   * 离线模式标识（仅在 OFFLINE_MODE=true 时为 true）。
   * 私有化部署环境可能完全隔离互联网，此时 AI 模块应使用模板回复。
   */
  offlineMode: boolean;

  /**
   * AI 降级开关。
   * 满足以下任一条件时自动开启：
   *   1. 当前为 private 模式
   *   2. OFFLINE_MODE=true
   * 开启后，LLM API 调用失败时 AI 模块返回预设模板回复而非抛出错误。
   */
  aiFallbackEnabled: boolean;

  /**
   * 私有化模式下固定的单租户 ID。
   * private 模式：固定为 1
   * saas 模式：为 null（tenantId 由请求上下文决定）
   */
  fixedTenantId: number | null;

  /**
   * 数据隔离策略标识。
   * private - 所有查询强制使用 fixedTenantId=1，不从请求中读取 tenantId
   * saas    - 从 JWT payload 中读取 tenantId，支持多租户隔离
   */
  dataIsolation: 'single-tenant' | 'multi-tenant';

  /**
   * AI 降级时返回的预设模板消息。
   * 可通过 AI_FALLBACK_MESSAGE 环境变量自定义，否则使用内置默认值。
   */
  aiFallbackMessage: string;
}

// ── 配置读取与校验 ────────────────────────────────────────────────────────

const rawMode = (process.env.DEPLOYMENT_MODE ?? 'saas').toLowerCase();

if (rawMode !== 'saas' && rawMode !== 'private') {
  // 配置错误时在启动阶段快速失败，避免以错误模式运行
  console.error(
    `[Deployment] 无效的 DEPLOYMENT_MODE="${rawMode}"，有效值为 saas | private，将使用默认值 saas`,
  );
}

const mode: DeploymentMode = rawMode === 'private' ? 'private' : 'saas';
const offlineMode = process.env.OFFLINE_MODE === 'true';

/**
 * 全局部署配置对象（只读快照，进程生命周期内不变）
 */
export const deploymentConfig: Readonly<DeploymentConfig> = Object.freeze({
  mode,
  offlineMode,
  // private 模式或离线模式均需要 AI 降级
  aiFallbackEnabled: mode === 'private' || offlineMode,
  // 私有化模式固定单租户 ID=1
  fixedTenantId: mode === 'private' ? 1 : null,
  dataIsolation: mode === 'private' ? 'single-tenant' : 'multi-tenant',
  aiFallbackMessage:
    process.env.AI_FALLBACK_MESSAGE ??
    '当前系统处于离线或维护模式，AI 功能暂时不可用，请稍后再试或联系管理员。',
});

// ── 辅助函数 ──────────────────────────────────────────────────────────────

/**
 * 判断当前是否为私有化部署模式。
 *
 * 使用场景：
 * - 多租户隔离逻辑中决定是否强制使用 fixedTenantId
 * - 注册/邀请功能中禁止创建新租户
 *
 * @example
 * const tenantId = isPrivateDeployment()
 *   ? deploymentConfig.fixedTenantId!
 *   : req.user.tenantId;
 */
export function isPrivateDeployment(): boolean {
  return deploymentConfig.mode === 'private';
}

/**
 * 判断当前是否处于离线模式。
 *
 * 使用场景：
 * - AI 模块在调用 LLM API 前检查，决定是否跳过网络请求直接返回模板回复
 * - 外部集成模块（短信、邮件等）决定是否静默跳过
 *
 * @example
 * if (isOfflineMode()) {
 *   return { reply: deploymentConfig.aiFallbackMessage };
 * }
 */
export function isOfflineMode(): boolean {
  return deploymentConfig.offlineMode;
}

/**
 * 获取当前请求应使用的 tenantId。
 *
 * 私有化模式下忽略传入值，始终返回固定租户 ID（1），
 * 防止因业务代码遗漏导致数据越界访问。
 *
 * @param requestTenantId 从 JWT 或请求上下文中解析到的 tenantId
 */
export function resolveTenantId(requestTenantId: number): number {
  if (isPrivateDeployment()) {
    return deploymentConfig.fixedTenantId!;
  }
  return requestTenantId;
}

// ── 启动日志 ──────────────────────────────────────────────────────────────

console.log(
  `[Deployment] 当前部署模式: ${deploymentConfig.mode.toUpperCase()}` +
    ` | 离线模式: ${deploymentConfig.offlineMode}` +
    ` | AI降级: ${deploymentConfig.aiFallbackEnabled}` +
    ` | 数据隔离: ${deploymentConfig.dataIsolation}`,
);
