# 智造管家 部署手册

版本：v1.0 | 更新日期：2026-03-11

---

## 目录

1. [环境要求](#1-环境要求)
2. [快速部署（5 分钟）](#2-快速部署5-分钟)
3. [环境变量说明](#3-环境变量说明)
4. [数据备份与恢复](#4-数据备份与恢复)
5. [日常运维命令](#5-日常运维命令)
6. [常见问题排查](#6-常见问题排查)
7. [升级流程](#7-升级流程)

---

## 1. 环境要求

### 硬件（最低配置，面向 15-30 人工厂）

| 资源 | 最低 | 推荐 |
|------|------|------|
| CPU  | 2 核 | 4 核 |
| 内存 | 4 GB | 8 GB |
| 磁盘 | 50 GB SSD | 100 GB SSD |
| 网络 | 局域网 100 Mbps | 局域网 1 Gbps |

### 软件

| 软件 | 版本要求 | 说明 |
|------|----------|------|
| Docker | 24.0+ | [安装文档](https://docs.docker.com/engine/install/) |
| Docker Compose | 2.20+ | Docker Desktop 已内置 |
| 操作系统 | Ubuntu 22.04 / CentOS 8+ / macOS 13+ | Windows 需使用 WSL2 |

检查版本：

```bash
docker --version
docker compose version
```

---

## 2. 快速部署（5 分钟）

### 第一步：获取代码

```bash
git clone https://github.com/your-org/smart-factory-agent.git
cd smart-factory-agent
```

### 第二步：配置环境变量

```bash
cp .env.example .env
```

用文本编辑器打开 `.env`，修改以下必填项（搜索 `CHANGE_ME`）：

```bash
# 必须修改的 4 个变量
DB_ROOT_PASSWORD=your_strong_root_password
DB_PASS=your_strong_db_password
REDIS_PASSWORD=your_strong_redis_password
JWT_SECRET=your_random_jwt_secret_at_least_32_chars
```

生成随机密钥的命令：

```bash
openssl rand -base64 32
```

### 第三步：启动服务

```bash
docker compose up -d
```

首次启动会自动拉取镜像、构建服务，约需 3-5 分钟，请耐心等待。

### 第四步：验证服务状态

```bash
# 查看所有容器状态（应全部显示 healthy）
docker compose ps

# 验证 API 健康检查
curl http://localhost:3000/health

# 打开浏览器访问
open http://localhost:80
```

所有容器状态为 `healthy` 即表示部署成功。

---

## 3. 环境变量说明

| 变量名 | 必填 | 默认值 | 说明 |
|--------|------|--------|------|
| `APP_NAME` | 否 | 智造管家 | 应用显示名称 |
| `WEB_PORT` | 否 | 80 | Web 访问端口 |
| `LOG_LEVEL` | 否 | info | 日志级别：error/warn/info/debug |
| `DB_ROOT_PASSWORD` | 是 | — | MySQL root 密码，仅用于初始化 |
| `DB_NAME` | 否 | smart_factory | 数据库名称 |
| `DB_USER` | 否 | sf_app | 数据库用户名 |
| `DB_PASS` | 是 | — | 数据库密码 |
| `DB_POOL_SIZE` | 否 | 10 | 数据库连接池大小 |
| `REDIS_PASSWORD` | 是 | — | Redis 密码 |
| `JWT_SECRET` | 是 | — | JWT 签名密钥（至少 32 位） |
| `JWT_EXPIRES_IN` | 否 | 7d | 登录 Token 有效期 |
| `AI_ENGINE_URL` | 否 | 空 | AI 引擎地址（Phase 2 启用） |
| `OPENAI_API_KEY` | 否 | 空 | OpenAI API Key（Phase 2） |

---

## 4. 数据备份与恢复

### 4.1 手动备份数据库

```bash
# 备份整个数据库（推荐每天执行一次）
docker exec sf_mysql mysqldump \
  -u root -p"${DB_ROOT_PASSWORD}" \
  --single-transaction \
  --routines \
  --triggers \
  smart_factory > backup_$(date +%Y%m%d_%H%M%S).sql

# 示例：备份并压缩
docker exec sf_mysql mysqldump \
  -u root -p"${DB_ROOT_PASSWORD}" \
  --single-transaction smart_factory \
  | gzip > backup_$(date +%Y%m%d).sql.gz
```

### 4.2 恢复数据库

```bash
# 从备份文件恢复（会覆盖现有数据，请谨慎操作）
gunzip < backup_20260311.sql.gz \
  | docker exec -i sf_mysql mysql \
    -u root -p"${DB_ROOT_PASSWORD}" smart_factory
```

### 4.3 自动备份（定时任务）

在服务器上添加 crontab 定时任务：

```bash
crontab -e
```

添加以下内容（每天凌晨 2 点备份，保留最近 30 份）：

```cron
0 2 * * * cd /path/to/smart-factory-agent && \
  docker exec sf_mysql mysqldump -u root -p"$(grep DB_ROOT_PASSWORD .env | cut -d= -f2)" \
  --single-transaction smart_factory | gzip > backups/db_$(date +\%Y\%m\%d).sql.gz && \
  ls -t backups/db_*.sql.gz | tail -n +31 | xargs rm -f
```

### 4.4 备份 Redis 数据

Redis 已配置 AOF 持久化，数据自动保存在 Docker 卷中。如需手动触发快照：

```bash
docker exec sf_redis redis-cli -a "${REDIS_PASSWORD}" BGSAVE
```

### 4.5 查看 Docker 卷位置

```bash
docker volume inspect smart-factory-agent_mysql_data
```

---

## 5. 日常运维命令

### 服务管理

```bash
# 启动所有服务
docker compose up -d

# 停止所有服务（数据保留）
docker compose down

# 停止并删除所有数据（谨慎！）
docker compose down -v

# 重启单个服务
docker compose restart api
docker compose restart web

# 查看服务状态
docker compose ps
```

### 日志查看

```bash
# 查看所有服务日志（实时）
docker compose logs -f

# 查看单个服务日志（最近 100 行）
docker compose logs --tail=100 api
docker compose logs --tail=100 mysql
docker compose logs --tail=100 redis

# 查看 Nginx 访问日志
docker exec sf_web cat /var/log/nginx/access.log
```

### 进入容器调试

```bash
# 进入 API 容器
docker exec -it sf_api sh

# 进入 MySQL 容器执行 SQL
docker exec -it sf_mysql mysql -u root -p

# 进入 Redis 容器
docker exec -it sf_redis redis-cli -a "${REDIS_PASSWORD}"
```

### 资源监控

```bash
# 查看容器资源占用（CPU / 内存）
docker stats

# 查看磁盘占用
docker system df
```

---

## 6. 常见问题排查

### 问题 1：容器启动后状态一直是 starting

**原因**：依赖服务（MySQL/Redis）还未就绪，API 在等待健康检查通过。

**处理**：
```bash
# 查看 MySQL 启动日志
docker compose logs mysql

# MySQL 首次启动初始化约需 30 秒，正常等待即可
# 如超过 2 分钟未就绪，检查 DB_ROOT_PASSWORD 是否含特殊字符
```

### 问题 2：API 容器报 "数据库连接失败"

**原因**：多为环境变量配置错误。

**处理**：
```bash
# 1. 检查环境变量是否正确加载
docker exec sf_api env | grep DB_

# 2. 手动测试数据库连接
docker exec sf_mysql mysql -u sf_app -p"${DB_PASS}" smart_factory -e "SELECT 1;"
```

### 问题 3：80 端口被占用

**处理**：修改 `.env` 中的 `WEB_PORT`：
```bash
WEB_PORT=8080
docker compose up -d web
```

### 问题 4：`docker compose up` 提示 "No such file: .env"

**处理**：
```bash
cp .env.example .env
# 然后编辑 .env 修改 CHANGE_ME 占位值
```

### 问题 5：磁盘空间不足

**处理**：
```bash
# 清理未使用的 Docker 资源（镜像、容器、网络）
docker system prune -f

# 查看各卷占用
docker system df -v
```

### 问题 6：JWT_SECRET 安全警告

如果日志中出现 JWT 相关警告，说明 `JWT_SECRET` 长度不足 32 位。

```bash
# 重新生成并更新 .env
openssl rand -base64 48
# 修改 .env 中的 JWT_SECRET 后重启 API
docker compose restart api
```

---

## 7. 升级流程

### 标准升级步骤

```bash
# 1. 备份数据库（必须）
docker exec sf_mysql mysqldump \
  -u root -p"${DB_ROOT_PASSWORD}" \
  --single-transaction smart_factory \
  > backup_before_upgrade_$(date +%Y%m%d).sql

# 2. 拉取最新代码
git pull origin main

# 3. 重新构建镜像
docker compose build --no-cache

# 4. 滚动重启服务（先后端，再前端，减少停机时间）
docker compose up -d --no-deps api
# 等待 API 健康检查通过
sleep 10
docker compose up -d --no-deps web

# 5. 验证升级结果
docker compose ps
curl http://localhost/health
```

### 回滚步骤

如升级后出现异常，快速回滚：

```bash
# 回滚到上一个 Git 版本
git log --oneline -5          # 查看最近提交，找到目标版本的 commit hash
git checkout <commit_hash>

# 重新构建并启动
docker compose build --no-cache
docker compose up -d

# 如需恢复数据库
gunzip < backup_before_upgrade_20260311.sql \
  | docker exec -i sf_mysql mysql -u root -p"${DB_ROOT_PASSWORD}" smart_factory
```

---

## 附录：目录结构说明

```
smart-factory-agent/
├── docker-compose.yml          # 服务编排
├── .env.example                # 环境变量模板
├── .env                        # 实际配置（不提交到 Git）
├── services/
│   ├── api/
│   │   └── Dockerfile          # 后端多阶段构建
│   └── web/
│       ├── Dockerfile          # 前端多阶段构建
│       └── nginx.conf          # Nginx 配置
└── infra/
    └── db/
        └── init.sql            # 数据库初始化脚本
```

---

如有问题请联系运维团队或提交 Issue。
