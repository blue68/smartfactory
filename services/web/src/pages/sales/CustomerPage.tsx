/**
 * [artifact:前端代码] — 客户管理页 R-07
 * 功能：统计卡片 / 筛选 / 表格 / 新增编辑 Modal / 详情 Drawer（含联系人）
 */

import { useState, useCallback, useEffect } from 'react';
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
  const label =
    grade === 'VIP' ? '★ VIP'
    : grade === 'A' ? 'A 级'
    : grade === 'B' ? 'B 级'
    : 'C 级';
  return <span className={`${styles.grade} ${cls}`}>{label}</span>;
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
  region: '',
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
          region: initial.region ?? '',
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
        region: initial.region ?? '',
        creditLimit: initial.creditLimit,
        paymentDays: initial.paymentDays,
        notes: initial.notes ?? '',
      });
    } else {
      setForm({ ...EMPTY_FORM });
    }
  }, [initial]);

  // 每次 open=true 时重置
  useEffect(() => {
    if (!open) return;
    handleOpen();
  }, [open, handleOpen]);

  function set(key: keyof CreateCustomerPayload, value: unknown) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleConfirm() {
    // 将空字符串字段清理为 undefined，避免后端校验拒绝
    const clean = Object.fromEntries(
      Object.entries(form).map(([k, v]) => [k, v === '' ? undefined : v]),
    ) as CreateCustomerPayload;

    if (isEdit && initial) {
      await updateMut.mutateAsync({ id: initial.id, payload: clean });
    } else {
      await createMut.mutateAsync(clean);
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
      confirmLabel={isEdit ? '保存修改' : '保存客户'}
      confirmLoading={loading}
      size="md"
    >
      <div className={styles.modalBody}>
        {/* 基本信息 */}
        <div className={styles.formSection}>
          <div className={styles.formSectionTitle}>基本信息</div>
          <div className={styles.formGrid}>
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
              <label className={styles.formLabel}>客户编码</label>
              <input
                className={styles.formInput}
                value={form.code}
                onChange={(e) => !isEdit && set('code', e.target.value)}
                placeholder="系统自动生成"
                readOnly={isEdit}
                style={isEdit ? { background: '#F1F5F9', color: '#94A3B8', cursor: 'not-allowed' } : undefined}
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
              <label className={styles.formLabel}>所在地区</label>
              <input
                className={styles.formInput}
                value={form.region ?? ''}
                onChange={(e) => set('region', e.target.value)}
                placeholder="省 / 市 / 区"
              />
            </div>
            <div className={`${styles.formGroup} ${styles.formGridFull}`}>
              <label className={styles.formLabel}>详细地址</label>
              <input
                className={styles.formInput}
                value={form.address ?? ''}
                onChange={(e) => set('address', e.target.value)}
                placeholder="客户详细地址"
              />
            </div>
          </div>
        </div>

        {/* 主要联系人 */}
        <div className={styles.formSection}>
          <div className={styles.formSectionTitle}>主要联系人</div>
          <div className={`${styles.formGrid} ${styles.formGrid3}`}>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>姓名</label>
              <input
                className={styles.formInput}
                value={form.contact ?? ''}
                onChange={(e) => set('contact', e.target.value)}
                placeholder="联系人姓名"
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>职位</label>
              <input
                className={styles.formInput}
                placeholder="在详情页联系人中设置"
                readOnly
                style={{ background: '#F1F5F9', color: '#94A3B8', cursor: 'not-allowed' }}
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>联系电话</label>
              <input
                className={styles.formInput}
                value={form.phone ?? ''}
                onChange={(e) => set('phone', e.target.value)}
                placeholder="联系电话"
              />
            </div>
            <div className={`${styles.formGroup} ${styles.formGridFull}`}>
              <label className={styles.formLabel}>邮箱</label>
              <input
                className={styles.formInput}
                type="email"
                value={form.email ?? ''}
                onChange={(e) => set('email', e.target.value)}
                placeholder="电子邮箱"
              />
            </div>
          </div>
        </div>

        {/* 财务信息 */}
        <div className={styles.formSection}>
          <div className={styles.formSectionTitle}>财务信息</div>
          <div className={styles.formGrid}>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>信用额度（元）</label>
              <input
                className={styles.formInput}
                type="number"
                value={form.creditLimit ?? ''}
                onChange={(e) => set('creditLimit', e.target.value || undefined)}
                placeholder="0"
              />
              <span className={styles.formHint}>客户最大允许赊账金额</span>
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
              <span className={styles.formHint}>发票开具后允许付款天数</span>
            </div>
          </div>
        </div>

        {/* 备注 */}
        <div className={`${styles.formSection} ${styles.formSectionLast}`}>
          <div className={styles.formSectionTitle}>备注</div>
          <div className={styles.formGroup}>
            <textarea
              className={styles.formTextarea}
              value={form.notes ?? ''}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="备注信息"
            />
          </div>
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
  const { data: customer, isLoading: customerLoading, isError: customerError } = useCustomer(customerId);
  const { data: contacts = [], isLoading: contactsLoading, isError: contactsError } = useCustomerContacts(customerId);
  const { data: ordersData, isLoading: ordersLoading, isError: ordersError } = useCustomerOrders(customerId);
  const createContact = useCreateCustomerContact();
  const deleteContact = useDeleteCustomerContact();
  const updateContact = useUpdateCustomerContact();

  const [newContact, setNewContact] = useState({ name: '', phone: '', title: '', email: '' });
  const [editingContactId, setEditingContactId] = useState<number | null>(null);
  const [editContactForm, setEditContactForm] = useState<{ name: string; phone: string; title: string; email: string; isPrimary: boolean }>({
    name: '', phone: '', title: '', email: '', isPrimary: false,
  });

  async function handleAddContact() {
    if (!customerId || !newContact.name) return;
    await createContact.mutateAsync({ customerId, payload: newContact });
    setNewContact({ name: '', phone: '', title: '', email: '' });
  }

  async function handleDeleteContact(contactId: number) {
    if (!customerId) return;
    await deleteContact.mutateAsync({ contactId, customerId });
  }

  function startEditContact(c: CustomerContact) {
    setEditingContactId(c.id);
    setEditContactForm({ name: c.name, phone: c.phone ?? '', title: c.title ?? '', email: c.email ?? '', isPrimary: c.isPrimary });
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

  const ORDER_STATUS_MAP: Record<string, string> = {
    draft: '草稿',
    pending_approval: '待审批',
    confirmed: '已确认',
    in_production: '生产中',
    shipped: '已发货',
    completed: '已完成',
    closed: '已关闭',
  };

  const orders = ordersData?.list ?? [];
  const fallbackContacts: CustomerContact[] =
    customer && (customer.contact || customer.phone || customer.email)
      ? [{
          id: -1,
          customerId: customer.id,
          name: customer.contact || customer.name,
          title: '主联系人',
          phone: customer.phone,
          email: customer.email,
          isPrimary: true,
        }]
      : [];
  const displayedContacts = contacts.length > 0
    ? contacts
    : (customer?.contacts?.length ?? 0) > 0
    ? customer!.contacts!
    : fallbackContacts;

  return (
    <Drawer
      open={customerId !== null}
      title="客户详情"
      onClose={onClose}
      width={560}
    >
      {customerLoading ? (
        <p className={styles.empty}>客户详情加载中...</p>
      ) : customerError || !customer ? (
        <p className={styles.empty}>客户详情加载失败，请稍后重试。</p>
      ) : (
        <>
          {/* Drawer 头部：客户名称 + 等级 + 编码 */}
          <div className={styles.drawerHead}>
            <div className={styles.drawerHeadTitle}>
              <span className={styles.drawerCustomerName}>{customer.name}</span>
              <GradeTag grade={customer.grade} />
            </div>
            <div className={styles.drawerHeadSub}>
              编码：{customer.code}
              {customer.createdAt && ` · 创建于 ${customer.createdAt.slice(0, 10)}`}
            </div>
          </div>

          {/* 基本信息 */}
          <div className={styles.drawerSection}>
            <p className={styles.drawerSectionTitle}>基本信息</p>
            <div className={styles.infoGrid}>
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
                <span className={styles.infoKey}>主要联系人</span>
                <span className={styles.infoVal}>{customer.contact || '—'}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.infoKey}>联系电话</span>
                <span className={styles.infoVal}>{customer.phone || '—'}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.infoKey}>邮箱</span>
                <span className={styles.infoVal}>{customer.email || '—'}</span>
              </div>
              {customer.region && (
                <div className={styles.infoItem}>
                  <span className={styles.infoKey}>区域</span>
                  <span className={styles.infoVal}>{customer.region}</span>
                </div>
              )}
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

          {/* 联系人列表 */}
          <div className={styles.drawerSection}>
            <p className={styles.drawerSectionTitle}>联系人</p>
            {contactsLoading && displayedContacts.length === 0 ? (
              <p className={styles.empty}>加载中...</p>
            ) : contactsError && displayedContacts.length === 0 ? (
              <p className={styles.empty}>联系人加载失败</p>
            ) : displayedContacts.length === 0 ? (
              <p className={styles.empty}>暂无联系人</p>
            ) : (
              displayedContacts.map((c) => (
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
                      <input
                        className={styles.addContactInput}
                        type="email"
                        value={editContactForm.email}
                        onChange={(e) => setEditContactForm((p) => ({ ...p, email: e.target.value }))}
                        placeholder="邮箱"
                      />
                      <label className={styles.contactPrimaryToggle}>
                        <input
                          type="checkbox"
                          checked={editContactForm.isPrimary}
                          onChange={(e) => setEditContactForm((p) => ({ ...p, isPrimary: e.target.checked }))}
                        />
                        主要联系人
                      </label>
                      <div className={`${styles.contactActions} ${styles.contactActionsEdit}`}>
                        <Button variant="primary" size="sm" onClick={saveEditContact} loading={updateContact.isPending}>
                          保存
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setEditingContactId(null)}>
                          取消
                        </Button>
                      </div>
                    </div>
                  ) : (
                    /* 展示模式：头像 + 信息 + 操作按钮 */
                    <>
                      <div className={styles.contactAvatar}>{c.name.charAt(0)}</div>
                      <div className={styles.contactInfo}>
                        <span className={styles.contactName}>
                          {c.name}
                          {c.isPrimary && <span className={styles.primaryBadge}>主要</span>}
                        </span>
                        <span className={styles.contactMeta}>
                          {[c.title, c.phone, c.email].filter(Boolean).join(' · ')}
                        </span>
                      </div>
                      {c.id > 0 ? (
                        <div className={styles.contactActions}>
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
                      ) : (
                        <div className={styles.contactActions}>
                          <span className={styles.primaryBadge}>主表</span>
                        </div>
                      )}
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
              <input
                className={styles.addContactInput}
                type="email"
                placeholder="邮箱"
                value={newContact.email}
                onChange={(e) => setNewContact((p) => ({ ...p, email: e.target.value }))}
              />
              <Button
                variant="primary"
                size="sm"
                className={styles.addContactSubmit}
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
            {ordersLoading ? (
              <p className={styles.empty}>订单加载中...</p>
            ) : ordersError ? (
              <p className={styles.empty}>订单加载失败</p>
            ) : orders.length === 0 ? (
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
                        {ORDER_STATUS_MAP[o.status] ?? o.status}
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
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const patchStatus = usePatchCustomerStatus();

  // 统计查询（无筛选）
  const { data: allData } = useCustomerList({ page: 1, pageSize: 200 });
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
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      const msg = e?.response?.data?.message || e?.message || '操作失败，请稍后重试';
      setConfirmTarget(null);
      setErrorMsg(msg);
    }
  }

  // 列定义：编码 | 客户名称 | 等级 | 主要联系人 | 联系电话 | 信用额度 | 账期 | 状态 | 操作
  const columns: Column<Customer>[] = [
    {
      key: 'code',
      title: '编码',
      width: 120,
      render: (v) => (
        <span className={styles.codeCell}>
          {v as string}
        </span>
      ),
    },
    {
      key: 'name',
      width: 240,
      title: '客户名称',
      render: (v) => (
        <div className={styles.nameCell}>{v as string}</div>
      ),
    },
    {
      key: 'grade',
      title: '等级',
      width: 96,
      align: 'center',
      render: (v) => <GradeTag grade={v as CustomerGrade} />,
    },
    {
      key: 'contact',
      title: '主要联系人',
      width: 136,
      render: (v) => (
        <span className={v ? styles.textCell : styles.placeholderCell}>
          {(v as string) || '—'}
        </span>
      ),
    },
    {
      key: 'phone',
      title: '联系电话',
      width: 156,
      render: (v) => (
        <span className={v ? styles.phoneCell : styles.placeholderCell}>
          {(v as string) || '—'}
        </span>
      ),
    },
    {
      key: 'creditLimit',
      title: '信用额度（元）',
      width: 150,
      align: 'right',
      render: (v) =>
        v != null ? (
          <span className={styles.amountCell}>¥{Number(v).toLocaleString()}</span>
        ) : (
          <span className={styles.placeholderCell}>—</span>
        ),
    },
    {
      key: 'paymentDays',
      title: '账期（天）',
      width: 100,
      align: 'center',
      render: (v) => {
        const days = v as number | null | undefined;
        return days != null ? (
          <span className={styles.daysCell}>{days}</span>
        ) : (
          <span className={styles.placeholderCell}>—</span>
        );
      },
    },
    {
      key: 'status',
      title: '状态',
      width: 112,
      align: 'center',
      render: (v) => (
        <div className={styles.statusCell}>
          <StatusTag status={v as CustomerStatus} />
        </div>
      ),
    },
    {
      key: 'id',
      title: '操作',
      width: 196,
      align: 'center',
      render: (_, row) => (
        <div className={styles.actions}>
          <button
            className={`${styles.actionBtn} ${styles.actionBtnView}`}
            onClick={() => setDrawerCustomerId(row.id)}
          >
            详情
          </button>
          {row.status === 'active' && (
            <button
              className={`${styles.actionBtn} ${styles.actionBtnEdit}`}
              onClick={() => handleEdit(row)}
            >
              编辑
            </button>
          )}
          <button
            className={`${styles.actionBtn} ${row.status === 'active' ? styles.actionBtnDisable : styles.actionBtnEnable}`}
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
      {/* 错误提示 */}
      {errorMsg && (
        <div
          role="alert"
          style={{
            position: 'fixed',
            top: 20,
            right: 24,
            zIndex: 9999,
            background: '#FEF2F2',
            border: '1px solid #FECACA',
            color: '#DC2626',
            padding: '10px 16px',
            borderRadius: 8,
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
            maxWidth: 360,
          }}
        >
          <span style={{ flex: 1 }}>{errorMsg}</span>
          <button
            onClick={() => setErrorMsg(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626', fontWeight: 700, fontSize: 16, lineHeight: 1, padding: 0 }}
            aria-label="关闭"
          >
            ×
          </button>
        </div>
      )}

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
          <div className={styles.statInfo}>
            <span className={styles.statLabel}>
              <span className={`${styles.statDot} ${styles.statDotAll}`} />
              全部客户
            </span>
            <span className={`${styles.statValue} ${styles.statValueAll}`}>{allCount}</span>
          </div>
        </div>
        <div
          className={`${styles.statCard} ${statFilter === 'active' ? styles.active : ''}`}
          onClick={() => setStatFilter('active')}
        >
          <div className={styles.statInfo}>
            <span className={styles.statLabel}>
              <span className={`${styles.statDot} ${styles.statDotActive}`} />
              活跃客户
            </span>
            <span className={`${styles.statValue} ${styles.statValueActive}`}>{activeCount}</span>
          </div>
        </div>
        <div
          className={`${styles.statCard} ${statFilter === 'vip' ? styles.active : ''}`}
          onClick={() => setStatFilter('vip')}
        >
          <div className={styles.statInfo}>
            <span className={styles.statLabel}>
              <span className={`${styles.statDot} ${styles.statDotVip}`} />
              VIP 客户
            </span>
            <span className={`${styles.statValue} ${styles.statValueVip}`}>{vipCount}</span>
          </div>
        </div>
      </div>

      {/* 筛选栏 */}
      <div className={styles.filterBar}>
        <div className={styles.searchField}>
          <span className={styles.searchFieldIcon}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="7" cy="7" r="4.5" stroke="#94A3B8" strokeWidth="1.5"/>
              <path d="M10.5 10.5L13 13" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </span>
          <input
            className={styles.searchInput}
            placeholder="搜索客户名称 / 编码 / 联系人..."
            value={keyword}
            onChange={(e) => { setKeyword(e.target.value); setPage(1); }}
          />
        </div>
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
        <span className={styles.toolbarSpacer} />
        <span style={{ fontSize: 13, color: '#64748B', whiteSpace: 'nowrap', alignSelf: 'center' }}>
          共 {data?.total ?? 0} 条
        </span>
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
        {/* 分页底栏：始终显示，totalPages > 1 才显示翻页按钮 */}
        <div className={styles.tableFooter}>
          <span className={styles.tableFooterInfo}>
            {data && data.total > 0
              ? `显示 ${(page - 1) * 15 + 1}–${Math.min(page * 15, data.total)} / 共 ${data.total} 条`
              : `共 ${data?.total ?? 0} 条`}
          </span>
          {totalPages > 1 && (
            <div className={styles.pagination}>
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
