/**
 * 环境无关集成回归（本地进程内）— 三单匹配差异确认
 *
 * 目标：
 * - 不依赖 TEST_API_URL / 外部容器 / 预置数据库数据
 * - 使用 request(app) + AppDataSource.query mock + 内存 seed
 * - 验证 DEF-004：已匹配记录不可重复确认
 *
 * 维护约定：
 * - 本文件承接原 purchase.api.test.ts 中 DEF-004 专项断言，
 *   外部链路文件仅保留业务流验证（TC-3WM-005 / TC-3WM-006）。
 */

import request from 'supertest';
import type { Express } from 'express';
import jwt from 'jsonwebtoken';
import { AppDataSource } from '../../src/config/database';

jest.mock('../../src/shared/queue-service', () => ({
  queueService: {
    addJob: jest.fn().mockResolvedValue(null),
    getJobStatus: jest.fn().mockResolvedValue(null),
    onFallback: jest.fn(),
    getQueue: jest.fn(),
    isBullMQAvailable: jest.fn().mockReturnValue(false),
    close: jest.fn().mockResolvedValue(undefined),
  },
}));

type MatchStatus = 'pending' | 'matched' | 'qty_diff' | 'price_diff' | 'price_warning';

interface MatchRecord {
  id: number;
  tenant_id: number;
  match_status: MatchStatus;
  confirmed_by: number | null;
  diff_reason: string | null;
  diff_notes: string | null;
}

function makeAuthHeader(role: 'purchaser' | 'worker'): { Authorization: string } {
  // 与 authMiddleware 默认值保持一致，避免依赖外部环境变量。
  const secret = process.env.JWT_SECRET ?? 'change-me-in-production';
  const token = jwt.sign(
    {
      userId: role === 'purchaser' ? 99002 : 99005,
      tenantId: 9999,
      username: `local_${role}`,
      roles: [role],
    },
    secret,
    { expiresIn: '1h' },
  );
  return { Authorization: `Bearer ${token}` };
}

const SELECT_SQL_PREFIX =
  'SELECT id, match_status FROM three_way_match_records WHERE id = ? AND tenant_id = ? LIMIT 1';
const UPDATE_SQL_PREFIX =
  'UPDATE three_way_match_records';

describe('采购模块（本地进程内）— confirmDiff 回归', () => {
  let app: Express;
  const store = new Map<number, MatchRecord>();
  let warnSpy: jest.SpyInstance;

  beforeAll(async () => {
    // 避免 upload.routes.ts 默认写 /app/uploads 导致测试环境权限问题
    process.env.UPLOAD_DIR = process.env.UPLOAD_DIR ?? '/tmp/uploads';
    const mod = await import('../../src/app');
    app = mod.default;
  });

  beforeEach(() => {
    store.clear();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    // seed: tenant=9999 与 testAuth.ts 生成 token 保持一致
    store.set(90001, {
      id: 90001,
      tenant_id: 9999,
      match_status: 'matched',
      confirmed_by: 1,
      diff_reason: 'supplier_short',
      diff_notes: 'already confirmed',
    });
    store.set(90002, {
      id: 90002,
      tenant_id: 9999,
      match_status: 'qty_diff',
      confirmed_by: null,
      diff_reason: null,
      diff_notes: null,
    });

    jest.spyOn(AppDataSource, 'query').mockImplementation(
      async (sql: string, params?: unknown[]) => {
        const normSql = sql.replace(/\s+/g, ' ').trim();

        if (normSql.startsWith(SELECT_SQL_PREFIX)) {
          const [id, tenantId] = (params ?? []) as [number, number];
          const row = store.get(Number(id));
          if (!row || row.tenant_id !== Number(tenantId)) return [];
          return [{ id: row.id, match_status: row.match_status }];
        }

        if (normSql.startsWith(UPDATE_SQL_PREFIX)) {
          const [confirmedBy, diffReason, diffNotes, _updatedBy, id, tenantId] =
            (params ?? []) as [number, string, string, number, number, number];
          const row = store.get(Number(id));
          if (!row || row.tenant_id !== Number(tenantId)) return [];
          row.match_status = 'matched';
          row.confirmed_by = Number(confirmedBy);
          row.diff_reason = diffReason;
          row.diff_notes = diffNotes;
          return [{ affectedRows: 1 }];
        }

        throw new Error(`Unexpected SQL in local integration test: ${normSql}`);
      },
    );
  });

  afterEach(() => {
    warnSpy.mockRestore();
    jest.restoreAllMocks();
  });

  test('DEF-004：已 matched 记录再次确认应返回 400 / code=1001', async () => {
    const res = await request(app)
      .post('/api/purchase/three-way-match/90001/confirm')
      .set(makeAuthHeader('purchaser'))
      .send({ diffReason: 'other', diffNotes: 'repeat confirm' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(1001);
    expect(String(res.body.message)).toMatch(/已完成匹配|重复确认/);
  });

  test('非 matched 记录确认成功后状态应变为 matched', async () => {
    const res = await request(app)
      .post('/api/purchase/three-way-match/90002/confirm')
      .set(makeAuthHeader('purchaser'))
      .send({ diffReason: 'receipt_miss', diffNotes: 'confirm ok' });

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);

    const row = store.get(90002);
    expect(row?.match_status).toBe('matched');
    expect(row?.diff_reason).toBe('receipt_miss');
  });

  test('非采购员角色无权确认差异（403）', async () => {
    const res = await request(app)
      .post('/api/purchase/three-way-match/90002/confirm')
      .set(makeAuthHeader('worker'))
      .send({ diffReason: 'other', diffNotes: 'forbidden check' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe(1003);
  });
});
