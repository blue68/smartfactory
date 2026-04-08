import bcrypt from 'bcrypt';
import { AppDataSource } from '../../config/database';
import { getRedisClient, RedisKeys, RedisTTL } from '../../config/redis';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';
import {
  signToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../middleware/auth';
import { accessControlService } from '../access-control/access-control.service';
import type {
  AccessScopeLevel,
  PermissionSnapshot,
} from '../access-control/access-control.config';

export interface LoginParams {
  loginMode?: 'tenant' | 'platform';
  username: string;
  password: string;
  tenantCode?: string;
}

interface AuthUserContext {
  id: number;
  username: string;
  realName: string;
  roles: string[];
  tenantId: number;
  tenantName: string;
  scopeLevel: AccessScopeLevel;
  originTenantId: number;
  contextTenantId: number | null;
}

/**
 * SEC-003: login/wechatLogin 不再在 body 中返回 refreshToken。
 * Refresh Token 由 Controller 层写入 HttpOnly Cookie。
 */
export interface LoginResult {
  accessToken: string;
  /**
   * 仅在 Service 内部使用，Controller 负责将其写入 HttpOnly Cookie，
   * 不得将此字段透传到 response body。
   */
  refreshToken: string;
  permissionSnapshot: PermissionSnapshot;
  user: AuthUserContext;
}

/**
 * refreshToken 刷新结果：返回新的 access token 及供 Cookie 更新的新 refresh token
 */
export interface RefreshResult {
  accessToken: string;
  /** 新 Refresh Token，Controller 负责更新 Cookie */
  refreshToken: string;
  permissionSnapshot: PermissionSnapshot;
}

export class AuthService {
  private toIdNumber(value: number | string | null | undefined): number {
    return Number(value ?? 0);
  }

  // ─────────────────────────────────────────────
  // 私有：Redis Refresh Token 操作
  // ─────────────────────────────────────────────

  /**
   * SEC-004: 将 jti 写入 Redis，同时维护用户级反向索引 Set
   * - rt:{jti}                   → "{userId}:{tenantId}"（单 token 存活标记）
   * - rt:user:{tenantId}:{userId} → Set<jti>（用户级反向索引，用于批量吊销）
   * Set 的 TTL 与单个 token 保持一致，每次写入时重置，确保 Set 不会永久驻留
   */
  private async registerRefreshJti(
    jti: string,
    userId: number,
    tenantId: number,
  ): Promise<void> {
    const redis = getRedisClient();
    const jtiKey = RedisKeys.refreshToken(jti);
    const setKey = RedisKeys.userRefreshTokenSet(tenantId, userId);

    const pipeline = redis.pipeline();
    // 写入单 token 标记
    pipeline.set(jtiKey, `${userId}:${tenantId}`, 'EX', RedisTTL.REFRESH_TOKEN);
    // 将 jti 加入用户级 Set，并重置 Set 的 TTL
    pipeline.sadd(setKey, jti);
    pipeline.expire(setKey, RedisTTL.REFRESH_TOKEN);
    await pipeline.exec();
  }

  /**
   * SEC-004: 检查 jti 是否存在（未被吊销）
   * 返回 true 表示有效，false 表示已吊销或不存在
   */
  private async isRefreshJtiValid(jti: string): Promise<boolean> {
    const redis = getRedisClient();
    const value = await redis.get(RedisKeys.refreshToken(jti));
    return value !== null;
  }

  /**
   * SEC-004: 删除单个 jti（登出或 token 旋转时吊销旧 token）
   * 同步从用户级 Set 中移除该 jti，保持反向索引一致性
   */
  private async revokeRefreshJti(
    jti: string,
    userId?: number,
    tenantId?: number,
  ): Promise<void> {
    const redis = getRedisClient();
    const pipeline = redis.pipeline();
    pipeline.del(RedisKeys.refreshToken(jti));
    if (userId !== undefined && tenantId !== undefined) {
      // 维护反向索引一致性
      pipeline.srem(RedisKeys.userRefreshTokenSet(tenantId, userId), jti);
    }
    await pipeline.exec();
  }

  /**
   * SEC-004: 批量吊销某用户在指定租户下的所有 Refresh Token
   * 通过反向索引 Set（rt:user:{tenantId}:{userId}）精准获取全部 jti，
   * 避免全库 SCAN 扫描，O(N) 其中 N = 该用户活跃 token 数量
   * 场景：修改密码、管理员强制下线所有设备等
   */
  async revokeAllRefreshTokens(userId: number, tenantId: number): Promise<number> {
    const redis = getRedisClient();
    const setKey = RedisKeys.userRefreshTokenSet(tenantId, userId);

    // 获取该用户所有活跃 jti
    const jtis = await redis.smembers(setKey);
    if (jtis.length === 0) {
      return 0;
    }

    // 批量删除所有 rt:{jti} key，再删除反向索引 Set 本身
    const jtiKeys = jtis.map((jti) => RedisKeys.refreshToken(jti));
    const pipeline = redis.pipeline();
    for (const key of jtiKeys) {
      pipeline.del(key);
    }
    pipeline.del(setKey);
    await pipeline.exec();

    console.info(
      `[AuthService] revokeAllRefreshTokens: userId=${userId}, tenantId=${tenantId}, revoked=${jtis.length}`,
    );
    return jtis.length;
  }

  // ─────────────────────────────────────────────
  // 公共：认证逻辑
  // ─────────────────────────────────────────────

  private async tableExists(tableName: string): Promise<boolean> {
    const [row] = await AppDataSource.query<Array<{ total: number }>>(
      `SELECT COUNT(*) AS total
         FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_name = ?`,
      [tableName],
    );
    return Number(row?.total ?? 0) > 0;
  }

  private async writePlatformContextAuditLog(params: {
    operatorId: number;
    operatorName: string;
    tenantId: number;
    action: 'switch_tenant' | 'exit_tenant_context';
    targetTenantId: number | null;
    targetTenantCode?: string | null;
    fromScopeLevel: AccessScopeLevel;
    toScopeLevel: AccessScopeLevel;
  }): Promise<void> {
    if (!(await this.tableExists('access_audit_logs'))) {
      return;
    }

    await AppDataSource.query(
      `INSERT INTO access_audit_logs
         (tenant_id, module, action, target_type, target_id, target_code, before_json, after_json, diff_json, operator_id, operator_name, trace_id, created_at)
       VALUES (?, 'platform_context', ?, 'tenant_context', ?, ?, ?, ?, ?, ?, ?, NULL, NOW(3))`,
      [
        params.tenantId,
        params.action,
        params.targetTenantId,
        params.targetTenantCode ?? null,
        JSON.stringify({ scopeLevel: params.fromScopeLevel }),
        JSON.stringify({ scopeLevel: params.toScopeLevel, targetTenantId: params.targetTenantId }),
        JSON.stringify({
          fromScopeLevel: params.fromScopeLevel,
          toScopeLevel: params.toScopeLevel,
          targetTenantId: params.targetTenantId,
        }),
        params.operatorId,
        params.operatorName,
      ],
    );
  }

  private async issueAuthResult(params: {
    userId: number;
    username: string;
    realName: string;
    roles: string[];
    tokenTenantId: number;
    tenantName: string;
    scopeLevel: AccessScopeLevel;
    originTenantId: number;
    contextTenantId: number | null;
  }): Promise<LoginResult> {
    const userId = this.toIdNumber(params.userId);
    const tokenTenantId = this.toIdNumber(params.tokenTenantId);
    const originTenantId = this.toIdNumber(params.originTenantId);
    const contextTenantId = params.contextTenantId == null
      ? null
      : this.toIdNumber(params.contextTenantId);
    const { roles } = params;
    const tokenPayload = {
      userId,
      tenantId: tokenTenantId,
      username: params.username,
      roles,
      scopeLevel: params.scopeLevel,
      originTenantId,
      contextTenantId,
    };

    const { token: refreshToken, jti } = signRefreshToken(userId, tokenTenantId, {
      scopeLevel: params.scopeLevel,
      originTenantId,
      contextTenantId,
    });

    await this.registerRefreshJti(jti, userId, originTenantId);

    return {
      accessToken: signToken(tokenPayload),
      refreshToken,
      permissionSnapshot: await accessControlService.buildPermissionSnapshot(
        tokenTenantId,
        roles,
        {
          scopeLevel: params.scopeLevel,
          originTenantId,
          contextTenantId,
        },
      ),
      user: {
        id: userId,
        username: params.username,
        realName: params.realName,
        roles,
        tenantId: tokenTenantId,
        tenantName: params.tenantName,
        scopeLevel: params.scopeLevel,
        originTenantId,
        contextTenantId,
      },
    };
  }

  /**
   * 账号密码登录
   * 查询链：tenants → users → user_role_assignments/user_roles → roles
   */
  async login(params: LoginParams): Promise<LoginResult> {
    if ((params.loginMode ?? 'tenant') === 'platform') {
      return this.platformLogin(params);
    }

    const db = AppDataSource;

    if (!params.tenantCode?.trim()) {
      throw new AppError('租户编码不能为空', ResponseCode.INVALID_PARAMS, 400);
    }

    // 1. 查租户
    const [tenant] = await db.query<Array<{ id: number; name: string; status: string }>>(
      'SELECT id, name, status FROM tenants WHERE code = ? LIMIT 1',
      [params.tenantCode.trim()],
    );
    if (!tenant) {
      throw AppError.notFound('租户不存在', ResponseCode.NOT_FOUND);
    }
    if (tenant.status !== 'active') {
      throw new AppError('租户账户已停用，请联系管理员', ResponseCode.FORBIDDEN, 403);
    }

    // 2. 查用户（参数化查询防 SQL 注入）
    const [user] = await db.query<
      Array<{ id: number; username: string; real_name: string; password_hash: string; status: string }>
    >(
      'SELECT id, username, real_name, password_hash, status FROM users WHERE tenant_id = ? AND username = ? LIMIT 1',
      [tenant.id, params.username],
    );
    if (!user) {
      throw new AppError('用户名或密码错误', ResponseCode.UNAUTHORIZED, 401);
    }
    if (user.status === 'locked') {
      throw new AppError('账号已被锁定，请联系管理员', ResponseCode.FORBIDDEN, 403);
    }
    if (user.status === 'inactive') {
      throw new AppError('账号已停用', ResponseCode.FORBIDDEN, 403);
    }

    // 3. 校验密码（含登录失败锁定机制 SEC M-001）
    const passwordMatch = await bcrypt.compare(params.password, user.password_hash);
    if (!passwordMatch) {
      // 递增 Redis 失败计数器，15 分钟窗口内超 5 次自动锁定
      const failKey = `login:fail:${tenant.id}:${user.id}`;
      const redis = getRedisClient();
      const fails = await redis.incr(failKey);
      await redis.expire(failKey, 15 * 60);
      if (fails >= 5) {
        await db.query('UPDATE users SET status = ? WHERE id = ?', ['locked', user.id]);
        throw new AppError('账号已因多次登录失败被锁定，请联系管理员', ResponseCode.FORBIDDEN, 403);
      }
      throw new AppError('用户名或密码错误', ResponseCode.UNAUTHORIZED, 401);
    }

    // 登录成功：清除失败计数
    const failKey = `login:fail:${tenant.id}:${user.id}`;
    await getRedisClient().del(failKey).catch(() => {});

    // 4. 查角色
    const roleCodes = await accessControlService.resolveUserRoleCodes(user.id, tenant.id);

    // 5. 更新最后登录时间（异步，不阻塞响应）
    db.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]).catch(
      (err) => console.error('[AuthService] 更新登录时间失败:', err),
    );

    // 6. 签发 Token
    return this.issueAuthResult({
      userId: user.id,
      username: user.username,
      realName: user.real_name,
      roles: roleCodes,
      tokenTenantId: tenant.id,
      tenantName: tenant.name,
      scopeLevel: 'tenant',
      originTenantId: tenant.id,
      contextTenantId: tenant.id,
    });
  }

  private async platformLogin(params: LoginParams): Promise<LoginResult> {
    const db = AppDataSource;
    const [user] = await db.query<
      Array<{ id: number; username: string; real_name: string; password_hash: string; status: string }>
    >(
      'SELECT id, username, real_name, password_hash, status FROM users WHERE tenant_id = 0 AND username = ? LIMIT 1',
      [params.username],
    );
    if (!user) {
      throw new AppError('用户名或密码错误', ResponseCode.UNAUTHORIZED, 401);
    }
    if (user.status === 'locked') {
      throw new AppError('账号已被锁定，请联系管理员', ResponseCode.FORBIDDEN, 403);
    }
    if (user.status === 'inactive') {
      throw new AppError('账号已停用', ResponseCode.FORBIDDEN, 403);
    }

    const passwordMatch = await bcrypt.compare(params.password, user.password_hash);
    if (!passwordMatch) {
      throw new AppError('用户名或密码错误', ResponseCode.UNAUTHORIZED, 401);
    }

    const roleCodes = await accessControlService.resolveUserRoleCodes(user.id, 0);
    if (!roleCodes.includes('platform_super_admin')) {
      throw new AppError('当前账号不允许使用平台登录', ResponseCode.FORBIDDEN, 403);
    }

    db.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]).catch(
      (err) => console.error('[AuthService] 更新平台登录时间失败:', err),
    );

    return this.issueAuthResult({
      userId: user.id,
      username: user.username,
      realName: user.real_name,
      roles: roleCodes,
      tokenTenantId: 0,
      tenantName: 'Platform',
      scopeLevel: 'platform',
      originTenantId: 0,
      contextTenantId: null,
    });
  }

  /**
   * 微信小程序 OpenID 登录
   */
  async wechatLogin(openid: string, tenantCode: string): Promise<LoginResult> {
    const db = AppDataSource;

    const [tenant] = await db.query<Array<{ id: number; name: string; status: string }>>(
      'SELECT id, name, status FROM tenants WHERE code = ? LIMIT 1',
      [tenantCode],
    );
    if (!tenant || tenant.status !== 'active') {
      throw AppError.notFound('租户不存在或已停用');
    }

    const [user] = await db.query<
      Array<{ id: number; username: string; real_name: string; status: string }>
    >(
      'SELECT id, username, real_name, status FROM users WHERE wechat_openid = ? AND tenant_id = ? LIMIT 1',
      [openid, tenant.id],
    );
    if (!user) {
      throw new AppError('该微信账号未绑定系统用户，请联系管理员', ResponseCode.NOT_FOUND, 404);
    }

    const roleCodes = await accessControlService.resolveUserRoleCodes(user.id, tenant.id);
    return this.issueAuthResult({
      userId: user.id,
      username: user.username,
      realName: user.real_name,
      roles: roleCodes,
      tokenTenantId: tenant.id,
      tenantName: tenant.name,
      scopeLevel: 'tenant',
      originTenantId: tenant.id,
      contextTenantId: tenant.id,
    });
  }

  /**
   * 刷新 Access Token
   * SEC-003: refreshToken 从 HttpOnly Cookie 中读取（由 Controller 传入）
   * SEC-004: 校验 jti 存在性、旋转 token（删旧写新）
   */
  async refreshToken(refreshTokenStr: string): Promise<RefreshResult> {
    // 1. 验证 JWT 签名及过期时间
    let payload: ReturnType<typeof verifyRefreshToken>;
    try {
      payload = verifyRefreshToken(refreshTokenStr);
    } catch {
      throw new AppError('刷新令牌无效或已过期', ResponseCode.UNAUTHORIZED, 401);
    }

    if (payload.type !== 'refresh' || !payload.jti) {
      throw new AppError('令牌类型错误', ResponseCode.UNAUTHORIZED, 401);
    }

    // 2. SEC-004: 检查 jti 是否已被吊销
    const isValid = await this.isRefreshJtiValid(payload.jti);
    if (!isValid) {
      throw new AppError('刷新令牌已被吊销，请重新登录', ResponseCode.UNAUTHORIZED, 401);
    }

    // 3. 查询用户是否仍然有效
    const db = AppDataSource;
    const originTenantId = this.toIdNumber(payload.originTenantId ?? payload.tenantId);
    const contextTenantId = this.toIdNumber(payload.contextTenantId ?? payload.tenantId);
    const scopeLevel = payload.scopeLevel ?? 'tenant';

    const [user] = await db.query<
      Array<{ id: number; username: string; real_name: string; tenant_id: number; status: string }>
    >(
      'SELECT id, username, real_name, tenant_id, status FROM users WHERE id = ? AND tenant_id = ? LIMIT 1',
      [payload.userId, originTenantId],
    );
    if (!user || user.status !== 'active') {
      // 用户失效，顺手吊销该 jti（含反向索引清理）
      await this.revokeRefreshJti(payload.jti, payload.userId, originTenantId);
      throw new AppError('用户不存在或已停用', ResponseCode.UNAUTHORIZED, 401);
    }

    // 4. SEC-004: 签发新 refresh token，旋转：先删旧 jti（含反向索引清理），再写新 jti
    const { token: newRefreshToken, jti: newJti } = signRefreshToken(user.id, contextTenantId, {
      scopeLevel,
      originTenantId,
      contextTenantId,
    });
    await this.revokeRefreshJti(payload.jti, user.id, originTenantId);
    await this.registerRefreshJti(newJti, user.id, originTenantId);

    const roleCodes = await accessControlService.resolveUserRoleCodes(user.id, originTenantId);

    return {
      accessToken: signToken({
        userId: this.toIdNumber(user.id),
        tenantId: contextTenantId,
        username: user.username,
        roles: roleCodes,
        scopeLevel,
        originTenantId,
        contextTenantId,
      }),
      refreshToken: newRefreshToken,
      permissionSnapshot: await accessControlService.buildPermissionSnapshot(
        contextTenantId,
        roleCodes,
        {
          scopeLevel,
          originTenantId,
          contextTenantId,
        },
      ),
    };
  }

  async switchTenantContext(params: {
    userId: number;
    username: string;
    originTenantId: number;
    roles: string[];
    scopeLevel: AccessScopeLevel;
    targetTenantId: number;
  }): Promise<LoginResult> {
    if (params.originTenantId !== 0 || !params.roles.includes('platform_super_admin')) {
      throw new AppError('仅 platform_super_admin 可切换租户上下文', ResponseCode.FORBIDDEN, 403);
    }

    const [user] = await AppDataSource.query<
      Array<{ id: number; username: string; real_name: string; status: string }>
    >(
      'SELECT id, username, real_name, status FROM users WHERE id = ? AND tenant_id = 0 LIMIT 1',
      [params.userId],
    );
    if (!user || user.status !== 'active') {
      throw new AppError('平台账号不存在或已停用', ResponseCode.UNAUTHORIZED, 401);
    }

    const [tenant] = await AppDataSource.query<Array<{ id: number; code: string; name: string; status: string }>>(
      'SELECT id, code, name, status FROM tenants WHERE id = ? LIMIT 1',
      [params.targetTenantId],
    );
    if (!tenant) {
      throw AppError.notFound('目标租户不存在', ResponseCode.NOT_FOUND);
    }
    if (tenant.status !== 'active') {
      throw new AppError('目标租户已停用，无法进入', ResponseCode.FORBIDDEN, 403);
    }

    const roleCodes = await accessControlService.resolveUserRoleCodes(user.id, 0);
    if (!roleCodes.includes('platform_super_admin')) {
      throw new AppError('当前账号已不具备平台超级管理员权限', ResponseCode.FORBIDDEN, 403);
    }

    await this.writePlatformContextAuditLog({
      operatorId: user.id,
      operatorName: user.real_name || user.username,
      tenantId: tenant.id,
      action: 'switch_tenant',
      targetTenantId: tenant.id,
      targetTenantCode: tenant.code,
      fromScopeLevel: params.scopeLevel,
      toScopeLevel: 'tenant',
    });

    return this.issueAuthResult({
      userId: user.id,
      username: user.username,
      realName: user.real_name,
      roles: roleCodes,
      tokenTenantId: tenant.id,
      tenantName: tenant.name,
      scopeLevel: 'tenant',
      originTenantId: 0,
      contextTenantId: tenant.id,
    });
  }

  async exitTenantContext(params: {
    userId: number;
    originTenantId: number;
    contextTenantId: number | null;
    scopeLevel: AccessScopeLevel;
  }): Promise<LoginResult> {
    if (params.originTenantId !== 0) {
      throw new AppError('仅平台账号支持退出租户上下文', ResponseCode.FORBIDDEN, 403);
    }

    const [user] = await AppDataSource.query<
      Array<{ id: number; username: string; real_name: string; status: string }>
    >(
      'SELECT id, username, real_name, status FROM users WHERE id = ? AND tenant_id = 0 LIMIT 1',
      [params.userId],
    );
    if (!user || user.status !== 'active') {
      throw new AppError('平台账号不存在或已停用', ResponseCode.UNAUTHORIZED, 401);
    }

    const roleCodes = await accessControlService.resolveUserRoleCodes(user.id, 0);
    if (!roleCodes.includes('platform_super_admin')) {
      throw new AppError('当前账号已不具备平台超级管理员权限', ResponseCode.FORBIDDEN, 403);
    }

    await this.writePlatformContextAuditLog({
      operatorId: user.id,
      operatorName: user.real_name || user.username,
      tenantId: params.contextTenantId ?? 0,
      action: 'exit_tenant_context',
      targetTenantId: params.contextTenantId,
      fromScopeLevel: params.scopeLevel,
      toScopeLevel: 'platform',
    });

    return this.issueAuthResult({
      userId: user.id,
      username: user.username,
      realName: user.real_name,
      roles: roleCodes,
      tokenTenantId: 0,
      tenantName: 'Platform',
      scopeLevel: 'platform',
      originTenantId: 0,
      contextTenantId: null,
    });
  }

  /**
   * 登出
   * SEC-003: 清除 Cookie 由 Controller 负责
   * SEC-004: 吊销 Redis 中的 jti
   */
  async logout(refreshTokenStr: string): Promise<void> {
    try {
      const payload = verifyRefreshToken(refreshTokenStr);
      if (payload.jti) {
        const originTenantId = payload.originTenantId ?? payload.tenantId;
        // 传入 userId/tenantId，同步清理反向索引
        await this.revokeRefreshJti(payload.jti, payload.userId, originTenantId);
      }
    } catch {
      // Token 已过期或无效，无需处理（Cookie 仍会被 Controller 清除）
      console.warn('[AuthService] logout: refresh token 解析失败，跳过 Redis 吊销');
    }
  }

  /**
   * 修改密码
   * 1. 验证旧密码正确性
   * 2. 校验新密码与旧密码不能相同
   * 3. bcrypt hash 新密码后持久化到 DB
   * 4. 批量吊销该用户所有 Refresh Token（SEC-004 要求）
   *    — 调用方（Controller）负责清除当前设备 Cookie
   */
  async changePassword(
    userId: number,
    tenantId: number,
    oldPassword: string,
    newPassword: string,
  ): Promise<{ revokedCount: number }> {
    const db = AppDataSource;

    // 1. 查询当前用户
    const [user] = await db.query<
      Array<{ id: number; password_hash: string; status: string }>
    >(
      'SELECT id, password_hash, status FROM users WHERE id = ? AND tenant_id = ? LIMIT 1',
      [userId, tenantId],
    );
    if (!user || user.status !== 'active') {
      throw new AppError('用户不存在或已停用', ResponseCode.UNAUTHORIZED, 401);
    }

    // 2. 验证旧密码
    const oldPasswordMatch = await bcrypt.compare(oldPassword, user.password_hash);
    if (!oldPasswordMatch) {
      throw new AppError('旧密码不正确', ResponseCode.INVALID_PARAMS, 400);
    }

    // 3. 新密码不能与旧密码相同
    const sameAsOld = await bcrypt.compare(newPassword, user.password_hash);
    if (sameAsOld) {
      throw new AppError('新密码不能与旧密码相同', ResponseCode.INVALID_PARAMS, 400);
    }

    // 3.5 密码复杂度校验（SEC M-007）
    if (newPassword.length < 8) {
      throw new AppError('新密码至少8位', ResponseCode.INVALID_PARAMS, 400);
    }
    if (!/[A-Z]/.test(newPassword)) {
      throw new AppError('新密码必须包含大写字母', ResponseCode.INVALID_PARAMS, 400);
    }
    if (!/[a-z]/.test(newPassword)) {
      throw new AppError('新密码必须包含小写字母', ResponseCode.INVALID_PARAMS, 400);
    }
    if (!/[0-9]/.test(newPassword)) {
      throw new AppError('新密码必须包含数字', ResponseCode.INVALID_PARAMS, 400);
    }
    if (!/[^A-Za-z0-9]/.test(newPassword)) {
      throw new AppError('新密码必须包含特殊字符', ResponseCode.INVALID_PARAMS, 400);
    }

    // 4. hash 新密码（cost factor 12）
    const newPasswordHash = await bcrypt.hash(newPassword, 12);

    // 5. 持久化新密码
    await db.query(
      'UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ? AND tenant_id = ?',
      [newPasswordHash, userId, tenantId],
    );

    // 6. SEC-004: 批量吊销该用户在该租户下的所有 Refresh Token
    const revokedCount = await this.revokeAllRefreshTokens(userId, tenantId);

    console.info(
      `[AuthService] changePassword: userId=${userId}, tenantId=${tenantId}, revokedTokens=${revokedCount}`,
    );

    return { revokedCount };
  }
}

export const authService = new AuthService();
