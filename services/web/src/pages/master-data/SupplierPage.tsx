/**
 * [artifact:前端代码] — 供应商管理页
 * 功能：供应商列表浏览、关键字搜索（防抖350ms）、等级/状态筛选、新建、编辑
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAppStore } from '@/stores/appStore';
import {
  useSupplierList,
  useCreateSupplier,
  useUpdateSupplier,
} from '@/api/supplier';
import type {
  Supplier,
  SupplierRating,
  SupplierListQuery,
  CreateSupplierPayload,
} from '@/api/supplier';
import type { Column } from '@/components/common/Table';
import Table from '@/components/common/Table';
import Drawer from '@/components/common/Drawer';
import Tag from '@/components/common/Tag';
import Button from '@/components/common/Button';
import SummaryStrip from '@/components/common/SummaryStrip';
import ProgressBar from '@/components/common/ProgressBar';
import styles from './SupplierPage.module.css';

// ─────────────────────────────────────────────
// 常量与辅助映射
// ─────────────────────────────────────────────

type SupplierRecord = Supplier & Record<string, unknown>;

const RATING_OPTIONS: SupplierRating[] = ['A', 'B', 'C', 'D'];

const RATING_VARIANT: Record<SupplierRating, 'success' | 'info' | 'warning' | 'danger'> = {
  A: 'success',
  B: 'info',
  C: 'warning',
  D: 'danger',
};

const RATING_LABEL: Record<SupplierRating, string> = {
  A: 'A 级',
  B: 'B 级',
  C: 'C 级',
  D: 'D 级',
};

// ─────────────────────────────────────────────
// 表单类型
// ─────────────────────────────────────────────

type SupplierFormData = {
  code: string;
  name: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  address: string;
  rating: SupplierRating;
  paymentDays: string;
  notes: string;
};

const EMPTY_FORM: SupplierFormData = {
  code: '',
  name: '',
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  address: '',
  rating: 'A',
  paymentDays: '',
  notes: '',
};

function supplierToForm(s: Supplier): SupplierFormData {
  return {
    code: s.code,
    name: s.name,
    contactName: s.contactName ?? '',
    contactPhone: s.contactPhone ?? '',
    contactEmail: s.contactEmail ?? '',
    address: s.address ?? '',
    rating: s.rating,
    paymentDays: s.paymentDays != null ? String(s.paymentDays) : '',
    notes: s.notes ?? '',
  };
}

// ─────────────────────────────────────────────
// 页面主组件
// ─────────────────────────────────────────────

export default function SupplierPage() {
  const { setPageTitle, showToast } = useAppStore();

  // 分页
  const [page, setPage] = useState(1);

  // 筛选状态
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [ratingFilter, setRatingFilter] = useState<SupplierRating | ''>('');
  const [activeFilter, setActiveFilter] = useState<'true' | 'false' | ''>('');

  // 模态框状态
  const [createModal, setCreateModal] = useState(false);
  const [editModal, setEditModal] = useState<{ open: boolean; supplier: Supplier | null }>({
    open: false,
    supplier: null,
  });

  // 表单数据
  const [form, setForm] = useState<SupplierFormData>(EMPTY_FORM);

  // 页面标题
  useEffect(() => {
    setPageTitle('供应商管理');
  }, [setPageTitle]);

  // 关键字防抖 350ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedKeyword(keyword);
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [keyword]);

  // 构造查询参数
  const query: SupplierListQuery = {
    page,
    pageSize: 20,
    keyword: debouncedKeyword || undefined,
    rating: (ratingFilter || undefined) as SupplierRating | undefined,
    isActive:
      activeFilter === 'true' ? true
      : activeFilter === 'false' ? false
      : undefined,
  };

  const { data, isLoading, error } = useSupplierList(query);
  const createMutation = useCreateSupplier();
  const updateMutation = useUpdateSupplier();

  // ── 打开新建弹窗 ──
  const openCreate = useCallback(() => {
    setForm(EMPTY_FORM);
    setCreateModal(true);
  }, []);

  // ── 打开编辑弹窗 ──
  const openEdit = useCallback((supplier: Supplier) => {
    setForm(supplierToForm(supplier));
    setEditModal({ open: true, supplier });
  }, []);

  // ── 提交新建 ──
  const handleCreate = async () => {
    const { code, name, rating } = form;
    if (!code.trim() || !name.trim()) {
      showToast({ type: 'warning', message: '请填写供应商编码和名称' });
      return;
    }
    const payload: CreateSupplierPayload = {
      code: code.trim(),
      name: name.trim(),
      rating,
      contactName: form.contactName.trim() || undefined,
      contactPhone: form.contactPhone.trim() || undefined,
      contactEmail: form.contactEmail.trim() || undefined,
      address: form.address.trim() || undefined,
      paymentDays: form.paymentDays ? Number(form.paymentDays) : undefined,
      notes: form.notes.trim() || undefined,
      isActive: true,
    };
    try {
      await createMutation.mutateAsync(payload);
      showToast({ type: 'success', message: '供应商创建成功' });
      setCreateModal(false);
      setForm(EMPTY_FORM);
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message ?? '创建失败，请重试' });
    }
  };

  // ── 提交编辑 ──
  const handleUpdate = async () => {
    if (!editModal.supplier) return;
    const { name, rating } = form;
    if (!name.trim()) {
      showToast({ type: 'warning', message: '请填写供应商名称' });
      return;
    }
    try {
      await updateMutation.mutateAsync({
        id: editModal.supplier.id,
        payload: {
          name: name.trim(),
          rating,
          contactName: form.contactName.trim() || undefined,
          contactPhone: form.contactPhone.trim() || undefined,
          contactEmail: form.contactEmail.trim() || undefined,
          address: form.address.trim() || undefined,
          paymentDays: form.paymentDays ? Number(form.paymentDays) : undefined,
          notes: form.notes.trim() || undefined,
        },
      });
      showToast({ type: 'success', message: '供应商信息更新成功' });
      setEditModal({ open: false, supplier: null });
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message ?? '更新失败，请重试' });
    }
  };

  // ── 筛选联动：切换筛选项时重置到第1页 ──
  const handleRatingChange = (val: SupplierRating | '') => {
    setRatingFilter(val);
    setPage(1);
  };
  const handleActiveChange = (val: 'true' | 'false' | '') => {
    setActiveFilter(val);
    setPage(1);
  };

  // ─────────────────────────────────────────────
  // 列定义
  // ─────────────────────────────────────────────

  const columns: Column<SupplierRecord>[] = [
    {
      key: 'code',
      title: '供应商编码',
      width: 140,
      render: (_, r) => (
        <span style={{ fontFamily: 'var(--font-family-mono)', fontSize: 13 }}>
          {(r as unknown as Supplier).code}
        </span>
      ),
    },
    {
      key: 'name',
      title: '供应商名称',
      render: (_, r) => {
        const s = r as unknown as Supplier;
        return <span style={{ fontWeight: 500 }}>{s.name}</span>;
      },
    },
    {
      key: 'rating',
      title: '等级',
      width: 80,
      render: (_, r) => {
        const s = r as unknown as Supplier;
        return (
          <Tag variant={RATING_VARIANT[s.rating]}>
            {RATING_LABEL[s.rating]}
          </Tag>
        );
      },
    },
    {
      key: 'contactName',
      title: '联系人',
      width: 110,
      render: (_, r) => (r as unknown as Supplier).contactName ?? '—',
    },
    {
      key: 'contactPhone',
      title: '联系电话',
      width: 140,
      render: (_, r) => (r as unknown as Supplier).contactPhone ?? '—',
    },
    {
      key: 'isActive',
      title: '状态',
      width: 80,
      render: (_, r) => {
        const s = r as unknown as Supplier;
        return (
          <Tag variant={s.isActive ? 'success' : 'neutral'}>
            {s.isActive ? '启用' : '停用'}
          </Tag>
        );
      },
    },
    {
      key: 'onTimeRate',
      title: '准时率',
      width: 140,
      render: (_, r) => {
        const s = r as unknown as Supplier;
        // onTimeRate 为 0–100 的数值，若字段不存在则以 0 展示
        const rate = typeof (s as Record<string, unknown>).onTimeRate === 'number'
          ? ((s as Record<string, unknown>).onTimeRate as number)
          : 0;
        const pct = Math.round(rate);
        return (
          <div className={styles.onTimeRateCell}>
            <ProgressBar value={pct} size="sm" />
            <span className={styles.onTimeRateLabel}>{pct}%</span>
          </div>
        );
      },
    },
    {
      key: 'actions',
      title: '操作',
      width: 80,
      render: (_, r) => {
        const s = r as unknown as Supplier;
        return (
          <Button variant="ghost" size="sm" onClick={() => openEdit(s)}>
            编辑
          </Button>
        );
      },
    },
  ];

  const supplierList = (data?.list ?? []) as SupplierRecord[];

  // ─────────────────────────────────────────────
  // SummaryStrip 统计数据（基于当前分页 total + 列表）
  // ─────────────────────────────────────────────

  const summaryItems = useMemo(() => {
    const list = supplierList.map((r) => r as unknown as Supplier);
    const countA = list.filter((s) => s.rating === 'A').length;
    const countB = list.filter((s) => s.rating === 'B').length;
    const countC = list.filter((s) => s.rating === 'C').length;
    return [
      { label: '供应商总数', value: data?.total ?? 0, unit: '家' },
      { label: 'A 级', value: countA, unit: '家', highlight: true },
      { label: 'B 级', value: countB, unit: '家' },
      { label: 'C 级', value: countC, unit: '家' },
    ];
  }, [supplierList, data?.total]);

  // ─────────────────────────────────────────────
  // 渲染
  // ─────────────────────────────────────────────

  return (
    <div className={styles.page}>
      {/* 页头 */}
      <div className="page-header">
        <h1 className="page-header__title">供应商管理</h1>
        <div className="page-header__actions">
          <Button variant="primary" size="md" onClick={openCreate}>
            新建供应商
          </Button>
        </div>
      </div>

      {/* 统计摘要栏 */}
      <SummaryStrip items={summaryItems} />

      {/* 筛选栏 */}
      <div className={styles.toolbar}>
        <input
          type="search"
          className={styles.searchInput}
          placeholder="搜索编码 / 名称..."
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          aria-label="搜索供应商"
        />
        <select
          className={styles.select}
          value={ratingFilter}
          onChange={(e) => handleRatingChange(e.target.value as SupplierRating | '')}
          aria-label="等级筛选"
        >
          <option value="">全部等级</option>
          {RATING_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {RATING_LABEL[r]}
            </option>
          ))}
        </select>
        <select
          className={styles.select}
          value={activeFilter}
          onChange={(e) => handleActiveChange(e.target.value as 'true' | 'false' | '')}
          aria-label="状态筛选"
        >
          <option value="">全部状态</option>
          <option value="true">启用</option>
          <option value="false">停用</option>
        </select>
      </div>

      {/* 列表 */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <Table<SupplierRecord>
          columns={columns}
          dataSource={supplierList}
          rowKey="id"
          loading={isLoading}
          error={error ? (error as Error).message : null}
          emptyText="暂无供应商数据"
          pagination={
            data
              ? { page, pageSize: 20, total: data.total, onChange: setPage }
              : undefined
          }
        />
      </div>

      {/* 新建供应商 Drawer */}
      <Drawer
        open={createModal}
        title="新建供应商"
        width={480}
        onClose={() => setCreateModal(false)}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
            <Button variant="ghost" onClick={() => setCreateModal(false)}>取消</Button>
            <Button variant="primary" onClick={() => void handleCreate()} loading={createMutation.isPending}>创建</Button>
          </div>
        }
      >
        <SupplierFormFields form={form} onChange={setForm} isNew />
      </Drawer>

      {/* 编辑供应商 Drawer */}
      <Drawer
        open={editModal.open}
        title={`编辑供应商 — ${editModal.supplier?.code ?? ''}`}
        width={480}
        onClose={() => setEditModal({ open: false, supplier: null })}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
            <Button variant="ghost" onClick={() => setEditModal({ open: false, supplier: null })}>取消</Button>
            <Button variant="primary" onClick={() => void handleUpdate()} loading={updateMutation.isPending}>保存</Button>
          </div>
        }
      >
        <SupplierFormFields form={form} onChange={setForm} isNew={false} />
      </Drawer>
    </div>
  );
}

// ─────────────────────────────────────────────
// 内部子组件：供应商表单字段
// ─────────────────────────────────────────────

type SupplierFormFieldsProps = {
  form: SupplierFormData;
  onChange: React.Dispatch<React.SetStateAction<SupplierFormData>>;
  isNew: boolean;
};

function SupplierFormFields({ form, onChange, isNew }: SupplierFormFieldsProps) {
  const set =
    (field: keyof SupplierFormData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      onChange((f) => ({ ...f, [field]: e.target.value }));

  return (
    <div className={styles.form}>
      {/* 行1：编码 + 名称 */}
      <div className={styles.formRow}>
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>
            供应商编码 <span className={styles.required}>*</span>
          </label>
          <input
            className={styles.formInput}
            value={form.code}
            onChange={set('code')}
            placeholder="如：SUP-001"
            disabled={!isNew}
            aria-required="true"
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>
            供应商名称 <span className={styles.required}>*</span>
          </label>
          <input
            className={styles.formInput}
            value={form.name}
            onChange={set('name')}
            placeholder="如：广州顺兴布料有限公司"
            aria-required="true"
          />
        </div>
      </div>

      {/* 行2：联系人 + 联系电话 */}
      <div className={styles.formRow}>
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>联系人</label>
          <input
            className={styles.formInput}
            value={form.contactName}
            onChange={set('contactName')}
            placeholder="如：张三"
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>联系电话</label>
          <input
            className={styles.formInput}
            type="tel"
            value={form.contactPhone}
            onChange={set('contactPhone')}
            placeholder="如：13800138000"
          />
        </div>
      </div>

      {/* 行3：邮箱 + 账期 */}
      <div className={styles.formRow}>
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>联系邮箱</label>
          <input
            className={styles.formInput}
            type="email"
            value={form.contactEmail}
            onChange={set('contactEmail')}
            placeholder="如：contact@supplier.com"
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>账期（天）</label>
          <input
            className={styles.formInput}
            type="number"
            min="0"
            step="1"
            value={form.paymentDays}
            onChange={set('paymentDays')}
            placeholder="如：30"
          />
        </div>
      </div>

      {/* 行4：评级 */}
      <div className={styles.formRow}>
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>供应商等级</label>
          <select
            className={styles.formSelect}
            value={form.rating}
            onChange={set('rating')}
            aria-label="供应商等级"
          >
            {RATING_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {RATING_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.formGroup}>
          {/* 占位，保持双列对齐 */}
        </div>
      </div>

      {/* 地址 — 全宽 */}
      <div className={styles.formGroupFull}>
        <label className={styles.formLabel}>地址</label>
        <input
          className={styles.formInput}
          value={form.address}
          onChange={set('address')}
          placeholder="如：广州市白云区某某工业园"
        />
      </div>

      {/* 备注 — 全宽 */}
      <div className={styles.formGroupFull}>
        <label className={styles.formLabel}>备注</label>
        <textarea
          className={styles.formTextarea}
          value={form.notes}
          onChange={set('notes')}
          placeholder="可选，填写供应商相关说明..."
          rows={3}
        />
      </div>
    </div>
  );
}
