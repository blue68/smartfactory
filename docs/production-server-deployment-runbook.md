[artifact:DeploymentPlan]
status: READY
owner: devops-engineer
scope:
- 为新生产服务器提供基于 `release-2026-04-14-1` 的首次部署与后续升级运行手册
- 提供可直接执行的部署脚本、systemd 开机自启安装脚本与正式环境核对口径
inputs:
- `docker-compose.yml`
- `docker-compose.prod.yml`
- `.env.example`
- `infra/db/migrate.sh`
- `docs/consumable-fixed-asset-final-release-checklist.md`
- `docs/consumable-fixed-asset-deployment-plan.md`
handoff_to:
- devops-engineer
- engineering-manager
- senior-qa-engineer
deliverables:
- 新服务器首次部署步骤
- 后续升级步骤
- systemd 开机自启安装方式
- 回滚与运维命令清单
risks:
- 若正式环境 `.env` 未正确配置 OSS 参数，上传功能会在生产链路失败
- 若服务器缺少出站网络或 Docker Build 依赖拉取权限，首次构建会阻塞
exit_criteria:
- 发布执行人可只依赖本页与 `scripts/deploy-prod.sh` 完成新服务器部署与升级

precheck:
- 确认服务器已安装 `git`、`docker`、`docker compose`
- 确认 80/443 端口对外开放，3307/6379 不对公网开放
- 确认仓库目标版本为 `release-2026-04-14-1`
- 确认正式环境 `.env` 中 `FILE_STORAGE_DRIVER=oss`
- 确认 OSS 参数 `OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET / OSS_BUCKET / OSS_ENDPOINT / OSS_PATH_PREFIX` 已准备
- 确认数据库备份位置、域名、HTTPS 证书方案已准备

steps:
- 首次拉取代码并切到发布 tag：
  ```bash
  git clone <repo-url> /opt/smartfactory
  cd /opt/smartfactory
  git fetch --tags
  git checkout release-2026-04-14-1
  ```
- 复制环境变量模板并填写正式环境参数：
  ```bash
  cp .env.example .env
  ```
- 推荐至少填写以下变量：
  ```env
  WEB_PORT=80
  DB_ROOT_PASSWORD=<strong-password>
  DB_NAME=smart_factory
  DB_USER=sf_app
  DB_PASS=<strong-password>
  REDIS_PASSWORD=<strong-password>
  JWT_SECRET=<32+-chars>
  JWT_REFRESH_SECRET=<32+-chars-and-different>
  CORS_ORIGINS=https://<your-domain>
  FILE_STORAGE_DRIVER=oss
  OSS_ACCESS_KEY_ID=<ak>
  OSS_ACCESS_KEY_SECRET=<sk>
  OSS_BUCKET=<bucket>
  OSS_ENDPOINT=<endpoint>
  OSS_PATH_PREFIX=smartfactory
  ```
- 在服务器执行一键部署脚本：
  ```bash
  cd /opt/smartfactory
  bash scripts/deploy-prod.sh release-2026-04-14-1
  ```
- 部署完成后按一页式清单复烟：
  ```bash
  less docs/consumable-fixed-asset-final-release-checklist.md
  ```
- 若需要开机自启，在服务器执行：
  ```bash
  cd /opt/smartfactory
  sudo bash scripts/install-systemd-service.sh /opt/smartfactory
  ```

rollback:
- 回滚到上一个稳定 tag：
  ```bash
  git fetch --tags
  git checkout <previous-stable-tag>
  bash scripts/deploy-prod.sh <previous-stable-tag>
  ```
- 若只是 Web 出现页面级 blocker，可优先回滚到上一版代码并重新执行 `deploy-prod.sh`
- 若迁移后出现 blocker，先回滚应用，再按既有数据库备份恢复数据

monitoring:
- `docker compose -f docker-compose.yml -f docker-compose.prod.yml ps`
- `docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f api`
- `docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f web`
- `curl http://127.0.0.1:\${WEB_PORT}/health`
- 重点关注 `/api/upload`、`/api/upload/files/:id/content`、`/purchase/*`、`/consumables/issues`、`/assets/acceptance`、`/assets/ledger` 的 4xx/5xx

owner:
- devops-engineer

## 1. 推荐目录

```text
/opt/smartfactory
├── .env
├── docker-compose.yml
├── docker-compose.prod.yml
├── scripts/deploy-prod.sh
└── scripts/install-systemd-service.sh
```

## 2. 首次部署

```bash
sudo mkdir -p /opt
sudo chown "$USER":"$USER" /opt

git clone <repo-url> /opt/smartfactory
cd /opt/smartfactory
git fetch --tags
git checkout release-2026-04-14-1
cp .env.example .env
vim .env

bash scripts/deploy-prod.sh release-2026-04-14-1
```

## 3. 后续升级

```bash
cd /opt/smartfactory
git fetch origin --tags
bash scripts/deploy-prod.sh release-2026-04-14-1
```

如需升级到新版本，替换最后一个参数即可，例如：

```bash
bash scripts/deploy-prod.sh release-2026-04-20-1
```

## 4. 常用运维命令

查看状态：

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

查看 API 日志：

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --tail=200 -f api
```

查看 Web 日志：

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --tail=200 -f web
```

重启 API / Web：

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml restart api web
```

手工补跑迁移：

```bash
bash infra/db/migrate.sh
```

## 5. 发布后复烟入口

正式环境发布完成后，按以下顺序抽样：

1. ` /purchase/orders `
2. ` /purchase/receipts `
3. ` /purchase/match `
4. ` /purchase/returns `
5. ` /purchase/settlements `
6. ` /consumables/issues `
7. ` /assets/acceptance `
8. ` /assets/ledger `
9. ` /quality/trace `
10. ` /master-data/process-config `

详细核对点见 [consumable-fixed-asset-final-release-checklist.md](/Users/kongwen/claude_wk/ai-software-company/docs/consumable-fixed-asset-final-release-checklist.md:1)。
