[artifact:DeploymentPlan]
status: READY
owner: devops-engineer
scope:
- 汇总损耗品与固定资产版本正式环境发布前的一页式总清单
- 提供正式环境复烟所需的关键 URL、样例单号与核对点
inputs:
- `docs/consumable-fixed-asset-deployment-plan.md`
- `docs/consumable-fixed-asset-test-report.md`
- `docs/consumable-fixed-asset-execution-checklist.md`
- `docs/consumable-fixed-asset-remaining-plan.md`
handoff_to:
- engineering-manager
- senior-qa-engineer
- senior-frontend-engineer
- senior-backend-engineer
deliverables:
- 发布前总检查项
- 正式环境复烟 URL 清单
- 手工采购与采购后链路样例单号
- 发布通过判定口径
risks:
- 若正式环境未使用最新 API/Web 产物，页面入口、中文化修复与手工采购链路可能与本地验证结论不一致
exit_criteria:
- 发布执行人可只依赖本页完成正式环境复烟与结果记录

precheck:
- 确认 `docs/consumable-fixed-asset-review-report.md` 无 blocker
- 确认 `docs/consumable-fixed-asset-security-report.md` 无高危未决问题
- 确认 `docs/consumable-fixed-asset-test-report.md` 当前为 `PASS`
- 确认正式环境部署基线已包含最新 `master`
- 确认 `npm run test:api:integration:consumable-asset` 已纳入本次发布前补跑
- 确认数据库备份、迁移执行顺序与回滚路径已准备完成

## 一、正式环境关键 URL

按推荐顺序复烟：

1. ` /master-data/sku `
- 目标：确认 SKU 主数据页、详情页、新增/编辑页已是最新中文化与只读规则
- 核对点：固定资产档案中的“资产类别 / 折旧方式”显示中文；“管控属性”除业务大类外为只读

2. ` /purchase/orders `
- 目标：确认“手工建采购单”入口可用
- 核对点：弹窗无 SKU 搜索框；SKU 下拉可正常选择固定资产/损耗品；联动显示业务属性和收货后分流

3. ` /purchase/deliveries `
- 目标：确认送货管理页与详情抽屉可正常查看采购单
- 核对点：到货状态显示中文；详情抽屉入口完整

4. ` /purchase/incoming-inspection `
- 目标：确认来料质检页已接上采购单/送货单/入库单/三单匹配回溯入口
- 核对点：详情抽屉可见“查看采购单”

5. ` /purchase/receipts `
- 目标：确认入库记录页和收货分流说明正常
- 核对点：固定资产收货显示“去资产验收”，损耗品库存型收货显示“去损耗品领用”

6. ` /purchase/match `
- 目标：确认三单匹配支持按单号选择，不再手填裸 ID
- 核对点：弹窗字段为“采购订单 / 送货单号 / 入库单号”，可完成匹配

7. ` /purchase/returns `
- 目标：确认退货管理支持按采购单/质检单深链打开
- 核对点：详情抽屉可回跳来料质检；退货状态流转正常

8. ` /purchase/settlements `
- 目标：确认采购结算可从空态创建并展示退货摘要
- 核对点：详情与列表中显示采购单、送货单、入库单、退货摘要

9. ` /consumables/issues `
- 目标：确认损耗品领用列表、创建、审批、执行都正常
- 核对点：状态显示中文；领用部门下拉可选；选中部门后不再显示 ID 手填框

10. ` /assets/acceptance `
- 目标：确认资产验收池、验收建卡与中文化显示正常
- 核对点：收货状态与提示文案显示中文；已建卡收货单不会继续留在待办池

11. ` /assets/ledger `
- 目标：确认资产台账详情中文化、来源展示与字段映射正确
- 核对点：资产分类、来源、责任人、采购入库单号显示正常

## 二、正式环境样例单号

优先按本地已验证样例准备正式环境对应的两条烟雾链路。若正式环境不能复用这些本地单号，则至少按同样业务类型新建一组对等样例。

固定资产手工采购样例：
- 采购单：`PO1776172877547757`
- 送货单：`DN1776172890803592`
- 质检单：`IQC260414-00003`
- 入库单：`RC260414-00003`
- 资产卡：`FA260414-00002`

损耗品手工采购样例：
- 采购单：`PO1776174123806393`
- 送货单：`DN1776174142538557`
- 质检单：`IQC260414-00004`
- 入库单：`RC260414-00004`
- 领用单：`CI260414-00002`

采购后链路样例：
- 三单匹配：`PO1776167371741479 / DN1776167371783459 / RC260414-00002`
- 退货单：`RTN260414-00001`
- 结算单：`PST260414-00001`

## 三、逐页核对点

固定资产链路：
- 在 ` /purchase/orders ` 确认固定资产采购单可查看
- 在 ` /purchase/deliveries ` 确认送货单可查看
- 在 ` /purchase/incoming-inspection ` 确认质检单可查看
- 在 ` /purchase/receipts ` 确认入库单存在且显示“去资产验收”
- 在 ` /assets/acceptance ` 完成验收建卡或确认建卡后已从待办池移除
- 在 ` /assets/ledger ` 确认资产卡已入账

损耗品链路：
- 在 ` /purchase/orders ` 确认损耗品采购单可查看
- 在 ` /purchase/deliveries ` 确认送货单可查看
- 在 ` /purchase/incoming-inspection ` 确认质检单可查看
- 在 ` /purchase/receipts ` 确认入库单存在且显示“去损耗品领用”
- 在 ` /consumables/issues ` 确认领用单状态为“已发放”
- 抽样确认对应 SKU 库存副作用正确

采购后链路：
- 在 ` /purchase/match ` 确认三单匹配记录存在且状态为“已匹配”
- 在 ` /purchase/returns ` 确认退货单状态已闭环
- 在 ` /purchase/settlements ` 确认结算单状态为“已付款”
- 确认结算页显示退货摘要，不丢失采购单/送货单/入库单关联信息

## 四、发布通过判定

满足以下条件才可判定本轮正式环境发布通过：

1. `npm run test:api:integration:consumable-asset` 通过
2. 上述 11 个关键 URL 无白屏、404、权限缺失或核心按钮失效
3. 固定资产与损耗品两条手工采购样例至少各完成一条完整复烟
4. 三单匹配、退货管理、采购结算三页联动正常
5. 资产验收待办池未包含已建卡收货单
6. 损耗品库存与资产台账副作用与页面状态一致

rollback:
- 任一关键 URL 出现 blocker，立即暂停发布并回滚到上一版 API/Web 产物
- 任一手工采购样例无法闭环，立即停止继续放量并核对迁移、主数据和权限配置
- 若资产验收池、损耗品库存或采购结算摘要出现数据错乱，优先回滚 API，再执行数据修复

monitoring:
- 监控 `/purchase/*`、`/consumables/issues`、`/assets/acceptance`、`/assets/ledger` 的 4xx/5xx 和前端白屏日志
- 监控 IQC 收货、领用执行、验收建卡、退货完成、结算付款几个关键动作的失败率
- 监控资产验收待办池与库存事务是否出现异常回流或误写

owner:
- devops-engineer
