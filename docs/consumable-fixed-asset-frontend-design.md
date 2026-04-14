[artifact:DesignSpec]
status: READY
owner: senior-ui-designer
scope:
- 为损耗品与固定资产前端联调提供视觉与组件规则
- 约束 F1~F5 的信息层级、标签系统和状态表达
inputs:
- `docs/consumable-fixed-asset-frontend-product.md`
- `docs/design-system-smart-factory.md`
- `services/web/src/pages/master-data/SkuPage.tsx`
- `services/web/src/pages/purchase/PurchaseOrderPage.tsx`
- `services/web/src/pages/inventory/InventoryPage.tsx`
handoff_to:
- senior-frontend-engineer
- engineering-manager
deliverables:
- 页面级视觉规范
- 字段分组与标签规则
- 与既有设计系统一致的扩展建议
risks:
- 若一次性引入全新视觉语言，会破坏现有采购/库存页面的一致性
exit_criteria:
- 前端工程师可按既有设计系统直接实现 F1~F5

布局原则：
1. 保持现有 `SkuPage`、`PurchaseOrderPage`、`InventoryPage` 的页面骨架，不重写导航和全局布局。
2. 新增信息优先通过“分组卡片 + 标签 + 次级描述”表达，不把字段堆入单行表格。
3. 资产链路使用独立台账视图，不复用库存页列表。

视觉映射：
- `production_material`：延续现有中性/蓝绿色系，不新增特殊强调
- `consumable`：使用琥珀橙系标签，背景建议 `var(--color-warning-100)`，文字 `var(--color-warning-700, #B45309)`
- `fixed_asset`：使用青蓝系标签，背景建议 `var(--color-info-100)`，文字 `#0369A1`
- `direct_expense`：使用浅红警示底，强调“到货即费用化”
- `asset_capitalization`：使用蓝色信息底，强调“待验收建卡”

字段分组：
- SKU 抽屉
  - 基础信息：名称、类目、规格、单位
  - 管控属性：业务大类、控制模式、默认仓库类型、是否允许 BOM、是否需资产验收
  - 业务档案：`consumableProfile` 或 `assetProfile`
- 采购订单详情
  - 订单摘要
  - 采购明细
  - 明细履约轨迹
- 资产台账详情
  - 卡片信息
  - 归属信息
  - 流转记录
  - 关联收货

组件约束：
- 新增业务标签优先复用 `Tag` / `StatusBadge` 组件，不新增一套平行组件
- 明细中的业务大类和收货模式一律用 capsule 标签，不仅靠文本
- 阻断类提示统一用现有 `Modal`/`Drawer` 内错误提示样式，不新增 toast 语义

[artifact:UICode]
status: READY
owner: senior-ui-designer
scope:
- 提供前端实现的结构草图和组件装配建议
inputs:
- [artifact:DesignSpec]
handoff_to:
- senior-frontend-engineer
deliverables:
- 页面结构稿
- 组件和数据落位建议
risks:
- None
exit_criteria:
- 前端工程师可据此直接拆分页面与表单实现

F1 `SkuPage` 抽屉结构：
```tsx
<Drawer title="SKU 主数据">
  <Section title="基础信息" />
  <Section title="管控属性">
    <Select name="businessClass" />
    <Select name="controlMode" />
    <Select name="defaultWarehouseType" />
    <Toggle name="allowBomComponent" />
    <Toggle name="requiresAssetAcceptance" />
  </Section>
  {businessClass === 'consumable' ? <ConsumableProfileCard /> : null}
  {businessClass === 'fixed_asset' ? <AssetProfileCard /> : null}
</Drawer>
```

F2 `PurchaseOrderPage` 列表/详情：
```tsx
columns = [
  poNo,
  supplierName,
  businessClassSummary,
  receiptModeSummary,
  status,
  expectedDate,
]
```

```tsx
<LineItemRow>
  <Tag>{businessClassLabel}</Tag>
  <Tag tone={receiptModeTone}>{receiptModeLabel}</Tag>
  {requiresAcceptance ? <Tag tone="info">需验收</Tag> : null}
</LineItemRow>
```

F3 `ConsumableIssuePage`：
```tsx
<PageShell title="损耗品领用">
  <FilterBar />
  <IssueTable />
  <Drawer title="新建领用单">
    <IssueOrderForm />
    <IssueItemsEditableTable />
  </Drawer>
</PageShell>
```

F4 `AssetAcceptancePage`：
```tsx
<PageShell title="固定资产验收">
  <ReceiptPendingTable />
  <Drawer title="验收建卡">
    <ReceiptSummaryCard />
    <AssetCardForm />
  </Drawer>
</PageShell>
```

F5 `AssetLedgerPage`：
```tsx
<PageShell title="资产台账">
  <AssetCardTable />
  <Drawer title="资产详情">
    <AssetCardSummary />
    <AssetMovementTimeline />
    <ReceiptReferencePanel />
  </Drawer>
</PageShell>
```

[artifact:InteractionSpec]
status: READY
owner: senior-ui-designer
scope:
- 约束 F1~F5 的状态切换、反馈、空态和错态
inputs:
- [artifact:DesignSpec]
- [artifact:UICode]
handoff_to:
- senior-frontend-engineer
- senior-qa-engineer
deliverables:
- 可直接转成页面交互与测试断言的说明
risks:
- None
exit_criteria:
- 所有关键状态切换都具备前端反馈规范

交互规则：
1. SKU 抽屉切换 `businessClass` 时，相关 profile 区域以渐显方式切换，未适用字段直接隐藏。
2. 当采购明细返回 `receiptMode=direct_expense` 时，页面展示“到货后不入库存”的辅助文案。
3. 损耗品领用执行前，若任一明细库存不足，阻断提交并滚动到对应明细行。
4. 资产验收建卡成功后，按钮区替换为“查看资产台账”次动作，避免重复提交。
5. 资产退回动作需二次确认，确认文案必须包含资产编号与当前责任人。

空态：
- 损耗品领用页无数据：提示“暂无领用单，可从右上角创建”
- 资产验收页无待验收记录：提示“当前没有待建卡收货记录”
- 资产台账页无数据：提示“尚未建卡，可从资产验收页进入”

错态：
- 字段配置缺失：使用行内警示块，不只靠 toast
- 保存失败：保留用户输入，按钮恢复可点击，并展示后端错误文案
- 明细接口返回部分缺字段：用 `待补配置` 标签占位，避免表格错位
