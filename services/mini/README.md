# SmartFactory Mini Program

原生微信小程序版本，无需 Taro、React 或 npm 构建。

## 导入方式

1. 微信开发者工具导入 `services/mini` 目录，不要导入仓库根目录。
2. `project.config.json` 已配置 `miniprogramRoot: "miniprogram/"`。
3. 后端地址在 `miniprogram/utils/config.js` 中配置，默认 `http://localhost:3000`。
4. 本地静态校验执行 `npm run check`。

## 页面

- `pages/worker-task/index`：工单开工、投料、完工、异常上报。
- `pages/warehouse-inbound/index`：物料扫码/搜索、库位选择、入库上架。
- `pages/qc-inspect/index`：来料抽检、留证图上传、质检放行。
