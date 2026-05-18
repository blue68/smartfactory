# 贡献指南

感谢你关注智造管家 SmartFactory。本项目以源码可见、非商业授权方式开放，欢迎用于个人学习、技术研究、非商业演示和社区贡献。

## 授权边界

提交 Issue、Pull Request 或其他贡献前，请先阅读 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。

- 你的贡献默认按本仓库现有非商业授权条款提供。
- 贡献行为不代表作者授予商业使用、商业集成、SaaS 运营、外包交付、付费培训或二次销售授权。
- 如需商业使用，必须先取得作者书面同意。

## 适合提交的内容

- 修复明确可复现的缺陷。
- 补充测试、文档、部署脚本或开发体验改进。
- 优化业务流程中已经存在的模块。
- 提交前请尽量把需求、影响范围和验证方式写清楚。

暂不建议直接提交范围很大的重构或全新业务模块。此类改动应先通过 Issue 说明背景、目标、设计边界和验证计划。

## 开发流程

1. 确认本地分支基于最新 `master`：

   ```bash
   git fetch origin --prune
   git rev-list --left-right --count master...origin/master
   ```

2. 从最新 `master` 创建工作分支。
3. 按模块边界提交小而清晰的改动。
4. 同步更新相关 README、docs、环境变量示例或测试用例。
5. 提交 Pull Request，并按模板填写变更摘要、影响范围和验证记录。

## 本地验证

根据改动范围选择验证命令。常见入口如下：

```bash
npm run check
npm run test
```

如果只修改文档或 GitHub 模板，请至少执行：

```bash
git diff --check
```

涉及 Web UI 的改动应补充或执行相关 Playwright 用例；涉及 API、数据库、权限、库存、生产、质量、AI 业务链路的改动，应补充对应后端或端到端验证记录。

## 数据库变更规则

数据库结构演进必须保持前向兼容，优先采用以下方式：

- 新增表。
- 为已有表追加字段。
- 新增索引。
- 补充兼容迁移、回填脚本和回滚说明。

谨慎修改历史字段含义、删除字段或改写基线 DDL。确需修改 `infra/db/init.sql` 或历史初始化逻辑时，Pull Request 必须说明：

- 影响模块。
- 兼容策略。
- 存量环境迁移路径。
- 回滚路径。
- 回归验证范围。

## 文档和截图

用户可见流程、部署方式、环境变量、默认账号、开源授权、联系方式或收款码发生变化时，需要同步更新 README 或 `docs/`。

核心模块界面发生明显变化时，请同步更新 `docs/assets/screenshots/core/` 下的真实效果图，并确认 README 中引用路径仍然有效。

## 联系作者

- Email: [chaoqiang.tian@gmail.com](mailto:chaoqiang.tian@gmail.com)
- WeChat: `chaoqiang68`
- Mobile: `18857886080`

