[artifact:UICode]
status: READY
owner: senior-ui-designer
scope:
- 为权限控制模块 6 个页面提供高保真结构稿与组件级 UI 代码草图
- 仅描述结构、层级和样式片段，不实现业务逻辑
inputs:
- [artifact:PRD] `docs/v3/permission-control/prd.md`
- [artifact:Prototype] `docs/v3/permission-control/prototype.md`
- [artifact:DesignSpec] `docs/v3/permission-control/design-spec.md`
- [artifact:InteractionSpec] `docs/v3/permission-control/interaction-spec.md`
deliverables:
- 6 个页面的高保真页面结构稿
- 可供前端参考的组件树、区域划分与 class 命名建议
risks:
- 该文档若过度偏实现，会和后续前端代码重复，故仅保留结构稿与样式意图
handoff_to:
- tech-lead-architect
- senior-frontend-engineer
exit_criteria:
- 前端可直接据此进入组件拆分与实现计划

# 权限控制模块 UI Code

## 1. 页面通用骨架

```tsx
<div className="page">
  <header className="pageHeader">
    <div>
      <h1 className="pageTitle">页面标题</h1>
      <p className="pageSubtitle">页面说明</p>
    </div>
    <div className="pageActions">
      <Button variant="primary">主操作</Button>
    </div>
  </header>

  <section className="statsRow">
    <StatCard />
  </section>

  <section className="filterBar">
    <SearchInput />
    <Select />
    <Select />
    <Button variant="ghost">重置</Button>
  </section>

  <main className="contentCard">
    <Table />
  </main>

  <Drawer />
  <Modal />
</div>
```

建议基础 class：

- `page`
- `pageHeader`
- `pageTitle`
- `pageSubtitle`
- `pageActions`
- `statsRow`
- `filterBar`
- `contentCard`
- `tableCard`
- `drawerSection`
- `formGrid`
- `treePanel`

## 2. 租户配置页

### 2.1 结构稿

```tsx
<div className="tenantPage">
  <section className="statsRow">
    <StatCard title="全部租户" value="36" />
    <StatCard title="启用中" value="32" tone="success" />
    <StatCard title="已停用" value="4" tone="danger" />
    <StatCard title="即将到期" value="5" tone="warning" />
  </section>

  <section className="filterBar">
    <SearchInput placeholder="搜索租户名称或编码" />
    <Select placeholder="全部状态" />
    <Select placeholder="全部套餐" />
    <Button variant="secondary">重置</Button>
    <Button variant="primary">+ 新建租户</Button>
  </section>

  <section className="tableCard">
    <Table columns={tenantColumns} />
  </section>

  <Drawer title="租户详情">
    <InfoGrid />
    <ModuleSwitchList />
  </Drawer>
</div>
```

### 2.2 视觉说明

- 卡片上半区用于汇总，下半区用于列表。
- 详情抽屉内部使用 `InfoGrid + SwitchList + Tag`。
- 到期日和停用态使用橙色/红色提示标签。

## 3. 菜单与功能页

### 3.1 结构稿

```tsx
<div className="menuPermissionPage">
  <aside className="treePanel">
    <TreeSearch />
    <TreeView />
  </aside>
  <section className="detailPanel">
    <Card title="菜单基本信息">
      <FormGrid />
    </Card>
    <Card title="功能点列表">
      <Toolbar />
      <Table columns={featureColumns} />
    </Card>
  </section>
</div>
```

### 3.2 视觉说明

- 左树右详情，适合层级管理。
- 系统预置节点显示浅蓝标签。
- 功能点表使用紧凑表格，操作列只保留编辑/停用。

## 4. 角色配置页

### 4.1 结构稿

```tsx
<div className="rolePage">
  <section className="statsRow">
    <StatCard title="角色总数" value="12" />
    <StatCard title="系统预置" value="8" />
    <StatCard title="自定义" value="4" />
    <StatCard title="已分配人员" value="128" />
  </section>

  <section className="splitLayout">
    <aside className="listPanel">
      <SearchInput />
      <RoleList />
    </aside>
    <section className="detailPanel">
      <Card title="角色详情">
        <InfoGrid />
        <TagRow />
      </Card>
    </section>
  </section>
</div>
```

### 4.2 视觉说明

- 角色列表采用可选中列表，不做过重表格化。
- 当前选中项使用左侧高亮边线。
- 系统角色与租户自定义角色使用不同徽标。

## 5. 人员配置页

### 5.1 结构稿

```tsx
<div className="userPage">
  <section className="statsRow">
    <StatCard title="人员总数" value="246" />
    <StatCard title="启用中" value="231" tone="success" />
    <StatCard title="已禁用" value="15" tone="danger" />
    <StatCard title="未分配角色" value="9" tone="warning" />
  </section>

  <section className="filterBar">
    <SearchInput placeholder="搜索账号/姓名/手机号" />
    <Select placeholder="全部状态" />
    <Select placeholder="全部部门" />
    <Select placeholder="全部角色" />
    <Button variant="secondary">重置</Button>
    <Button variant="primary">+ 新建人员</Button>
  </section>

  <section className="tableCard">
    <Table columns={userColumns} />
  </section>

  <Drawer title="人员详情">
    <InfoGrid />
    <RoleChipList />
  </Drawer>
</div>
```

### 5.2 视觉说明

- 人员表格保留“主角色”与“角色数”列，降低授权理解成本。
- 头像/首字母信息可作为辅助识别，不是主视觉。

## 6. 角色授权页

### 6.1 结构稿

```tsx
<div className="grantPage">
  <aside className="listPanel">
    <SearchInput />
    <RoleList />
  </aside>
  <section className="grantWorkspace">
    <Card title="菜单授权">
      <Toolbar />
      <TreePermission />
    </Card>
    <Card title="功能点与数据范围">
      <ActionPermissionPanel />
      <DataScopeForm />
      <SummaryStrip />
    </Card>
  </section>
</div>
```

### 6.2 视觉说明

- 树形区域占主空间，右侧是功能与范围。
- 已授权项显示绿色或蓝绿色强调。
- 保存按钮固定在卡片底部，避免长页滚动丢失操作入口。

## 7. 人员角色分配页

### 7.1 结构稿

```tsx
<div className="assignmentPage">
  <section className="splitLayout">
    <aside className="listPanel">
      <SearchInput />
      <UserList />
    </aside>
    <section className="detailPanel">
      <Card title="角色分配">
        <RoleMultiSelect />
        <MainRoleSelect />
        <DateRangeField />
        <ToggleSwitch />
      </Card>
      <Card title="分配结果">
        <RoleChipList />
        <AuditHint />
      </Card>
    </section>
  </section>
</div>
```

### 7.2 视觉说明

- 右侧面板要突出“主角色”和“生效时间”。
- 角色多选采用标签式选择，已选项可快速移除。

## 8. 样式片段

```css
.page {
  padding: 24px;
  min-height: 100%;
  background: radial-gradient(circle at 20% 20%, rgba(59, 130, 246, 0.08), transparent 40%), #f4f6fb;
}

.contentCard,
.tableCard,
.detailPanel,
.listPanel,
.treePanel {
  background: linear-gradient(180deg, #fff 0%, #f8fbff 100%);
  border: 1px solid #dbe3ef;
  border-radius: 16px;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.06);
}

.splitLayout {
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  gap: 16px;
}

@media (max-width: 1024px) {
  .splitLayout {
    grid-template-columns: 1fr;
  }
}
```

## 9. 页面优先级建议

建议首批落地顺序：

1. 角色配置
2. 人员配置
3. 角色授权
4. 菜单与功能
5. 人员角色分配
6. 租户配置

