/**
 * 测试数据库工具
 *
 * 提供：
 * - 测试数据库连接池（独立的 test DB，与生产隔离）
 * - 事务回滚辅助（每个测试用例结束后回滚，保持隔离）
 * - 表数据清理工具
 */

import mysql, { Pool, PoolConnection } from 'mysql2/promise';

let pool: Pool | null = null;

export function getTestPool(): Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? '3306'),
      database: process.env.DB_NAME ?? 'smartfactory_test',
      user: process.env.DB_USER ?? 'root',
      password: process.env.DB_PASSWORD ?? 'test123',
      connectionLimit: 10,
      waitForConnections: true,
      timezone: '+08:00',
    });
  }
  return pool;
}

/**
 * 在事务中执行测试，执行完毕后自动回滚
 * 保证测试用例之间数据互不干扰
 */
export async function withTestTransaction<T>(
  fn: (conn: PoolConnection) => Promise<T>,
): Promise<T> {
  const conn = await getTestPool().getConnection();
  await conn.beginTransaction();
  try {
    const result = await fn(conn);
    // 测试用例结束后回滚，保持隔离
    await conn.rollback();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * 清空指定表的测试数据（仅清除 tenant_id=9999 的测试数据）
 */
export async function cleanTestTenantData(tables: string[]): Promise<void> {
  const conn = await getTestPool().getConnection();
  try {
    for (const table of tables) {
      await conn.execute(`DELETE FROM \`${table}\` WHERE tenant_id = 9999`);
    }
  } finally {
    conn.release();
  }
}

/**
 * 执行原始 SQL（测试专用）
 */
export async function testQuery<T = any>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const [rows] = await getTestPool().execute<mysql.RowDataPacket[]>(sql, params);
  return rows as T[];
}

/**
 * 关闭测试连接池
 */
export async function closeTestPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
