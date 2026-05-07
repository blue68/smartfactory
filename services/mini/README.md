# SmartFactory Mini Program

原生微信小程序版本，无需 Taro、React 或 npm 构建。

## 导入方式

1. 微信开发者工具导入 `services/mini` 目录，不要导入仓库根目录。
2. `project.config.json` 已配置 `miniprogramRoot: "miniprogram/"`。
3. 后端地址默认读取 `miniprogram/utils/config.js` 中的 `apiBaseUrl`，登录页只保留租户、账号、密码。
4. 本地静态校验执行 `npm run check`。

## 运行模式

- 小程序入口为账号登录页，使用 Web 端租户、账号、密码登录后进入控制面板。
- 登录成功后会切换到真实后端模式；正式环境需把 `apiBaseUrl` 配成已加入微信 request 合法域名的 HTTPS 地址。
- 使用 `http://localhost:3000` 本地联调时，需要在微信开发者工具「详情 - 本地设置」勾选“不校验合法域名、web-view 域名、TLS 版本以及 HTTPS 证书”。
- Access Token 存储键为 `sf_access_token`，401 后会清除本地登录态。
- 仓库/货架扫码兼容 Web 端打印的 `LOC|仓库编码|库位编码` 条码，也兼容 `SMART_FACTORY_LOCATION|...` 键值格式。

## 页面

- `pages/login/index`：租户、账号、密码登录。
- `pages/dashboard/index`：登录后控制面板，根据账号权限展示九宫格功能入口。
- `pages/worker-task/index`：工单开工、投料、完工、异常上报。
- `pages/warehouse-inbound/index`：物料扫码/搜索、库位选择、入库上架。
- `pages/qc-inspect/index`：来料抽检、留证图上传、质检放行。
- `pages/stocktaking/index`：仓库/货架扫码、库存盘点录入、保存和提交。
