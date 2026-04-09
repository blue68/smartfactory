import { useEffect, useState } from 'react';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import {
  useCreateRole,
  useRoleList,
  useUpdateRole,
  useUpdateRoleStatus,
} from '@/api/accessControl';
import { useAppStore } from '@/stores/appStore';
import type { RoleMutationPayload, RoleSummary } from '@/types/accessControl';
import styles from './SystemPageShell.module.css';

const EMPTY_FORM: RoleMutationPayload = {
  code: '',
  name: '',
  description: '',
  priority: 0,
  status: 'active',
  dataScopeTemplate: 'all',
  assignable: true,
};

function getRoleDisplayName(role: Pick<RoleSummary, 'code' | 'name'>): string {
  return role.code === 'purchase' ? `${role.name}（旧编码兼容）` : role.name;
}

function renderStatus(status?: string) {
  const cls = status === 'active' ? styles.statusActive : styles.statusInactive;
  return <span className={`${styles.statusBadge} ${cls}`}>{status === 'active' ? '启用' : status || '-'}</span>;
}

export default function RoleConfigPage() {
  const setPageTitle = useAppStore((s) => s.setPageTitle);
  const showToast = useAppStore((s) => s.showToast);
  const [keyword, setKeyword] = useState('');
  const [roleType, setRoleType] = useState('');
  const [status, setStatus] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleSummary | null>(null);
  const [form, setForm] = useState<RoleMutationPayload>(EMPTY_FORM);

  const { data, isLoading, error } = useRoleList({
    page: 1,
    pageSize: 30,
    keyword: keyword.trim() || undefined,
    status: status || undefined,
    roleType: (roleType as 'system' | 'custom' | '') || undefined,
  });
  const createRoleMutation = useCreateRole();
  const updateRoleMutation = useUpdateRole();
  const updateRoleStatusMutation = useUpdateRoleStatus();

  useEffect(() => {
    setPageTitle('系统管理 · 角色配置');
  }, [setPageTitle]);

  const roles = data?.list ?? [];
  const systemRoleCount = roles.filter((role) => role.roleType === 'system').length;
  const customRoleCount = roles.filter((role) => role.roleType !== 'system').length;

  const resetFilters = () => {
    setKeyword('');
    setRoleType('');
    setStatus('');
  };

  const openCreate = () => {
    setEditingRole(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (role: RoleSummary) => {
    setEditingRole(role);
      setForm({
        code: role.code,
        name: role.code === 'purchase' ? '采购员' : role.name,
        description: role.description ?? '',
        priority: role.priority ?? 0,
        status: role.status ?? 'active',
      dataScopeTemplate: role.dataScopeTemplate ?? 'all',
      assignable: role.assignable !== false && role.assignable !== 0,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.code?.trim() || !form.name?.trim()) {
      showToast({ type: 'warning', message: '请填写角色编码和角色名称' });
      return;
    }
    try {
      if (editingRole) {
        await updateRoleMutation.mutateAsync({
          id: editingRole.id,
          payload: {
            ...form,
            code: form.code.trim(),
            name: form.name.trim(),
            description: form.description?.trim() || null,
          },
        });
        showToast({ type: 'success', message: '角色已更新' });
      } else {
        await createRoleMutation.mutateAsync({
          ...form,
          code: form.code.trim(),
          name: form.name.trim(),
          description: form.description?.trim() || null,
        });
        showToast({ type: 'success', message: '角色已创建' });
      }
      setModalOpen(false);
    } catch (err) {
      showToast({ type: 'error', message: (err as Error).message || '角色保存失败' });
    }
  };

  const handleToggleStatus = async (role: RoleSummary) => {
    const nextAction = role.status === 'active' ? '停用' : '启用';
    const confirmed = window.confirm(`确认${nextAction}角色“${getRoleDisplayName(role)}”吗？`);
    if (!confirmed) return;
    try {
      await updateRoleStatusMutation.mutateAsync({
        id: role.id,
        payload: { status: role.status === 'active' ? 'inactive' : 'active' },
      });
      showToast({ type: 'success', message: '角色状态已更新' });
    } catch (err) {
      showToast({ type: 'error', message: (err as Error).message || '角色状态更新失败' });
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>角色配置</h1>
          <p className={styles.subtitle}>维护系统角色与租户角色，支持优先级、数据范围模板和可分配状态管理。</p>
        </div>
        <Button variant="primary" onClick={openCreate}>+ 新建角色</Button>
      </div>

      <div className={styles.stats}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>角色总数</div>
          <div className={styles.statValue}>{data?.total ?? 0}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>系统预置</div>
          <div className={styles.statValue}>{systemRoleCount}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>租户自定义</div>
          <div className={styles.statValue}>{customRoleCount}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>接口状态</div>
          <div className={styles.statValue}>{error ? '异常' : isLoading ? '加载中' : '正常'}</div>
        </div>
      </div>

      <div className={styles.filterBar}>
        <input
          className={styles.input}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="搜索角色名称/编码"
        />
        <select className={styles.select} value={roleType} onChange={(event) => setRoleType(event.target.value)}>
          <option value="">全部类型</option>
          <option value="system">系统预置</option>
          <option value="custom">租户自定义</option>
        </select>
        <select className={styles.select} value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">全部状态</option>
          <option value="active">启用</option>
          <option value="inactive">停用</option>
        </select>
        <Button variant="ghost" onClick={resetFilters}>重置筛选</Button>
      </div>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>角色列表</h2>
          <span className={styles.tag}>{roles.length}</span>
        </div>
        <div className={styles.cardBody}>
          {error && <div className={styles.hint}>角色加载失败：{(error as Error).message}</div>}
          {!error && (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>角色编码</th>
                    <th>角色名称</th>
                    <th>类型</th>
                    <th>状态</th>
                    <th>数据范围</th>
                    <th>绑定人数</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && (
                    <tr>
                      <td colSpan={7} className={styles.muted}>加载中...</td>
                    </tr>
                  )}
                  {!isLoading && roles.length === 0 && (
                    <tr>
                      <td colSpan={7} className={styles.muted}>暂无角色数据。</td>
                    </tr>
                  )}
                  {!isLoading && roles.map((role) => (
                    <tr key={role.id}>
                      <td>{role.code}</td>
                      <td>{getRoleDisplayName(role)}</td>
                      <td>{role.roleType === 'system' ? '系统预置' : '租户自定义'}</td>
                      <td>{renderStatus(role.status)}</td>
                      <td>{role.dataScopeTemplate ?? '-'}</td>
                      <td>{role.assignedUserCount ?? 0}</td>
                      <td>
                        <div className={styles.tableActions}>
                          {role.roleType !== 'system' ? (
                            <Button variant="secondary" size="sm" onClick={() => openEdit(role)}>编辑</Button>
                          ) : (
                            <span className={styles.muted}>系统预置</span>
                          )}
                          {role.roleType !== 'system' && (
                            <Button
                              variant={role.status === 'active' ? 'warning' : 'success'}
                              size="sm"
                              onClick={() => void handleToggleStatus(role)}
                              loading={updateRoleStatusMutation.isPending}
                            >
                              {role.status === 'active' ? '停用' : '启用'}
                            </Button>
                          )}
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

      <Modal
        open={modalOpen}
        title={editingRole ? `编辑角色 · ${editingRole.name}` : '新增角色'}
        onClose={() => setModalOpen(false)}
        onConfirm={() => void handleSave()}
        confirmLabel={editingRole ? '保存角色' : '创建角色'}
        confirmLoading={createRoleMutation.isPending || updateRoleMutation.isPending}
      >
        <div className={styles.fieldGrid}>
          {editingRole?.roleType === 'system' && (
            <div className={`${styles.field} ${styles.fieldWide}`}>
              <div className={styles.warningBox}>系统预置角色不允许直接编辑或停用，如需调整授权，请先复制为租户自定义角色。</div>
            </div>
          )}
          <div className={styles.field}>
            <span className={styles.fieldLabel}>角色编码</span>
            <input className={styles.input} value={form.code ?? ''} onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))} />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>角色名称</span>
            <input className={styles.input} value={form.name ?? ''} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
          </div>
          <div className={`${styles.field} ${styles.fieldWide}`}>
            <span className={styles.fieldLabel}>角色说明</span>
            <textarea className={styles.textarea} value={form.description ?? ''} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>角色状态</span>
            <select className={styles.select} value={form.status ?? 'active'} onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}>
              <option value="active">启用</option>
              <option value="inactive">停用</option>
            </select>
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>优先级</span>
            <input className={styles.input} type="number" value={form.priority ?? 0} onChange={(e) => setForm((prev) => ({ ...prev, priority: Number(e.target.value) || 0 }))} />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>数据范围模板</span>
            <select className={styles.select} value={form.dataScopeTemplate ?? 'all'} onChange={(e) => setForm((prev) => ({ ...prev, dataScopeTemplate: e.target.value }))}>
              <option value="all">全部数据</option>
              <option value="department">部门维度</option>
              <option value="self">仅本人</option>
            </select>
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>可分配</span>
            <select className={styles.select} value={form.assignable === false ? '0' : '1'} onChange={(e) => setForm((prev) => ({ ...prev, assignable: e.target.value === '1' }))}>
              <option value="1">允许分配</option>
              <option value="0">禁止分配</option>
            </select>
          </div>
        </div>
      </Modal>
    </div>
  );
}
