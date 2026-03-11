import { DataSource } from 'typeorm';

/**
 * TypeORM 数据源配置
 * 连接参数从环境变量读取，私有化部署与 SaaS 模式共用同一套代码
 */
export const AppDataSource = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 3306),
  username: process.env.DB_USER ?? 'root',
  password: process.env.DB_PASS ?? '',
  database: process.env.DB_NAME ?? 'smart_factory',
  charset: 'utf8mb4',
  timezone: '+08:00',
  // 生产环境不自动同步，仅用迁移脚本
  synchronize: false,
  logging: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'],
  entities: [__dirname + '/../modules/**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/../migrations/*{.ts,.js}'],
  poolSize: Number(process.env.DB_POOL_SIZE ?? 10),
  connectorPackage: 'mysql2',
  extra: {
    // mysql2 连接池额外配置
    connectionLimit: Number(process.env.DB_POOL_SIZE ?? 10),
    waitForConnections: true,
    queueLimit: 0,
  },
});

/**
 * 初始化数据库连接，带重试逻辑
 */
export async function initDatabase(retries = 5): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await AppDataSource.initialize();
      console.log('[DB] 数据库连接成功');
      return;
    } catch (err) {
      console.error(`[DB] 连接失败（第${attempt}次）:`, (err as Error).message);
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
}
