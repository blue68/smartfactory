/**
 * 全局测试环境初始化
 *
 * 职责：
 * - 设置测试环境变量
 * - 确保测试数据库配置就绪
 * - 输出测试环境摘要
 */

export default async function globalSetup(): Promise<void> {
  // 测试环境变量
  process.env.NODE_ENV = 'test';
  process.env.DB_HOST = process.env.TEST_DB_HOST ?? 'localhost';
  process.env.DB_PORT = process.env.TEST_DB_PORT ?? '3306';
  process.env.DB_NAME = process.env.TEST_DB_NAME ?? 'smartfactory_test';
  process.env.DB_USER = process.env.TEST_DB_USER ?? 'root';
  process.env.DB_PASSWORD = process.env.TEST_DB_PASSWORD ?? 'test123';
  process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1';
  process.env.JWT_SECRET = 'test-jwt-secret-32chars-for-testing!!';

  console.info('[Test Setup] 测试环境初始化完成');
  console.info(`[Test Setup] DB: ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);
  console.info(`[Test Setup] Redis: ${process.env.REDIS_URL}`);
}
