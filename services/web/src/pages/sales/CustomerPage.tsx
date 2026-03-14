/**
 * [artifact:前端代码] — 客户管理页 R-07
 * 功能：统计卡片 / 筛选 / 表格 / 新增编辑 Modal / 详情 Drawer（含联系人）
 */

import { useState, useCallback } from 'react';
import Modal from '@/components/common/Modal';
import Drawer from '@/components/common/Drawer';
import Button from '@/components/common/Button';
import Table from '@/components/common/Table';
import type { Column } from '@/components/common/Table';
import {
  useCustomerList,
  useCustomer,
  useCustomerContacts,
  useCreateCustomer,
  useUpdateCustomer,
  useCreateCustomerContact,
  useDeleteCustomerContact,
  usePatchCustomerStatus,
  useUpdateCustomerContact,
  useCustomerOrders,
} from '@/api/customer';
import type { Customer, CustomerGrade, CustomerStatus, CreateCustomerPayload, CustomerContact } from '@/api/customer';
import styles from './CustomerPage.module.css';

// ─────────────────────────────────────────────
// 等级标签
// ─────────────────────────────────────────────

function GradeTag({ grade }: { grade: CustomerGrade }) {
  const cls =
    grade === 'VIP' ? styles.gradeVIP
    : grade === 'A' ? styles.gradeA
    : grade === 'B' ? styles.gradeB
    : styles.gradeC;
  return <span className={`${styles.grade} ${cls}`}>{grade}</span>;
}

// ─────────────────────────────────────────────
// 状态标签
// ─────────────────────────────────────────────

function StatusTag({ status }: { status: CustomerStatus }) {
  const isActive = status === 'active';
  return (
    <span className={`${styles.statusBadge} ${isActive ? styles.statusActive : styles.statusInactive}`}>
      <span className={`${styles.dot} ${isActive ? styles.dotActive : styles.dotInactive}`} />
      {isActive ? '活跃' : '停用'}
    </span>
  );
}

// ─────────────────────────────────────────────
// 客户 Modal（新增 / 编辑）
// ─────────────────────────────────────────────

interface CustomerModalProps {
  open: boolean;
  initial?: Customer | null;
  onClose: () => void;
}

const EMPTY_FORM: CreateCustomerPayload = {
  code: '',
  name: '',
  grade: 'A',
  contact: '',
  phone: '',
  email: '',
  address: '',
  creditLimit: undefined,
  paymentDays: undefined,
  notes: '',
};

function CustomerModal({ open, initial, onClose }: CustomerModalProps) {
  const isEdit = Boolean(initial);
  const createMut = useCreateCustomer();
  const updateMut = useUpdateCustomer();

  const [form, setForm] = useState<CreateCustomerPayload>(() =>
    initial
      ? {
          code: initial.code,
          name: initial.name,
          grade: initial.grade,
          contact: initial.contact ?? '',
          phone: initial.phone ?? '',
          email: initial.email ?? '',
          address: initial.address ?? '',
          creditLimit: initial.creditLimit,
          paymentDays: initial.paymentDays,
          notes: initial.notes ?? '',
        }
      : { ...EMPTY_FORM },
  );

  // 重置表单当 open/initial 变更
  const handleOpen = useCallback(() => {
    if (initial) {
      setForm({
        code: initial.code,
        name: initial.name,
        grade: initial.grade,
        contact: initial.contact ?? '',
        phone: initial.phone ?? '',
        email: initial.email ?? '',
        address: initial.address ?? '',
        creditLimit: initial.creditLimit,
        paymentDays: initial.paymentDays,
        notes: initial.notes ?? '',
      });
    } else {
      setForm({ ...EMPTY_FORM });
    }
  }, [initial]);

  // 每次 open=true 时重置
  if (open && form.code === '' && initial) handleOpen();

  function set(key: keyof CreateCustomerPayload, value: unknown) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleConfirm() {
    if (isEdit && initial) {
      await updateMut.mutateAsync({ id: initial.id, payload: form });
    } else {
      await createMut.mutateAsync(form);
    }
    onClose();
  }

  const loading = createMut.isPending || updateMut.isPending;

  return (
    <Modal
      open={open}
      title={isEdit ? '编辑客户' : '新增客户'}
      onClose={onClose}
      onConfirm={handleConfirm}
      confirmLabel={isEdit ? '保存' : '创建'}
      confirmLoading={loading}
      size="md"
    >
      <div className={styles.formGrid}>
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>客户编码 *</label>
          <input
            className={styles.formInput}
            value={form.code}
            onChange={(e) => set('code', e.target.value)}
            placeholder="如：C-0001"
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>客户名称 *</label>
          <input
            className={styles.formInput}
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="客户公司名称"
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>客户等级</label>
          <select
            className={styles.formSelect}
            value={form.grade}
            onChange={(e) => set('grade', e.target.value as CustomerGrade)}
          >
            <option value="VIP">VIP</option>
            <option value="A">A 级</option>
            <option value="B">B 级</option>
            <option value="C">C 级</option>
          </select>
        </div>
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>主要联系人</label>
          <input
            className={styles.formInput}
            value={form.contact ?? ''}
            onChange={(e) => set('contact', e.target.value)}
            placeholder="联系人姓名"
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>电话</label>
          <input
            className={styles.formInput}
            value={form.phone ?? ''}
            onChange={(e) => set('phone', e.target.value)}
            placeholder="联系电话"
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>邮箱</label>
          <input
            className={styles.formInput}
            type="email"
            value={form.email ?? ''}
            onChange={(e) => set('email', e.target.value)}
            placeholder="电子邮箱"
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>信用额度（元）</label>
          <input
            className={styles.formInput}
            type="number"
            value={form.creditLimit ?? ''}
            onChange={(e) => set('creditLimit', e.target.value || undefined)}
            placeholder="0"
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>账期（天）</label>
          <input
            className={styles.formInput}
            type="number"
            value={form.paymentDays ?? ''}
            onChange={(e) => set('paymentDays', e.target.value ? Number(e.target.value) : undefined)}
            placeholder="30"
          />
        </div>
        <div className={`${styles.formGroup} ${styles.formGridFull}`}>
          <label className={styles.formLabel}>地址</label>
          <input
            className={styles.formInput}
            value={form.address ?? ''}
            onChange={(e) => set('address', e.target.value)}
            placeholder="客户地址"
          />
        </div>
        <div className={`${styles.formGroup} ${styles.formGridFull}`}>
          <label className={styles.formLabel}>备注</label>
          <textarea
            className={styles.formTextarea}
            value={form.notes ?? ''}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="备注信息"
          />
        </div>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────
// 客户详情 Drawer
// ─────────────────────────────────────────────

interface CustomerDrawerProps {
  customerId: number | null;
  onClose: () => void;
}

function CustomerDrawer({ customerId, onClose }: CustomerDrawerProps) {
  const { data: customer } = useCustomer(customerId);
  const { data: contacts = [], isLoading: contactsLoading } = useCustomerContacts(customerId);
  const { data: ordersData } = useCustomerOrders(customerId);
  const createContact = useCreateCustomerContact();
  const deleteContact = useDeleteCustomerContact();
  const updateContact = useUpdateCustomerContact();

  const [newContact, setNewContact] = useState({ name: '', phone: '', title: '' });
  const [editingContactId, setEditingContactId] = useState<number | null>(null);
  const [editContactForm, setEditContactForm] = useState<{ name: string; phone: string; title: string; isPrimary: boolean }>({
    name: '', phone: '', title: '', isPrimary: false,
  });

  async function handleAddContact() {
    if (!customerId || !newContact.name) return;
    await createContact.mutateAsync({ customerId, payload: newContact });
    setNewContact({ name: '', phone: '', title: '' });
  }

  async function handleDeleteContact(contactId: number) {
    if (!customerId) return;
    await deleteContact.mutateAsync({ contactId, customerId });
  }

  function startEditContact(c: CustomerContact) {
    setEditingContactId(c.id);
    setEditContactForm({ name: c.name, phone: c.phone ?? '', title: c.title ?? '', isPrimary: c.isPrimary });
  }

  async function saveEditContact() {
    if (!customerId || !editingContactId) return;
    await updateContact.mutateAsync({
      customerId,
      contactId: editingContactId,
      payload: editContactForm,
    });
    setEditingContactId(null);
  }

  const orders = ordersData?.list ?? [];

  return (
    <Drawer
      open={customerId !== null}
      title={customer ? `${customer.name} — 客户详情` : '客户详情'}
      onClose={onClose}
      width={480}
    >
      {customer && (
        <>
          {/* 基本信息 */}
          <div className={styles.drawerSection}>
            <p className={styles.drawerSectionTitle}>基本信息</p>
            <div className={styles.infoGrid}>
              <div className={styles.infoItem}>
                <span className={styles.infoKey}>客户编码</span>
                <span className={styles.infoVal}>{customer.code}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.infoKey}>等级</span>
                <span className={styles.infoVal}><GradeTag grade={customer.grade} /></span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.infoKey}>状态</span>
                <span className={styles.infoVal}><StatusTag status={customer.status} /></span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.infoKey}>信用额度</span>
                <span className={styles.infoVal}>
                  {customer.creditLimit != null
                    ? `¥${Number(customer.creditLimit).toLocaleString()}`
                    : '—'}
                </span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.infoKey}>账期</span>
                <span className={styles.infoVal}>
                  {customer.paymentDays != null ? `${customer.paymentDays} 天` : '—'}
                </span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.infoKey}>邮箱</span>
                <span className={styles.infoVal}>{customer.email || '—'}</span>
              </div>
              {customer.address && (
                <div className={styles.infoItem} style={{ gridColumn: '1/-1' }}>
                  <span className={styles.infoKey}>地址</span>
                  <span className={styles.infoVal}>{customer.address}</span>
                </div>
              )}
              {customer.notes && (
                <div className={styles.infoItem} style={{ gridColumn: '1/-1' }}>
                  <span className={styles.infoKey}>备注</span>
                  <span className={styles.infoVal}>{customer.notes}</span>
                </div>
              )}
            </div>
          </div>

          {/* 区域信息（补充） */}
          {customer.region && (
            <div className={styles.drawerSection}>
              <div className={styles.infoItem} style={{ gridColumn: '1/-1' }}>
                <span className={styles.infoKey}>区域</span>
                <span className={styles.infoVal}>{customer.region}</span>
              </div>
            </div>
          )}

          {/* 联系人列表 */}
          <div className={styles.drawerSection}>
            <p className={styles.drawerSectionTitle}>联系人</p>
            {contactsLoading ? (
              <p className={styles.empty}>加载中...</p>
            ) : contacts.length === 0 ? (
              <p className={styles.empty}>暂无联系人</p>
            ) : (
              contacts.map((c) => (
                <div key={c.id} className={styles.contactItem}>
                  {editingContactId === c.id ? (
                    /* 行内编辑模式 */
                    <div className={styles.contactEditForm}>
                      <input
                        className={styles.addContactInput}
                        value={editContactForm.name}
                        onChange={(e) => setEditContactForm((p) => ({ ...p, name: e.target.value }))}
                        placeholder="姓名"
                        onKeyDown={(e) => e.key === 'Enter' && saveEditContact()}
                      />
                      <input
                        className={styles.addContactInput}
                        value={editContactForm.title}
                        onChange={(e) => setEditContactForm((p) => ({ ...p, title: e.target.value }))}
                        placeholder="职位"
                      />
                      <input
                        className={styles.addContactInput}
                        value={editContactForm.phone}
                        onChange={(e) => setEditContactForm((p) => ({ ...p, phone: e.target.value }))}
                        placeholder="电话"
                      />
                      <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input
                          type="checkbox"
                          checked={editContactForm.isPrimary}
                          onChange={(e) => setEditContactForm((p) => ({ ...p, isPrimary: e.target.checked }))}
                        />
                        主要联系人
                      </label>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <Button variant="primary" size="sm" onClick={saveEditContact} loading={updateContact.isPending}>
                          保存
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setEditingContactId(null)}>
                          取消
                        </Button>
                      </div>
                    </div>
                  ) : (
                    /* 展示模式 */
                    <>
                      <div className={styles.contactInfo}>
                        <span className={styles.contactName}>
                          {c.name}
                          {c.isPrimary && <span className={styles.primaryBadge}>主要</span>}
                        </span>
                        <span className={styles.contactMeta}>
                          {[c.title, c.phone, c.email].filter(Boolean).join(' · ')}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          className={styles.editBtn}
                          onClick={() => startEditContact(c)}
                          title="编辑联系人"
                        >
                          ✏
                        </button>
                        <button
                          className={styles.deleteBtn}
                          onClick={() => handleDeleteContact(c.id)}
                          title="删除联系人"
                        >
                          ×
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}

            {/* 新增联系人 */}
            <div className={styles.addContactForm}>
              <input
                className={styles.addContactInput}
                placeholder="姓名 *"
                value={newContact.name}
                onChange={(e) => setNewContact((p) => ({ ...p, name: e.target.value }))}
              />
              <input
                className={styles.addContactInput}
                placeholder="职位"
                value={newContact.title}
                onChange={(e) => setNewContact((p) => ({ ...p, title: e.target.value }))}
              />
              <input
                className={styles.addContactInput}
                placeholder="电话"
                value={newContact.phone}
                onChange={(e) => setNewContact((p) => ({ ...p, phone: e.target.value }))}
              />
              <Button
                variant="primary"
                size="sm"
                onClick={handleAddContact}
                loading={createContact.isPending}
                disabled={!newContact.name}
              >
                添加
              </Button>
            </div>
          </div>
          {/* 历史订单 */}
          <div className={styles.drawerSection}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <p className={styles.drawerSectionTitle}>历史订单</p>
              {orders.length > 0 && (
                <a
                  href={`/sales/orders?customerId=${customerId}`}
                  className={styles.viewAllLink}
                  style={{ fontSize: 12, color: 'var(--color-primary-600,#2563EB)' }}
                >
                  查看全部 →
                </a>
              )}
            </div>
            {orders.length === 0 ? (
              <p className={styles.empty}>暂无订单记录</p>
            ) : (
              <div className={styles.orderList}>
                {orders.map((o) => (
                  <div key={o.id} className={styles.orderItem}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--color-neutral-600,#4B5563)' }}>
                        {o.orderNo}
                      </span>
                      <span className={`${styles.statusBadge} ${
                        o.status === 'completed' ? styles.statusActive : styles.statusInactive
                      }`} style={{ fontSize: 11 }}>
                        {o.status}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--color-neutral-500,#6B7280)', marginTop: 4 }}>
                      <span>{o.orderDate}</span>
                      <span style={{ fontWeight: 500, color: 'var(--color-neutral-700,#374151)' }}>
                        ¥{Number(o.totalAmount).toLocaleString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </Drawer>
  );
}

// ─────────────────────────────────────────────
// 主页面
// ─────────────────────────────────────────────

type StatFilter = 'all' | 'active' | 'vip';

export default function CustomerPage() {
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [grade, setGrade] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [statFilter, setStatFilter] = useState<StatFilter>('all');

  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Customer | null>(null);
  const [drawerCustomerId, setDrawerCustomerId] = useState<number | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<Customer | null>(null);

  const patchStatus = usePatchCustomerStatus();

  // 统计查询（无筛选）
  const { data: allData } = useCustomerList({ page: 1, pageSize: 9999 });
  const allCount = allData?.total ?? 0;
  const activeCount = allData?.list?.filter((c) => c.status === 'active').length ?? 0;
  const vipCount = allData?.list?.filter((c) => c.grade === 'VIP').length ?? 0;

  // 构建有效筛选
  const effectiveStatus: string =
    statFilter === 'active' ? 'active' : status;
  const effectiveGrade: string =
    statFilter === 'vip' ? 'VIP' : grade;

  const { data, isLoading } = useCustomerList({
    page,
    pageSize: 15,
    keyword: keyword || undefined,
    grade: (effectiveGrade || undefined) as CustomerGrade | undefined,
    status: (effectiveStatus || undefined) as CustomerStatus | undefined,
  });

  const customers = data?.list ?? [];
  const totalPages = data ? Math.ceil(data.total / 15) : 1;

  function handleEdit(row: Customer) {
    setEditTarget(row);
    setModalOpen(true);
  }

  function handleCreate() {
    setEditTarget(null);
    setModalOpen(true);
  }

  function handleModalClose() {
    setModalOpen(false);
    setEditTarget(null);
  }

  async function handleToggleStatus(row: Customer) {
    const newStatus = row.status === 'active' ? 'inactive' : 'active';
    if (newStatus === 'inactive') {
      setConfirmTarget(row);
    } else {
      await patchStatus.mutateAsync({ id: row.id, status: newStatus });
    }
  }

  async function confirmDeactivate() {
    if (!confirmTarget) return;
    try {
      await patchStatus.mutateAsync({ id: confirmTarget.id, status: 'inactive' });
      setConfirmTarget(null);
    } catch {
      // API will return error with active order count — handled by global error handler
    }
  }

  const columns: Column<Customer>[] = [
    {
      key: 'code',
      title: '编码',
      width: 100,
      render: (v) => (
        <span style={{ fontFamily: 'monospace', color: 'var(--color-neutral-600,#4B5563)', fontSize: 13 }}>
          {v as string}
        </span>
      ),
    },
    {
      key: 'name',
      title: '客户名称',
      render: (v, row) => (
        <div>
          <div style={{ fontWeight: 500, fontSize: 14, color: 'var(--color-neutral-900,#111827)' }}>{v as string}</div>
          {row.contact && (
            <div style={{ fontSize: 12, color: 'var(--color-neutral-500,#6B7280)' }}>{row.contact}</div>
          )}
        </div>
      ),
    },
    {
      key: 'grade',
      title: '等级',
      width: 80,
      render: (v) => <GradeTag grade={v as CustomerGrade} />,
    },
    { key: 'contact', title: '联系人', width: 100 },
    { key: 'phone', title: '电话', width: 130 },
    {
      key: 'region',
      title: '区域',
      width: 100,
      render: (v) => (
        <span style={{ color: v ? 'var(--color-neutral-700,#374151)' : 'var(--color-neutral-400,#9CA3AF)' }}>
          {(v as string) || '—'}
        </span>
      ),
    },
    {
      key: 'paymentDays',
      title: '付款条件',
      width: 110,
      render: (v) => {
        const days = v as number | null | undefined;
        if (days == null) return <span style={{ color: 'var(--color-neutral-400,#9CA3AF)' }}>—</span>;
        return <span>{days === 0 ? '即时付款' : `${days}天账期`}</span>;
      },
    },
    {
      key: 'creditLimit',
      title: '信用额度',
      width: 120,
      render: (v) =>
        v != null ? (
          <span style={{ fontWeight: 500 }}>¥{Number(v).toLocaleString()}</span>
        ) : (
          <span style={{ color: 'var(--color-neutral-400,#9CA3AF)' }}>—</span>
        ),
    },
    {
      key: 'status',
      title: '状态',
      width: 80,
      render: (v) => <StatusTag status={v as CustomerStatus} />,
    },
    {
      key: 'id',
      title: '操作',
      width: 160,
      render: (_, row) => (
        <div className={styles.actions}>
          <button className={`${styles.actionBtn} ${styles.actionBtnEdit}`} onClick={() => handleEdit(row)}>
            编辑
          </button>
          <button className={`${styles.actionBtn} ${styles.actionBtnView}`} onClick={() => setDrawerCustomerId(row.id)}>
            详情
          </button>
          <button
            className={`${styles.actionBtn} ${row.status === 'active' ? styles.actionBtnDelete : styles.actionBtnEdit}`}
            onClick={() => handleToggleStatus(row)}
          >
            {row.status === 'active' ? '停用' : '启用'}
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className={styles.page}>
      {/* 页头 */}
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>客户管理</h1>
        <Button variant="primary" size="sm" onClick={handleCreate}>
          + 新增客户
        </Button>
      </div>

      {/* 统计卡片 */}
      <div className={styles.statsRow}>
        <div
          className={`${styles.statCard} ${statFilter === 'all' ? styles.active : ''}`}
          onClick={() => setStatFilter('all')}
        >
          <div className={`${styles.statIcon} ${styles.statIconAll}`}>🏢</div>
          <div className={styles.statInfo}>
            <span className={styles.statLabel}>全部客户</span>
            <span className={styles.statValue}>{allCount}</span>
          </div>
        </div>
        <div
          className={`${styles.statCard} ${statFilter === 'active' ? styles.active : ''}`}
          onClick={() => setStatFilter('active')}
        >
          <div className={`${styles.statIcon} ${styles.statIconActive}`}>✅</div>
          <div className={styles.statInfo}>
            <span className={styles.statLabel}>活跃客户</span>
            <span className={styles.statValue}>{activeCount}</span>
          </div>
        </div>
        <div
          className={`${styles.statCard} ${statFilter === 'vip' ? styles.active : ''}`}
          onClick={() => setStatFilter('vip')}
        >
          <div className={`${styles.statIcon} ${styles.statIconVip}`}>⭐</div>
          <div className={styles.statInfo}>
            <span className={styles.statLabel}>VIP 客户</span>
            <span className={styles.statValue}>{vipCount}</span>
          </div>
        </div>
      </div>

      {/* 筛选栏 */}
      <div className={styles.filterBar}>
        <input
          className={styles.searchInput}
          placeholder="搜索客户名称 / 编码 / 联系人..."
          value={keyword}
          onChange={(e) => { setKeyword(e.target.value); setPage(1); }}
        />
        <select
          className={styles.select}
          value={grade}
          onChange={(e) => { setGrade(e.target.value); setPage(1); setStatFilter('all'); }}
        >
          <option value="">全部等级</option>
          <option value="VIP">VIP</option>
          <option value="A">A 级</option>
          <option value="B">B 级</option>
          <option value="C">C 级</option>
        </select>
        <select
          className={styles.select}
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); setStatFilter('all'); }}
        >
          <option value="">全部状态</option>
          <option value="active">活跃</option>
          <option value="inactive">停用</option>
        </select>
      </div>

      {/* 表格 */}
      <div className={styles.tableCard}>
        <Table
          columns={columns as unknown as Column<Record<string, unknown>>[]}
          dataSource={customers as unknown as Record<string, unknown>[]}
          rowKey="id"
          loading={isLoading}
          emptyText="暂无客户数据"
        />
        {/* 分页 */}
        {totalPages > 1 && (
          <div className={styles.pagination}>
            <span>共 {data?.total ?? 0} 条</span>
            <button
              className={styles.pageBtn}
              onClick={() => setPage((p) => p - 1)}
              disabled={page <= 1}
            >
              «
            </button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              const p = i + 1;
              return (
                <button
                  key={p}
                  className={`${styles.pageBtn} ${p === page ? styles.pageBtnActive : ''}`}
                  onClick={() => setPage(p)}
                >
                  {p}
                </button>
              );
            })}
            <button
              className={styles.pageBtn}
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= totalPages}
            >
              »
            </button>
          </div>
        )}
      </div>

      {/* 新增/编辑 Modal */}
      <CustomerModal
        open={modalOpen}
        initial={editTarget}
        onClose={handleModalClose}
      />

      {/* 详情 Drawer */}
      <CustomerDrawer
        customerId={drawerCustomerId}
        onClose={() => setDrawerCustomerId(null)}
      />

      {/* 停用确认 Modal */}
      <Modal
        open={confirmTarget !== null}
        title="确认停用客户"
        onClose={() => setConfirmTarget(null)}
        onConfirm={confirmDeactivate}
        confirmLabel="确认停用"
        confirmLoading={patchStatus.isPending}
        confirmVariant="danger"
        size="sm"
      >
        <p style={{ margin: 0, fontSize: 14, color: 'var(--color-neutral-700,#374151)' }}>
          确定要停用客户 <strong>{confirmTarget?.name}</strong> 吗？停用后该客户将无法用于新订单。
        </p>
      </Modal>
    </div>
  );
}
