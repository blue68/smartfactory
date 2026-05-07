import { useEffect, useMemo, useState } from 'react';
import Button from '@/components/common/Button';
import {
  useMenuActions,
  useMenuTree,
  useRoleList,
  useRolePermissionDetail,
  useUpdateRolePermissions,
} from '@/api/accessControl';
import { useAppStore } from '@/stores/appStore';
import type { MenuTreeNode } from '@/types/accessControl';
import styles from './SystemPageShell.module.css';

function normalizeNumericId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

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

function parseCodeList(input: string) {
  return Array.from(new Set(
    input
      .split(/[\n,，\s]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  ));
}

export default function RoleGrantPage() {
  const setPageTitle = useAppStore((s) => s.setPageTitle);
  const showToast = useAppStore((s) => s.showToast);
  const [roleKeyword, setRoleKeyword] = useState('');
  const [menuKeyword, setMenuKeyword] = useState('');
  const [activeRoleId, setActiveRoleId] = useState<number | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<number | null>(null);
  const [selectedMenuCodes, setSelectedMenuCodes] = useState<string[]>([]);
  const [selectedActionCodes, setSelectedActionCodes] = useState<string[]>([]);
  const [dataScopeType, setDataScopeType] = useState('all');
  const [dataScopeValues, setDataScopeValues] = useState('');
  const updateRolePermissionsMutation = useUpdateRolePermissions();

  const { data: roleData, isLoading: roleLoading, error: roleError } = useRoleList({
    page: 1,
    pageSize: 200,
  });
  const { data: menuTree = [], isLoading: menuLoading, error: menuError } = useMenuTree();
  const menuList = useMemo(() => flattenMenuTree(menuTree), [menuTree]);
  const roleList = useMemo(() => roleData?.list ?? [], [roleData?.list]);

  const filteredRoles = useMemo(() => {
    const keyword = roleKeyword.trim().toLowerCase();
    if (!keyword) return roleList;
    return roleList.filter((role) => (
      role.name.toLowerCase().includes(keyword) || role.code.toLowerCase().includes(keyword)
    ));
  }, [roleKeyword, roleList]);

  const filteredMenus = useMemo(() => {
    const keyword = menuKeyword.trim().toLowerCase();
    if (!keyword) return menuList;
    return menuList.filter((menu) => (
      menu.name.toLowerCase().includes(keyword) || menu.code.toLowerCase().includes(keyword)
    ));
  }, [menuKeyword, menuList]);

  const activeRole = roleList.find((item) => normalizeNumericId(item.id) === activeRoleId) ?? null;
  const activeMenu = menuList.find((item) => normalizeNumericId(item.id) === activeMenuId) ?? null;
  const isSystemRole = activeRole?.roleType === 'system';

  const {
    data: grantDetail,
    isLoading: grantLoading,
    error: grantError,
  } = useRolePermissionDetail(activeRoleId);
  const {
    data: activeMenuActions = [],
    isLoading: actionLoading,
    error: actionError,
  } = useMenuActions(activeMenuId);

  useEffect(() => {
    setPageTitle('系统管理 · 角色授权');
  }, [setPageTitle]);

  useEffect(() => {
    if (filteredRoles.length === 0) {
      setActiveRoleId(null);
      return;
    }
    if (activeRoleId === null || !filteredRoles.some((item) => normalizeNumericId(item.id) === activeRoleId)) {
      setActiveRoleId(normalizeNumericId(filteredRoles[0].id));
    }
  }, [activeRoleId, filteredRoles]);

  useEffect(() => {
    if (filteredMenus.length === 0) {
      setActiveMenuId(null);
      return;
    }
    if (activeMenuId === null || !filteredMenus.some((item) => normalizeNumericId(item.id) === activeMenuId)) {
      setActiveMenuId(normalizeNumericId(filteredMenus[0].id));
    }
  }, [activeMenuId, filteredMenus]);

  useEffect(() => {
    if (!grantDetail) return;
    setSelectedMenuCodes(grantDetail.menuCodes);
    setSelectedActionCodes(grantDetail.actionCodes);
    setDataScopeType(grantDetail.dataScopes[0]?.scopeType ?? 'all');
    setDataScopeValues((grantDetail.dataScopes[0]?.scopeValues ?? []).join(','));
  }, [grantDetail]);

  const toggleMenuCode = (code: string) => {
    setSelectedMenuCodes((prev) => (
      prev.includes(code) ? prev.filter((item) => item !== code) : [...prev, code]
    ));
  };

  const toggleActionCode = (code: string) => {
    setSelectedActionCodes((prev) => (
      prev.includes(code) ? prev.filter((item) => item !== code) : [...prev, code]
    ));
  };

  const resetDraft = () => {
    if (!grantDetail) return;
    setSelectedMenuCodes(grantDetail.menuCodes);
    setSelectedActionCodes(grantDetail.actionCodes);
    setDataScopeType(grantDetail.dataScopes[0]?.scopeType ?? 'all');
    setDataScopeValues((grantDetail.dataScopes[0]?.scopeValues ?? []).join(','));
  };

  const handleSave = async () => {
    if (!activeRoleId) return;
    if (isSystemRole) {
      showToast({ type: 'warning', message: '系统预置角色不允许直接改授权，请先复制为租户角色。' });
      return;
    }
    try {
      await updateRolePermissionsMutation.mutateAsync({
        roleId: activeRoleId,
        payload: {
          menuCodes: selectedMenuCodes,
          actionCodes: selectedActionCodes,
          dataScopes: [{
            scopeType: dataScopeType,
            scopeValues: parseCodeList(dataScopeValues).map((item) => (Number.isNaN(Number(item)) ? item : Number(item))),
          }],
        },
      });
      showToast({ type: 'success', message: '角色授权已保存' });
    } catch (err) {
      showToast({ type: 'error', message: (err as Error).message || '保存角色授权失败' });
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>角色授权</h1>
          <p className={styles.subtitle}>按角色维护菜单、功能点与数据范围，保存后影响登录权限快照。</p>
        </div>
        <div className={styles.actions}>
          <Button variant="ghost" onClick={resetDraft} disabled={!grantDetail || grantLoading}>回填当前授权</Button>
          <Button
            variant="primary"
            loading={updateRolePermissionsMutation.isPending}
            onClick={() => void handleSave()}
            disabled={!activeRoleId || isSystemRole}
          >
            保存授权
          </Button>
        </div>
      </div>

      <div className={styles.split}>
        <section className={`${styles.card} ${styles.stickyCard}`}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>角色列表</h2>
            <span className={styles.tag}>{filteredRoles.length}</span>
          </div>
          <div className={`${styles.cardBody} ${styles.scrollCardBody}`}>
            <div className={styles.stack}>
              <input
                className={styles.input}
                placeholder="搜索角色名称/编码"
                value={roleKeyword}
                onChange={(event) => setRoleKeyword(event.target.value)}
              />
              {roleError && <div className={styles.hint}>角色加载失败：{(roleError as Error).message}</div>}
              {!roleError && (
                <div className={styles.list}>
                  {roleLoading && <div className={styles.hint}>加载中...</div>}
                  {!roleLoading && filteredRoles.length === 0 && <div className={styles.hint}>暂无角色数据。</div>}
                  {!roleLoading && filteredRoles.map((role) => (
                    <button
                      key={role.id}
                      type="button"
                      className={`${styles.listItem} ${activeRoleId === normalizeNumericId(role.id) ? styles.listItemActive : ''}`}
                      onClick={() => {
                        const nextRoleId = normalizeNumericId(role.id);
                        if (nextRoleId !== null) {
                          setActiveRoleId(nextRoleId);
                        }
                      }}
                    >
                      {role.name}（{role.code}）
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>授权编辑</h2>
          </div>
          <div className={styles.cardBody}>
            {!activeRoleId && <div className={styles.hint}>请选择左侧角色。</div>}
            {activeRoleId && grantError && (
              <div className={styles.hint}>授权详情加载失败：{(grantError as Error).message}</div>
            )}
            {activeRoleId && !grantError && (
              <div className={styles.stack}>
                {grantLoading && <div className={styles.hint}>加载中...</div>}
                {!grantLoading && grantDetail && (
                  <>
                    <div className={styles.hint}>
                      角色：{grantDetail.roleName}（{grantDetail.roleCode}） · 当前菜单 {selectedMenuCodes.length} 个 · 功能点 {selectedActionCodes.length} 个
                    </div>
                    {isSystemRole && (
                      <div className={styles.warningBox}>当前为系统预置角色，仅支持查看授权明细，不允许直接保存修改。</div>
                    )}

                    <div className={styles.formGrid}>
                      <div className={styles.field}>
                        <label className={styles.label}>数据范围类型</label>
                        <select className={styles.select} value={dataScopeType} onChange={(e) => setDataScopeType(e.target.value)}>
                          <option value="all">全部数据</option>
                          <option value="department">部门维度</option>
                          <option value="warehouse_assigned">指定仓库</option>
                          <option value="self">仅本人</option>
                        </select>
                      </div>
                      <div className={styles.field}>
                        <label className={styles.label}>数据范围值</label>
                        <input
                          className={styles.input}
                          value={dataScopeValues}
                          onChange={(e) => setDataScopeValues(e.target.value)}
                          placeholder="逗号分隔，如 1,2,3 或 WH-A,WH-B"
                        />
                        <div className={styles.help}>仅在非“全部数据”时填写，支持 ID 或业务编码。</div>
                      </div>
                    </div>

                    <div className={styles.catalogGrid}>
                      <div className={styles.catalogCard}>
                        <h3 className={styles.catalogCardTitle}>菜单目录</h3>
                        <div className={styles.stack}>
                          <input
                            className={styles.input}
                            placeholder="搜索菜单名称/编码"
                            value={menuKeyword}
                            onChange={(event) => setMenuKeyword(event.target.value)}
                          />
                          {menuError && <div className={styles.hint}>菜单目录加载失败：{(menuError as Error).message}</div>}
                          {!menuError && (
                            <div className={styles.catalogList}>
                              {menuLoading && <div className={styles.hint}>加载中...</div>}
                              {!menuLoading && filteredMenus.map((menu) => {
                                const checked = selectedMenuCodes.includes(menu.code);
                                const normalizedMenuId = normalizeNumericId(menu.id);
                                return (
                                  <button
                                    key={menu.id}
                                    type="button"
                                    className={`${styles.listItem} ${activeMenuId === normalizedMenuId ? styles.listItemActive : ''}`}
                                    onClick={() => {
                                      if (normalizedMenuId !== null) {
                                        setActiveMenuId(normalizedMenuId);
                                      }
                                    }}
                                  >
                                    <div className={styles.checkBody}>
                                      <span className={styles.checkTitle}>{menu.name}</span>
                                      <span className={styles.checkMeta}>{menu.code}</span>
                                      <span className={styles.checkMeta}>{checked ? '已授权' : '未授权'}</span>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className={styles.catalogCard}>
                        <div className={styles.sectionHeader}>
                          <div>
                            <h3 className={styles.catalogCardTitle}>菜单与功能点明细</h3>
                            <div className={styles.metaText}>
                              {activeMenu ? `${activeMenu.code} · ${activeMenu.routePath ?? '未配置路由'}` : '请选择左侧菜单'}
                            </div>
                          </div>
                          {activeMenu && (
                            <Button
                              variant={selectedMenuCodes.includes(activeMenu.code) ? 'secondary' : 'primary'}
                              size="sm"
                              onClick={() => toggleMenuCode(activeMenu.code)}
                            >
                              {selectedMenuCodes.includes(activeMenu.code) ? '移出菜单授权' : '加入菜单授权'}
                            </Button>
                          )}
                        </div>

                        {!activeMenu && <div className={styles.emptyState}>请选择菜单后维护对应功能点授权。</div>}
                        {activeMenu && (
                          <div className={styles.stack}>
                            <div className={styles.hint}>
                              说明：菜单授权决定页面可见；功能点授权决定页面中的新增、编辑、审批、导出等操作是否可执行。
                            </div>
                            <div className={styles.tableWrap}>
                              <table className={styles.table}>
                                <thead>
                                  <tr>
                                    <th>功能编码</th>
                                    <th>功能名称</th>
                                    <th>动作类型</th>
                                    <th>授权</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {actionError && (
                                    <tr>
                                      <td colSpan={4} className={styles.muted}>功能点加载失败：{(actionError as Error).message}</td>
                                    </tr>
                                  )}
                                  {!actionError && actionLoading && (
                                    <tr>
                                      <td colSpan={4} className={styles.muted}>加载中...</td>
                                    </tr>
                                  )}
                                  {!actionError && !actionLoading && activeMenuActions.length === 0 && (
                                    <tr>
                                      <td colSpan={4} className={styles.muted}>当前菜单暂无功能点。</td>
                                    </tr>
                                  )}
                                  {!actionError && !actionLoading && activeMenuActions.map((action) => {
                                    const checked = selectedActionCodes.includes(action.code);
                                    return (
                                      <tr key={action.id}>
                                        <td>{action.code}</td>
                                        <td>{action.name}</td>
                                        <td>{action.actionType}</td>
                                        <td>
                                          <Button
                                            variant={checked ? 'secondary' : 'primary'}
                                            size="sm"
                                            onClick={() => toggleActionCode(action.code)}
                                          >
                                            {checked ? '已授权' : '授权'}
                                          </Button>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
