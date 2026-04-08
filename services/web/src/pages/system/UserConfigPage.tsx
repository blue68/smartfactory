import { useEffect, useState } from 'react';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import {
  useAccessUserList,
  useCreateUser,
  useResetUserPassword,
  useUpdateUser,
  useUpdateUserStatus,
} from '@/api/accessControl';
import { useAppStore } from '@/stores/appStore';
import type { AccessUserSummary, UserMutationPayload } from '@/types/accessControl';
import styles from './SystemPageShell.module.css';

const EMPTY_FORM: UserMutationPayload = {
  username: '',
  realName: '',
  initialPassword: '123456',
  status: 'active',
};

function renderStatus(status?: string) {
  const cls = status === 'active' ? styles.statusActive : status === 'locked' ? styles.statusLocked : styles.statusInactive;
  const text = status === 'active' ? '启用' : status === 'locked' ? '锁定' : status || '-';
  return <span className={`${styles.statusBadge} ${cls}`}>{text}</span>;
}

export default function UserConfigPage() {
  const setPageTitle = useAppStore((s) => s.setPageTitle);
  const showToast = useAppStore((s) => s.showToast);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AccessUserSummary | null>(null);
  const [form, setForm] = useState<UserMutationPayload>(EMPTY_FORM);

  const { data, isLoading, error } = useAccessUserList({
    page: 1,
    pageSize: 30,
    keyword: keyword.trim() || undefined,
    status: status || undefined,
  });
  const createUserMutation = useCreateUser();
  const updateUserMutation = useUpdateUser();
  const updateUserStatusMutation = useUpdateUserStatus();
  const resetPasswordMutation = useResetUserPassword();

  useEffect(() => {
    setPageTitle('系统管理 · 人员配置');
  }, [setPageTitle]);

  const users = data?.list ?? [];
  const activeCount = users.filter((item) => item.status === 'active').length;

  const resetFilters = () => {
    setKeyword('');
    setStatus('');
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingUser(null);
    setForm(EMPTY_FORM);
  };

  const openCreate = () => {
    setEditingUser(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (user: AccessUserSummary) => {
    setEditingUser(user);
    setForm({
      username: user.username,
      realName: user.realName,
      status: user.status ?? 'active',
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.username?.trim() || !form.realName?.trim()) {
      showToast({ type: 'warning', message: '请填写账号和姓名' });
      return;
    }
    try {
      if (editingUser) {
        await updateUserMutation.mutateAsync({
          id: editingUser.id,
          payload: {
            username: form.username.trim(),
            realName: form.realName.trim(),
            status: form.status,
          },
        });
        showToast({ type: 'success', message: '人员信息已更新' });
      } else {
        await createUserMutation.mutateAsync({
          username: form.username.trim(),
          realName: form.realName.trim(),
          initialPassword: form.initialPassword?.trim() || '123456',
          status: form.status,
        });
        showToast({ type: 'success', message: '人员账号已创建' });
      }
      closeModal();
    } catch (err) {
      showToast({ type: 'error', message: (err as Error).message || '人员保存失败' });
    }
  };

  const handleToggleStatus = async (user: AccessUserSummary) => {
    const nextAction = user.status === 'active' ? '停用' : '启用';
    const confirmed = window.confirm(`确认${nextAction}人员“${user.realName}”吗？`);
    if (!confirmed) return;
    try {
      await updateUserStatusMutation.mutateAsync({
        id: user.id,
        payload: { status: user.status === 'active' ? 'inactive' : 'active' },
      });
      showToast({ type: 'success', message: '人员状态已更新' });
    } catch (err) {
      showToast({ type: 'error', message: (err as Error).message || '人员状态更新失败' });
    }
  };

  const handleResetPassword = async (user: AccessUserSummary) => {
    const confirmed = window.confirm(`确认将“${user.realName}”的密码重置为 123456 吗？`);
    if (!confirmed) return;
    try {
      await resetPasswordMutation.mutateAsync({ id: user.id, payload: { newPassword: '123456' } });
      showToast({ type: 'success', message: `${user.realName} 的密码已重置为 123456` });
    } catch (err) {
      showToast({ type: 'error', message: (err as Error).message || '密码重置失败' });
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>人员配置</h1>
          <p className={styles.subtitle}>支持人员账号新增、编辑、启停和密码重置，作为角色分配的基础数据。</p>
        </div>
        <Button variant="primary" onClick={openCreate}>+ 新建人员</Button>
      </div>

      <div className={styles.stats}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>人员总数</div>
          <div className={styles.statValue}>{data?.total ?? 0}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>启用中</div>
          <div className={styles.statValue}>{activeCount}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>未分配角色</div>
          <div className={styles.statValue}>{users.filter((item) => (item.roleCount ?? 0) === 0).length}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>接口状态</div>
          <div className={styles.statValue}>{error ? '异常' : isLoading ? '加载中' : '正常'}</div>
        </div>
      </div>

      <div className={styles.filterBar}>
        <input
          className={styles.input}
          placeholder="搜索账号/姓名"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
        <select className={styles.select} value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">全部状态</option>
          <option value="active">启用</option>
          <option value="inactive">禁用</option>
          <option value="locked">锁定</option>
        </select>
        <Button variant="ghost" onClick={resetFilters}>重置筛选</Button>
      </div>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>人员列表</h2>
          <span className={styles.tag}>{users.length}</span>
        </div>
        <div className={styles.cardBody}>
          {error && <div className={styles.hint}>人员加载失败：{(error as Error).message}</div>}
          {!error && (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>账号</th>
                    <th>姓名</th>
                    <th>部门</th>
                    <th>岗位</th>
                    <th>角色数</th>
                    <th>主角色</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && (
                    <tr>
                      <td colSpan={8} className={styles.muted}>加载中...</td>
                    </tr>
                  )}
                  {!isLoading && users.length === 0 && (
                    <tr>
                      <td colSpan={8} className={styles.muted}>暂无人员数据。</td>
                    </tr>
                  )}
                  {!isLoading && users.map((user) => (
                    <tr key={user.id}>
                      <td>{user.username}</td>
                      <td>{user.realName}</td>
                      <td>{user.department ?? '-'}</td>
                      <td>{user.position ?? '-'}</td>
                      <td>{user.roleCount ?? 0}</td>
                      <td>{user.primaryRoleName ?? '-'}</td>
                      <td>{renderStatus(user.status)}</td>
                      <td>
                        <div className={styles.tableActions}>
                          <Button variant="secondary" size="sm" onClick={() => openEdit(user)}>编辑</Button>
                          <Button variant={user.status === 'active' ? 'warning' : 'success'} size="sm" onClick={() => void handleToggleStatus(user)}>
                            {user.status === 'active' ? '停用' : '启用'}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => void handleResetPassword(user)}>重置密码</Button>
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
        title={editingUser ? `编辑人员 · ${editingUser.realName}` : '新增人员'}
        onClose={closeModal}
        onConfirm={() => void handleSave()}
        confirmLabel={editingUser ? '保存人员' : '创建账号'}
        confirmLoading={createUserMutation.isPending || updateUserMutation.isPending}
      >
        <div className={styles.fieldGrid}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>账号</span>
            <input className={styles.input} value={form.username ?? ''} onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))} />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>姓名</span>
            <input className={styles.input} value={form.realName ?? ''} onChange={(e) => setForm((prev) => ({ ...prev, realName: e.target.value }))} />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>状态</span>
            <select className={styles.select} value={form.status ?? 'active'} onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}>
              <option value="active">启用</option>
              <option value="inactive">禁用</option>
            </select>
          </div>
          {!editingUser && (
            <div className={styles.field}>
              <span className={styles.fieldLabel}>初始密码</span>
              <input className={styles.input} value={form.initialPassword ?? '123456'} onChange={(e) => setForm((prev) => ({ ...prev, initialPassword: e.target.value }))} />
              <span className={styles.fieldHint}>为空时默认使用 `123456`。</span>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
