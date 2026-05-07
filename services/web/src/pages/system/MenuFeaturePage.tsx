import { useEffect, useMemo, useState } from 'react';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import {
  useCreateAction,
  useCreateMenu,
  useDeleteAction,
  useDeleteMenu,
  useMenuActions,
  useMenuTree,
  useUpdateAction,
  useUpdateMenu,
} from '@/api/accessControl';
import { useAppStore } from '@/stores/appStore';
import type { ActionItem, ActionPayload, MenuPayload, MenuTreeNode } from '@/types/accessControl';
import styles from './SystemPageShell.module.css';

function flattenMenuTree(tree: MenuTreeNode[]): MenuTreeNode[] {
  const list: MenuTreeNode[] = [];
  const walk = (nodes: MenuTreeNode[], depth = 0) => {
    nodes.forEach((node) => {
      list.push({ ...node, name: `${'　'.repeat(depth)}${node.name}` });
      if (node.children?.length) {
        walk(node.children, depth + 1);
      }
    });
  };
  walk(tree);
  return list;
}

function menuTypeLabel(menuType?: MenuTreeNode['menuType']) {
  if (menuType === 'group') return '分组';
  if (menuType === 'module') return '模块';
  return '页面';
}

function actionTypeLabel(actionType?: string) {
  const map: Record<string, string> = {
    view: '查看',
    create: '新增',
    edit: '编辑',
    delete: '删除',
    approve: '审批',
    export: '导出',
    print: '打印',
    convert: '转换',
    custom: '自定义',
  };
  return map[actionType ?? 'custom'] ?? actionType ?? '-';
}

type MenuModalState =
  | { mode: 'create'; menu: null; parentId: number | null }
  | { mode: 'edit'; menu: MenuTreeNode; parentId: number | null };

type ActionModalState =
  | { mode: 'create'; action: null }
  | { mode: 'edit'; action: ActionItem };

const EMPTY_MENU_FORM: MenuPayload = {
  code: '',
  name: '',
  parentId: null,
  menuType: 'page',
  routePath: '',
  icon: '',
  groupName: '',
  sortOrder: 0,
  status: 'active',
  defaultVisible: true,
};

const EMPTY_ACTION_FORM: ActionPayload = {
  menuId: 0,
  code: '',
  name: '',
  actionType: 'custom',
  status: 'active',
  defaultEnabled: true,
};

export default function MenuFeaturePage() {
  const setPageTitle = useAppStore((s) => s.setPageTitle);
  const showToast = useAppStore((s) => s.showToast);
  const [keyword, setKeyword] = useState('');
  const [selectedMenuId, setSelectedMenuId] = useState<number | null>(null);
  const [menuModalState, setMenuModalState] = useState<MenuModalState | null>(null);
  const [actionModalState, setActionModalState] = useState<ActionModalState | null>(null);
  const [menuForm, setMenuForm] = useState<MenuPayload>(EMPTY_MENU_FORM);
  const [actionForm, setActionForm] = useState<ActionPayload>(EMPTY_ACTION_FORM);

  const { data, isLoading, error } = useMenuTree({ includeActions: true, keyword: keyword.trim() || undefined });
  const menuList = useMemo(() => flattenMenuTree(data ?? []), [data]);
  const { data: actionList = [], isLoading: actionLoading, error: actionError } = useMenuActions(selectedMenuId);
  const createMenuMutation = useCreateMenu();
  const updateMenuMutation = useUpdateMenu();
  const deleteMenuMutation = useDeleteMenu();
  const createActionMutation = useCreateAction();
  const updateActionMutation = useUpdateAction();
  const deleteActionMutation = useDeleteAction();

  useEffect(() => {
    setPageTitle('系统管理 · 菜单与功能');
  }, [setPageTitle]);

  useEffect(() => {
    if (menuList.length === 0) {
      setSelectedMenuId(null);
      return;
    }
    if (selectedMenuId === null || !menuList.some((item) => item.id === selectedMenuId)) {
      setSelectedMenuId(menuList[0].id);
    }
  }, [menuList, selectedMenuId]);

  const selectedMenu = menuList.find((item) => item.id === selectedMenuId) ?? null;
  const isSystemMenu = Number(selectedMenu?.tenantId ?? 0) === 0 || Boolean(selectedMenu?.isSystem);

  const resetFilters = () => {
    setKeyword('');
  };

  const openCreateRoot = () => {
    setMenuModalState({ mode: 'create', menu: null, parentId: null });
    setMenuForm(EMPTY_MENU_FORM);
  };

  const openCreateChild = () => {
    if (!selectedMenu) {
      showToast({ type: 'warning', message: '请先在左侧选择父菜单' });
      return;
    }
    setMenuModalState({ mode: 'create', menu: null, parentId: selectedMenu.id });
    setMenuForm({ ...EMPTY_MENU_FORM, parentId: selectedMenu.id });
  };

  const openEditMenu = () => {
    if (!selectedMenu) return;
    setMenuModalState({ mode: 'edit', menu: selectedMenu, parentId: selectedMenu.parentId ?? null });
    setMenuForm({
      code: selectedMenu.code,
      name: selectedMenu.name.replace(/^[\u3000]+/, ''),
      parentId: selectedMenu.parentId ?? null,
      menuType: selectedMenu.menuType ?? 'page',
      routePath: selectedMenu.routePath ?? '',
      icon: selectedMenu.icon ?? '',
      groupName: selectedMenu.groupName ?? '',
      sortOrder: selectedMenu.sortOrder ?? 0,
      status: selectedMenu.status ?? 'active',
      defaultVisible: true,
    });
  };

  const openCreateAction = () => {
    if (!selectedMenu) {
      showToast({ type: 'warning', message: '请先选择菜单节点后再新增功能点' });
      return;
    }
    setActionModalState({ mode: 'create', action: null });
    setActionForm({ ...EMPTY_ACTION_FORM, menuId: selectedMenu.id });
  };

  const openEditAction = (action: ActionItem) => {
    setActionModalState({ mode: 'edit', action });
    setActionForm({
      menuId: action.menuId,
      code: action.code,
      name: action.name,
      actionType: action.actionType,
      status: action.status,
      defaultEnabled: action.defaultEnabled ?? true,
    });
  };

  const closeMenuModal = () => {
    setMenuModalState(null);
    setMenuForm(EMPTY_MENU_FORM);
  };

  const closeActionModal = () => {
    setActionModalState(null);
    setActionForm(EMPTY_ACTION_FORM);
  };

  const handleSaveMenu = async () => {
    if (!menuForm.code?.trim() || !menuForm.name?.trim()) {
      showToast({ type: 'warning', message: '请填写菜单编码和菜单名称' });
      return;
    }
    try {
      if (menuModalState?.mode === 'create') {
        await createMenuMutation.mutateAsync({
          ...menuForm,
          code: menuForm.code.trim(),
          name: menuForm.name.trim(),
          parentId: menuModalState.parentId,
        });
        showToast({ type: 'success', message: '菜单节点已创建' });
      } else if (menuModalState?.mode === 'edit') {
        await updateMenuMutation.mutateAsync({
          id: menuModalState.menu.id,
          payload: {
            ...menuForm,
            code: menuForm.code.trim(),
            name: menuForm.name.trim(),
          },
        });
        showToast({ type: 'success', message: '菜单节点已更新' });
      }
      closeMenuModal();
    } catch (err) {
      showToast({ type: 'error', message: (err as Error).message || '保存菜单失败' });
    }
  };

  const handleDeleteMenu = async () => {
    if (!selectedMenu) return;
    const confirmed = window.confirm(`确认删除菜单“${selectedMenu.name.replace(/^[\u3000]+/, '')}”吗？`);
    if (!confirmed) return;
    try {
      await deleteMenuMutation.mutateAsync(selectedMenu.id);
      showToast({ type: 'success', message: '菜单节点已删除' });
    } catch (err) {
      showToast({ type: 'error', message: (err as Error).message || '删除菜单失败' });
    }
  };

  const handleSaveAction = async () => {
    if (!actionForm.code?.trim() || !actionForm.name?.trim() || !selectedMenu) {
      showToast({ type: 'warning', message: '请填写功能编码、名称并选择菜单' });
      return;
    }
    try {
      if (actionModalState?.mode === 'create') {
        await createActionMutation.mutateAsync({
          ...actionForm,
          menuId: selectedMenu.id,
          code: actionForm.code.trim(),
          name: actionForm.name.trim(),
        });
        showToast({ type: 'success', message: '功能点已创建' });
      } else if (actionModalState?.mode === 'edit') {
        await updateActionMutation.mutateAsync({
          id: actionModalState.action.id,
          payload: {
            code: actionForm.code.trim(),
            name: actionForm.name.trim(),
            actionType: actionForm.actionType,
            status: actionForm.status,
            defaultEnabled: actionForm.defaultEnabled,
          },
        });
        showToast({ type: 'success', message: '功能点已更新' });
      }
      closeActionModal();
    } catch (err) {
      showToast({ type: 'error', message: (err as Error).message || '保存功能点失败' });
    }
  };

  const handleDeleteAction = async (action: ActionItem) => {
    const confirmed = window.confirm(`确认删除功能点“${action.name}”吗？`);
    if (!confirmed) return;
    try {
      await deleteActionMutation.mutateAsync(action.id);
      showToast({ type: 'success', message: '功能点已删除' });
    } catch (err) {
      showToast({ type: 'error', message: (err as Error).message || '删除功能点失败' });
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>菜单与功能</h1>
          <p className={styles.subtitle}>维护租户侧菜单树和功能点编码，支持角色授权页面直接引用。</p>
        </div>
        <Button variant="primary" onClick={openCreateRoot}>+ 新增一级菜单</Button>
      </div>

      <div className={styles.filterBar}>
        <input
          className={styles.input}
          placeholder="搜索菜单名称/编码"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
        <div className={styles.panelActions}>
          <Button variant="ghost" onClick={resetFilters}>重置筛选</Button>
          <Button variant="secondary" onClick={openCreateChild}>+ 新增子菜单</Button>
          <Button variant="secondary" onClick={openCreateAction}>+ 新增功能点</Button>
          <Button variant="ghost" disabled={!selectedMenu || isSystemMenu} onClick={openEditMenu}>编辑菜单</Button>
          <Button variant="danger" disabled={!selectedMenu || isSystemMenu || deleteMenuMutation.isPending} onClick={() => void handleDeleteMenu()}>删除菜单</Button>
        </div>
      </div>

      <div className={styles.split}>
        <section className={`${styles.card} ${styles.stickyCard}`}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>菜单树</h2>
            <span className={styles.tag}>{menuList.length} 项</span>
          </div>
          <div className={`${styles.cardBody} ${styles.scrollCardBody}`}>
            {error && <div className={styles.hint}>菜单树加载失败：{(error as Error).message}</div>}
            {!error && (
              <div className={styles.list}>
                {isLoading && <div className={styles.hint}>加载中...</div>}
                {!isLoading && menuList.length === 0 && <div className={styles.hint}>暂无菜单数据。</div>}
                {!isLoading && menuList.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`${styles.listItem} ${selectedMenuId === item.id ? styles.listItemActive : ''}`}
                    onClick={() => setSelectedMenuId(item.id)}
                  >
                    {item.code} · {item.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>菜单详情与功能点</h2>
          </div>
          <div className={styles.cardBody}>
            {!selectedMenu && <div className={styles.hint}>请选择左侧菜单节点。</div>}
            {selectedMenu && (
              <div className={styles.sectionBlock}>
                <div className={styles.hint}>
                  菜单编码：{selectedMenu.code}；路由：{selectedMenu.routePath ?? '-'}；分组：{selectedMenu.groupName ?? '-'}；类型：{menuTypeLabel(selectedMenu.menuType)}
                </div>
                {isSystemMenu && (
                  <div className={styles.warningBox}>当前为系统预置菜单，只允许查看，不允许直接编辑或删除。</div>
                )}
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>功能编码</th>
                      <th>功能名称</th>
                      <th>类型</th>
                      <th>状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {actionError && (
                      <tr>
                        <td colSpan={5} className={styles.muted}>功能点加载失败：{(actionError as Error).message}</td>
                      </tr>
                    )}
                    {!actionError && actionLoading && (
                      <tr>
                        <td colSpan={5} className={styles.muted}>加载中...</td>
                      </tr>
                    )}
                    {!actionError && !actionLoading && actionList.length === 0 && (
                      <tr>
                        <td colSpan={5} className={styles.muted}>当前菜单暂无功能点。</td>
                      </tr>
                    )}
                    {!actionError && !actionLoading && actionList.map((action) => (
                      <tr key={action.id}>
                        <td>{action.code}</td>
                        <td>{action.name}</td>
                        <td>{actionTypeLabel(action.actionType)}</td>
                        <td>{action.status === 'active' ? '启用' : '停用'}</td>
                        <td>
                          <div className={styles.tableActions}>
                            <Button variant="secondary" size="sm" disabled={Number(action.tenantId ?? 0) === 0} onClick={() => openEditAction(action)}>编辑</Button>
                            <Button variant="danger" size="sm" disabled={Number(action.tenantId ?? 0) === 0} onClick={() => void handleDeleteAction(action)}>删除</Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>

      <Modal
        open={menuModalState !== null}
        title={menuModalState?.mode === 'create' ? '新增菜单节点' : '编辑菜单节点'}
        onClose={closeMenuModal}
        onConfirm={() => void handleSaveMenu()}
        confirmLabel={menuModalState?.mode === 'create' ? '创建菜单' : '保存菜单'}
        confirmLoading={createMenuMutation.isPending || updateMenuMutation.isPending}
      >
        <div className={styles.formGrid}>
          <div className={styles.field}>
            <label className={styles.label}>菜单编码</label>
            <input className={styles.input} value={menuForm.code ?? ''} onChange={(e) => setMenuForm((prev) => ({ ...prev, code: e.target.value }))} />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>菜单名称</label>
            <input className={styles.input} value={menuForm.name ?? ''} onChange={(e) => setMenuForm((prev) => ({ ...prev, name: e.target.value }))} />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>菜单类型</label>
            <select className={styles.select} value={menuForm.menuType ?? 'page'} onChange={(e) => setMenuForm((prev) => ({ ...prev, menuType: e.target.value as MenuPayload['menuType'] }))}>
              <option value="group">分组</option>
              <option value="module">模块</option>
              <option value="page">页面</option>
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>状态</label>
            <select className={styles.select} value={menuForm.status ?? 'active'} onChange={(e) => setMenuForm((prev) => ({ ...prev, status: e.target.value }))}>
              <option value="active">启用</option>
              <option value="inactive">停用</option>
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>路由</label>
            <input className={styles.input} value={menuForm.routePath ?? ''} onChange={(e) => setMenuForm((prev) => ({ ...prev, routePath: e.target.value }))} />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>分组</label>
            <input className={styles.input} value={menuForm.groupName ?? ''} onChange={(e) => setMenuForm((prev) => ({ ...prev, groupName: e.target.value }))} />
          </div>
        </div>
      </Modal>

      <Modal
        open={actionModalState !== null}
        title={actionModalState?.mode === 'create' ? '新增功能点' : '编辑功能点'}
        onClose={closeActionModal}
        onConfirm={() => void handleSaveAction()}
        confirmLabel={actionModalState?.mode === 'create' ? '创建功能点' : '保存功能点'}
        confirmLoading={createActionMutation.isPending || updateActionMutation.isPending}
      >
        <div className={styles.formGrid}>
          <div className={styles.field}>
            <label className={styles.label}>功能编码</label>
            <input className={styles.input} value={actionForm.code ?? ''} onChange={(e) => setActionForm((prev) => ({ ...prev, code: e.target.value }))} />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>功能名称</label>
            <input className={styles.input} value={actionForm.name ?? ''} onChange={(e) => setActionForm((prev) => ({ ...prev, name: e.target.value }))} />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>动作类型</label>
            <select className={styles.select} value={actionForm.actionType ?? 'custom'} onChange={(e) => setActionForm((prev) => ({ ...prev, actionType: e.target.value }))}>
              <option value="custom">自定义</option>
              <option value="view">查看</option>
              <option value="create">新增</option>
              <option value="edit">编辑</option>
              <option value="delete">删除</option>
              <option value="approve">审批</option>
              <option value="export">导出</option>
              <option value="print">打印</option>
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>状态</label>
            <select className={styles.select} value={actionForm.status ?? 'active'} onChange={(e) => setActionForm((prev) => ({ ...prev, status: e.target.value }))}>
              <option value="active">启用</option>
              <option value="inactive">停用</option>
            </select>
          </div>
        </div>
      </Modal>
    </div>
  );
}
