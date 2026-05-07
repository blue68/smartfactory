import { useMemo, useState } from 'react';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import {
  useCreateDepartment,
  useDepartmentList,
  useUpdateDepartment,
  useUpdateDepartmentStatus,
} from '@/api/departments';
import { useAppStore } from '@/stores/appStore';
import type { DepartmentMutationPayload, DepartmentSummary } from '@/types/models';
import styles from './SystemPageShell.module.css';

const EMPTY_FORM: DepartmentMutationPayload = {
  code: '',
  name: '',
  status: 'active',
  sortOrder: 0,
  notes: '',
};

function renderStatus(status?: string) {
  const cls = status === 'active' ? styles.statusActive : status === 'locked' ? styles.statusLocked : styles.statusInactive;
  const text = status === 'active'
    ? '启用'
    : status === 'locked'
      ? '锁定'
      : status === 'archived'
        ? '归档'
        : status === 'inactive'
          ? '停用'
          : status || '-';
  return <span className={`${styles.statusBadge} ${cls}`}>{text}</span>;
}

export default function DepartmentConfigSection() {
  const showToast = useAppStore((s) => s.showToast);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingDepartment, setEditingDepartment] = useState<DepartmentSummary | null>(null);
  const [form, setForm] = useState<DepartmentMutationPayload>(EMPTY_FORM);

  const { data, isLoading, error } = useDepartmentList({
    page: 1,
    pageSize: 200,
    keyword: keyword.trim() || undefined,
    status: status || undefined,
  });
  const createMutation = useCreateDepartment();
  const updateMutation = useUpdateDepartment();
  const updateStatusMutation = useUpdateDepartmentStatus();

  const departments = useMemo(() => data?.list ?? [], [data?.list]);
  const activeCount = useMemo(
    () => departments.filter((item) => item.status === 'active').length,
    [departments],
  );

  const resetFilters = () => {
    setKeyword('');
    setStatus('');
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingDepartment(null);
    setForm(EMPTY_FORM);
  };

  const openCreate = () => {
    setEditingDepartment(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (department: DepartmentSummary) => {
    setEditingDepartment(department);
    setForm({
      code: department.code,
      name: department.name,
      status: department.status ?? 'active',
      sortOrder: department.sortOrder ?? 0,
      notes: department.notes ?? '',
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.code?.trim() || !form.name?.trim()) {
      showToast({ type: 'warning', message: '请填写部门编码和部门名称' });
      return;
    }

    const payload: DepartmentMutationPayload = {
      code: form.code.trim(),
      name: form.name.trim(),
      status: form.status ?? 'active',
      sortOrder: Number(form.sortOrder ?? 0),
      notes: form.notes?.trim() || null,
    };

    try {
      if (editingDepartment) {
        await updateMutation.mutateAsync({ id: editingDepartment.id, payload });
        showToast({ type: 'success', message: '部门已更新' });
      } else {
        await createMutation.mutateAsync(payload);
        showToast({ type: 'success', message: '部门已创建' });
      }
      closeModal();
    } catch (err) {
      showToast({ type: 'error', message: (err as Error).message || '部门保存失败' });
    }
  };

  const handleToggleStatus = async (department: DepartmentSummary) => {
    const nextStatus = department.status === 'active' ? 'inactive' : 'active';
    const confirmed = window.confirm(`确认将部门“${department.name}”切换为${nextStatus === 'active' ? '启用' : '停用'}吗？`);
    if (!confirmed) return;
    try {
      await updateStatusMutation.mutateAsync({ id: department.id, payload: { status: nextStatus } });
      showToast({ type: 'success', message: '部门状态已更新' });
    } catch (err) {
      showToast({ type: 'error', message: (err as Error).message || '部门状态更新失败' });
    }
  };

  return (
    <>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>部门配置</h1>
          <p className={styles.subtitle}>维护损耗品领用、固定资产责任归属所使用的部门主数据。</p>
        </div>
        <Button variant="primary" onClick={openCreate}>+ 新建部门</Button>
      </div>

      <div className={styles.stats}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>部门总数</div>
          <div className={styles.statValue}>{data?.total ?? 0}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>启用中</div>
          <div className={styles.statValue}>{activeCount}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>停用/归档</div>
          <div className={styles.statValue}>{departments.filter((item) => item.status && item.status !== 'active').length}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>接口状态</div>
          <div className={styles.statValue}>{error ? '异常' : isLoading ? '加载中' : '正常'}</div>
        </div>
      </div>

      <div className={styles.filterBar}>
        <input
          className={styles.input}
          placeholder="搜索部门编码 / 名称"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
        <select className={styles.select} value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">全部状态</option>
          <option value="active">启用</option>
          <option value="inactive">停用</option>
          <option value="locked">锁定</option>
          <option value="archived">归档</option>
        </select>
        <Button variant="ghost" onClick={resetFilters}>重置筛选</Button>
      </div>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>部门列表</h2>
          <span className={styles.tag}>{departments.length}</span>
        </div>
        <div className={styles.cardBody}>
          {error && <div className={styles.hint}>部门加载失败：{(error as Error).message}</div>}
          {!error && (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>编码</th>
                    <th>名称</th>
                    <th>排序</th>
                    <th>状态</th>
                    <th>备注</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && (
                    <tr>
                      <td colSpan={6} className={styles.muted}>加载中...</td>
                    </tr>
                  )}
                  {!isLoading && departments.length === 0 && (
                    <tr>
                      <td colSpan={6} className={styles.muted}>暂无部门数据。</td>
                    </tr>
                  )}
                  {!isLoading && departments.map((department) => (
                    <tr key={department.id}>
                      <td>{department.code}</td>
                      <td>{department.name}</td>
                      <td>{department.sortOrder ?? 0}</td>
                      <td>{renderStatus(department.status)}</td>
                      <td>{department.notes || '-'}</td>
                      <td>
                        <div className={styles.tableActions}>
                          <Button variant="secondary" size="sm" onClick={() => openEdit(department)}>编辑</Button>
                          <Button
                            variant={department.status === 'active' ? 'warning' : 'success'}
                            size="sm"
                            onClick={() => void handleToggleStatus(department)}
                          >
                            {department.status === 'active' ? '停用' : '启用'}
                          </Button>
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
        title={editingDepartment ? `编辑部门 · ${editingDepartment.name}` : '新增部门'}
        onClose={closeModal}
        onConfirm={() => void handleSave()}
        confirmLabel={editingDepartment ? '保存部门' : '创建部门'}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <div className={styles.fieldGrid}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>部门编码</span>
            <input className={styles.input} value={form.code ?? ''} onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))} />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>部门名称</span>
            <input className={styles.input} value={form.name ?? ''} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>状态</span>
            <select className={styles.select} value={form.status ?? 'active'} onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}>
              <option value="active">启用</option>
              <option value="inactive">停用</option>
              <option value="locked">锁定</option>
              <option value="archived">归档</option>
            </select>
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>排序</span>
            <input
              className={styles.input}
              type="number"
              value={form.sortOrder ?? 0}
              onChange={(e) => setForm((prev) => ({ ...prev, sortOrder: Number(e.target.value || 0) }))}
            />
          </div>
          <div className={`${styles.field} ${styles.fieldWide}`}>
            <span className={styles.fieldLabel}>备注</span>
            <textarea
              className={styles.textarea}
              rows={4}
              value={form.notes ?? ''}
              onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
              placeholder="例如 生产一部 / 设备维保中心"
            />
          </div>
        </div>
      </Modal>
    </>
  );
}
