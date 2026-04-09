import { useEffect, useMemo, useState } from 'react';
import Button from '@/components/common/Button';
import {
  useAccessUserList,
  useAssignUserRoles,
  useRoleList,
  useUserRoleAssignments,
} from '@/api/accessControl';
import { useAppStore } from '@/stores/appStore';
import styles from './SystemPageShell.module.css';

function getRoleDisplayName(role: { code?: string; name: string }): string {
  return role.code === 'purchase' ? `${role.name}（旧编码兼容）` : role.name;
}

export default function UserRoleAssignmentPage() {
  const setPageTitle = useAppStore((s) => s.setPageTitle);
  const showToast = useAppStore((s) => s.showToast);
  const [userKeyword, setUserKeyword] = useState('');
  const [roleKeyword, setRoleKeyword] = useState('');
  const { data: userData, isLoading: userLoading, error: userError } = useAccessUserList({
    page: 1,
    pageSize: 100,
  });
  const { data: roleData } = useRoleList({ page: 1, pageSize: 200 });
  const userList = useMemo(() => {
    const keyword = userKeyword.trim().toLowerCase();
    const list = userData?.list ?? [];
    if (!keyword) return list;
    return list.filter((user) => (
      user.realName.toLowerCase().includes(keyword) || user.username.toLowerCase().includes(keyword)
    ));
  }, [userData?.list, userKeyword]);
  const roleList = useMemo(() => {
    const keyword = roleKeyword.trim().toLowerCase();
    const list = (roleData?.list ?? []).filter((role) => role.status !== 'inactive' && role.assignable !== false && role.assignable !== 0);
    if (!keyword) return list;
    return list.filter((role) => role.name.toLowerCase().includes(keyword) || role.code.toLowerCase().includes(keyword));
  }, [roleData?.list, roleKeyword]);
  const [activeUserId, setActiveUserId] = useState<number | null>(null);
  const {
    data: assignments = [],
    isLoading: assignmentLoading,
    error: assignmentError,
  } = useUserRoleAssignments(activeUserId);
  const assignUserRolesMutation = useAssignUserRoles();
  const [selectedRoleIds, setSelectedRoleIds] = useState<number[]>([]);
  const [primaryRoleId, setPrimaryRoleId] = useState<number | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');

  useEffect(() => {
    setPageTitle('系统管理 · 人员角色分配');
  }, [setPageTitle]);

  useEffect(() => {
    if (userList.length === 0) {
      setActiveUserId(null);
      return;
    }
    if (activeUserId === null || !userList.some((item) => item.id === activeUserId)) {
      setActiveUserId(userList[0].id);
    }
  }, [activeUserId, userList]);

  useEffect(() => {
    if (assignments.length === 0) {
      setSelectedRoleIds([]);
      setPrimaryRoleId(null);
      setEffectiveFrom('');
      setEffectiveTo('');
      return;
    }
    setSelectedRoleIds(assignments.map((item) => item.roleId));
    setPrimaryRoleId(assignments.find((item) => item.isPrimary)?.roleId ?? assignments[0]?.roleId ?? null);
    setEffectiveFrom(assignments[0]?.effectiveFrom ? String(assignments[0].effectiveFrom).slice(0, 10) : '');
    setEffectiveTo(assignments[0]?.effectiveTo ? String(assignments[0].effectiveTo).slice(0, 10) : '');
  }, [assignments]);

  const activeUser = userList.find((item) => item.id === activeUserId) ?? null;
  const selectedRoleCount = useMemo(() => selectedRoleIds.length, [selectedRoleIds]);

  const toggleRole = (roleId: number) => {
    setSelectedRoleIds((prev) => {
      const next = prev.includes(roleId)
        ? prev.filter((item) => item !== roleId)
        : [...prev, roleId];
      setPrimaryRoleId((currentPrimary) => {
        if (!next.includes(currentPrimary ?? -1)) {
          return next[0] ?? null;
        }
        return currentPrimary ?? roleId;
      });
      return next;
    });
  };

  const resetDraft = () => {
    if (assignments.length === 0) {
      setSelectedRoleIds([]);
      setPrimaryRoleId(null);
      setEffectiveFrom('');
      setEffectiveTo('');
      return;
    }
    setSelectedRoleIds(assignments.map((item) => item.roleId));
    setPrimaryRoleId(assignments.find((item) => item.isPrimary)?.roleId ?? assignments[0]?.roleId ?? null);
    setEffectiveFrom(assignments[0]?.effectiveFrom ? String(assignments[0].effectiveFrom).slice(0, 10) : '');
    setEffectiveTo(assignments[0]?.effectiveTo ? String(assignments[0].effectiveTo).slice(0, 10) : '');
  };

  const handleSave = async () => {
    if (!activeUserId) return;
    if (selectedRoleIds.length === 0) {
      showToast({ type: 'warning', message: '请至少选择一个角色' });
      return;
    }
    if (primaryRoleId === null || !selectedRoleIds.includes(primaryRoleId)) {
      showToast({ type: 'warning', message: '请设置主角色且主角色必须在已选角色中' });
      return;
    }
    if (effectiveFrom && effectiveTo && new Date(effectiveFrom).getTime() > new Date(effectiveTo).getTime()) {
      showToast({ type: 'warning', message: '生效日期不能晚于失效日期' });
      return;
    }

    try {
      await assignUserRolesMutation.mutateAsync({
        userId: activeUserId,
        payload: {
          assignments: selectedRoleIds.map((roleId) => ({
            roleId,
            isPrimary: roleId === primaryRoleId,
            effectiveFrom: effectiveFrom || null,
            effectiveTo: effectiveTo || null,
          })),
        },
      });
      showToast({ type: 'success', message: '人员角色分配已保存' });
    } catch (err) {
      showToast({ type: 'error', message: (err as Error).message || '保存角色分配失败' });
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>人员角色分配</h1>
          <p className={styles.subtitle}>为人员配置主角色与附加角色，并设置统一生效区间。</p>
        </div>
        <div className={styles.actions}>
          <Button variant="ghost" onClick={resetDraft} disabled={assignmentLoading}>回填当前分配</Button>
          <Button variant="primary" loading={assignUserRolesMutation.isPending} onClick={() => void handleSave()}>
            保存分配
          </Button>
        </div>
      </div>

      <div className={styles.split}>
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>人员列表</h2>
          </div>
          <div className={styles.cardBody}>
            <div className={styles.stack}>
              <input
                className={styles.input}
                placeholder="搜索人员姓名/账号"
                value={userKeyword}
                onChange={(event) => setUserKeyword(event.target.value)}
              />
              {userError && <div className={styles.hint}>人员加载失败：{(userError as Error).message}</div>}
              {!userError && (
                <div className={styles.list}>
                  {userLoading && <div className={styles.hint}>加载中...</div>}
                  {!userLoading && userList.length === 0 && <div className={styles.hint}>暂无人员数据。</div>}
                  {!userLoading && userList.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      className={`${styles.listItem} ${activeUserId === user.id ? styles.listItemActive : ''}`}
                      onClick={() => setActiveUserId(user.id)}
                    >
                      {user.realName}（{user.username}）
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>分配编辑</h2>
          </div>
          <div className={styles.cardBody}>
            {!activeUser && <div className={styles.hint}>请选择左侧人员。</div>}
            {activeUser && (
              <div className={styles.stack}>
                <div className={styles.hint}>
                  当前人员：{activeUser.realName}；主角色：{activeUser.primaryRoleName ?? '未设置'}；已选角色：{selectedRoleCount}
                </div>
                <div className={styles.formGrid}>
                  <div className={`${styles.field} ${styles.fieldFull}`}>
                    <label className={styles.label}>角色选择</label>
                    <input
                      className={styles.input}
                      placeholder="搜索角色名称/编码"
                      value={roleKeyword}
                      onChange={(event) => setRoleKeyword(event.target.value)}
                    />
                    <div className={styles.codeList}>
                      {roleList.map((role) => (
                        <label key={role.id} className={styles.codeChip}>
                          <input
                            type="checkbox"
                            checked={selectedRoleIds.includes(role.id)}
                            onChange={() => toggleRole(role.id)}
                          />
                          <span>{getRoleDisplayName(role)}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>主角色</label>
                    <select
                      className={styles.select}
                      value={primaryRoleId ?? ''}
                      onChange={(event) => setPrimaryRoleId(Number(event.target.value))}
                    >
                      <option value="">请选择主角色</option>
                      {roleList.filter((role) => selectedRoleIds.includes(role.id)).map((role) => (
                        <option key={role.id} value={role.id}>{getRoleDisplayName(role)}</option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>生效日期</label>
                    <input className={styles.input} type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>失效日期</label>
                    <input className={styles.input} type="date" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} />
                  </div>
                </div>
                <div className={styles.help}>说明：本页按当前人员统一设置生效区间；如后续需要按角色分别生效，可在二期细化为逐角色时间窗。</div>

                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>角色编码</th>
                      <th>角色名称</th>
                      <th>主角色</th>
                      <th>生效时间</th>
                      <th>失效时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignmentError && (
                      <tr>
                        <td colSpan={5} className={styles.muted}>角色分配加载失败：{(assignmentError as Error).message}</td>
                      </tr>
                    )}
                    {!assignmentError && assignmentLoading && (
                      <tr>
                        <td colSpan={5} className={styles.muted}>加载中...</td>
                      </tr>
                    )}
                    {!assignmentError && !assignmentLoading && assignments.length === 0 && (
                      <tr>
                        <td colSpan={5} className={styles.muted}>当前人员尚未分配角色。</td>
                      </tr>
                    )}
                    {!assignmentError && !assignmentLoading && assignments.map((item) => (
                      <tr key={item.id}>
                        <td>{item.roleCode}</td>
                        <td>{getRoleDisplayName({ code: item.roleCode, name: item.roleName })}</td>
                        <td>{item.isPrimary ? '是' : '否'}</td>
                        <td>{item.effectiveFrom ? String(item.effectiveFrom).slice(0, 10) : '-'}</td>
                        <td>{item.effectiveTo ? String(item.effectiveTo).slice(0, 10) : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
