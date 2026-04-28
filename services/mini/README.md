# SmartFactory Mini Program

微信开发者工具导入方式：

1. 在本目录执行 `npm install`。
2. 执行 `npm run build:weapp` 生成 `dist/`。
3. 微信开发者工具导入 `services/mini` 目录，不要直接导入仓库根目录。

`project.config.json` 已配置 `miniprogramRoot: "dist/"`，开发者工具会读取 Taro 构建产物。若后端不是本机服务，构建前设置 `TARO_APP_API_BASE_URL`。
