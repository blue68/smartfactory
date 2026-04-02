import jwt from 'jsonwebtoken';

const JWT_SECRET =
  process.env.TEST_JWT_SECRET
  ?? process.env.JWT_SECRET
  ?? 'local-test-jwt-secret-key-2026-smartfactory-at-least-32-chars';

export interface TestTokenPayload {
  userId?: number;
  tenantId?: number;
  username?: string;
  roles?: string[];
}

/**
 * 生成测试用 JWT Token
 */
export function generateToken(overrides: TestTokenPayload = {}): string {
  return jwt.sign(
    {
      userId: overrides.userId ?? 1,
      tenantId: overrides.tenantId ?? 1,
      username: overrides.username ?? 'testuser',
      roles: overrides.roles ?? ['boss'],
    },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

/**
 * 生成 Authorization header 值
 */
export function authHeader(overrides: TestTokenPayload = {}): string {
  return `Bearer ${generateToken(overrides)}`;
}
