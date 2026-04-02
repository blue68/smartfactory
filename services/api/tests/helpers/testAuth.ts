/**
 * 测试认证工具
 *
 * 为不同角色生成有效的 JWT token，用于集成测试和 E2E 测试
 * 不依赖真实数据库，直接签发测试专用 token
 */

import jwt from 'jsonwebtoken';

// 默认对齐仓库根目录 .env 的本地联调配置，避免 E2E/Integration 直连 localhost:3000 时
// 因 Jest 未主动加载 .env 而生成错误签名的 token。需要覆盖时仍可显式设置环境变量。
const TEST_JWT_SECRET =
  process.env.TEST_JWT_SECRET
  ?? process.env.JWT_SECRET
  ?? 'local-test-jwt-secret-key-2026-smartfactory-at-least-32-chars';
const TEST_TENANT_ID = Number(process.env.TEST_TENANT_ID ?? '9999');

export type TestRole = 'boss' | 'purchaser' | 'warehouse' | 'supervisor' | 'worker' | 'qc' | 'sales';

interface TestTokenPayload {
  userId: number;
  username: string;
  roles: TestRole[];
  tenantId: number;
}

const ROLE_USER_MAP: Record<TestRole, { userId: number; username: string }> = {
  boss: { userId: 99001, username: 'test_boss' },
  purchaser: { userId: 99002, username: 'test_purchaser' },
  warehouse: { userId: 99003, username: 'test_warehouse' },
  supervisor: { userId: 99004, username: 'test_supervisor' },
  worker: { userId: 99005, username: 'test_worker' },
  qc: { userId: 99006, username: 'test_qc' },
  sales: { userId: 99007, username: 'test_sales' },
};

/**
 * 为指定角色生成测试 JWT token
 * @param role 角色类型
 * @param expiresIn token 有效期（默认1小时）
 */
export function generateTestToken(
  role: TestRole,
  expiresIn: string | number = '1h',
): string {
  const user = ROLE_USER_MAP[role];
  const payload: TestTokenPayload = {
    userId: user.userId,
    username: user.username,
    roles: [role],
    tenantId: TEST_TENANT_ID,
  };
  return jwt.sign(payload, TEST_JWT_SECRET, { expiresIn } as jwt.SignOptions);
}

/**
 * 生成已过期的 token（用于测试 Token 失效场景）
 */
export function generateExpiredToken(role: TestRole): string {
  const user = ROLE_USER_MAP[role];
  const payload: TestTokenPayload = {
    userId: user.userId,
    username: user.username,
    roles: [role],
    tenantId: TEST_TENANT_ID,
  };
  // 过期时间设为 1 秒前
  return jwt.sign(payload, TEST_JWT_SECRET, { expiresIn: -1 } as jwt.SignOptions);
}

/**
 * 返回用于 Supertest 请求的 Authorization header 对象
 */
export function authHeader(role: TestRole): { Authorization: string } {
  return { Authorization: `Bearer ${generateTestToken(role)}` };
}

/**
 * 获取角色对应的用户 ID
 */
export function getUserId(role: TestRole): number {
  return ROLE_USER_MAP[role].userId;
}
