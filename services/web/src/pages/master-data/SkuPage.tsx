/**
 * [artifact:前端代码] — SKU 主数据页
 * 功能：二级分类浏览、多单位换算配置、批量补录、状态管理
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAppStore } from '@/stores/appStore';
import {
  useSkuList,
  useSkuCategories,
  useCreateSku,
  useUpdateSku,
  useUpdateUnitConversions,
} from '@/api/sku';
import { SkuStatus, Category2Code, Category2Label, Category1Code, Category1Label } from '@/types/enums';
import type { Sku, UnitConversion } from '@/types/models';
import type { Column } from '@/components/common/Table';
import Table from '@/components/common/Table';
import Drawer from '@/components/common/Drawer';
import Tag from '@/components/common/Tag';
import Button from '@/components/common/Button';
import SummaryStrip from '@/components/common/SummaryStrip';
import { formatDateTime } from '@/utils/format';
import styles from './SkuPage.module.css';

type SkuRecord = Sku & Record<string, unknown>;

/** 一级分类 → Tag 色彩（使用 CSS 变量，对应设计规范色板） */
const CATEGORY1_TAG_STYLE: Record<Category1Code, React.CSSProperties> = {
  [Category1Code.RAW_MATERIAL]: {
    backgroundColor: 'var(--color-primary-50)',
    color: 'var(--color-primary-700)',
  },
  [Category1Code.SEMI_PRODUCT]: {
    backgroundColor: 'var(--color-warning-50)',
    color: 'var(--color-warning-700)',
  },
  [Category1Code.FINISHED]: {
    backgroundColor: 'var(--color-success-50)',
    color: 'var(--color-success-700)',
  },
};

const SKU_STATUS_VARIANT: Record<SkuStatus, 'success' | 'neutral' | 'warning'> = {
  [SkuStatus.ACTIVE]:      'success',
  [SkuStatus.INACTIVE]:    'neutral',
  [SkuStatus.PENDING]:     'warning',
};
const SKU_STATUS_LABEL: Record<SkuStatus, string> = {
  [SkuStatus.ACTIVE]:   '启用',
  [SkuStatus.INACTIVE]: '停用',
  [SkuStatus.PENDING]:  '待审',
};

type SkuFormData = {
  skuCode: string;
  skuName: string;
  category1Code: string;
  category2Code: Category2Code | '';
  stockUnit: string;
  purchaseUnit: string;
  safetyStock: string;
  specifications: string;
};

const EMPTY_SKU_FORM: SkuFormData = {
  skuCode: '',
  skuName: '',
  category1Code: '',
  category2Code: '',
  stockUnit: '',
  purchaseUnit: '',
  safetyStock: '',
  specifications: '',
};

type ConversionRow = { fromUnit: string; toUnit: string; factor: string };

export default function SkuPage() {
  const { setPageTitle, showToast } = useAppStore();
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<Category2Code | ''>('');
  const [statusFilter, setStatusFilter] = useState<SkuStatus | ''>('');

  // 批量选择状态
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  // modals
  const [createModal, setCreateModal] = useState(false);
  const [editModal, setEditModal] = useState<{ open: boolean; sku: Sku | null }>({ open: false, sku: null });
  const [unitModal, setUnitModal] = useState<{ open: boolean; sku: Sku | null }>({ open: false, sku: null });

  const [skuForm, setSkuForm] = useState<SkuFormData>(EMPTY_SKU_FORM);
  const [conversionRows, setConversionRows] = useState<ConversionRow[]>([{ fromUnit: '', toUnit: '', factor: '' }]);

  useEffect(() => { setPageTitle('SKU 主数据'); }, [setPageTitle]);

  // 防抖关键字搜索
  useEffect(() => {
    const t = setTimeout(() => setDebouncedKeyword(keyword), 350);
    return () => clearTimeout(t);
  }, [keyword]);

  const { data: catData } = useSkuCategories();
  const { data, isLoading, error } = useSkuList(
    debouncedKeyword || undefined,
    categoryFilter || undefined,
    statusFilter as SkuStatus || undefined,
    page,
    20,
  );

  const createMutation = useCreateSku();
  const updateMutation = useUpdateSku();
  const unitMutation   = useUpdateUnitConversions();

  // 当前页 SKU 列表（用于全选计算）
  const currentPageSkuList = useMemo(() => (data?.list ?? []) as Sku[], [data]);

  // 全选：当前页全部选中时为 true
  const isAllSelected = currentPageSkuList.length > 0
    && currentPageSkuList.every((s) => selectedIds.includes(s.id));
  const isIndeterminate = !isAllSelected
    && currentPageSkuList.some((s) => selectedIds.includes(s.id));

  const handleSelectAll = useCallback((checked: boolean) => {
    if (checked) {
      const pageIds = currentPageSkuList.map((s) => s.id);
      setSelectedIds((prev) => Array.from(new Set([...prev, ...pageIds])));
    } else {
      const pageIds = new Set(currentPageSkuList.map((s) => s.id));
      setSelectedIds((prev) => prev.filter((id) => !pageIds.has(id)));
    }
  }, [currentPageSkuList]);

  const handleSelectRow = useCallback((id: number, checked: boolean) => {
    setSelectedIds((prev) =>
      checked ? [...prev, id] : prev.filter((x) => x !== id),
    );
  }, []);

  const handleBatchEnable = useCallback(() => {
    showToast({ type: 'info', message: `批量启用 ${selectedIds.length} 个 SKU（功能开发中）` });
  }, [selectedIds, showToast]);

  const handleBatchDisable = useCallback(() => {
    showToast({ type: 'info', message: `批量停用 ${selectedIds.length} 个 SKU（功能开发中）` });
  }, [selectedIds, showToast]);

  const handleClearSelection = useCallback(() => {
    setSelectedIds([]);
  }, []);

  // 统计摘要：总数来自 API total，有效/待审/停用从当前页估算（API 无专项统计字段）
  const summaryItems = useMemo(() => {
    const list = (data?.list ?? []) as Sku[];
    const total   = data?.total ?? 0;
    const active  = list.filter((s) => s.status === SkuStatus.ACTIVE).length;
    const pending = list.filter((s) => s.status === SkuStatus.PENDING).length;
    const inactive= list.filter((s) => s.status === SkuStatus.INACTIVE).length;
    return [
      { label: '总 SKU 数', value: total, unit: '个' },
      { label: '启用', value: active, unit: '个', highlight: true },
      { label: '待审', value: pending, unit: '个' },
      { label: '停用', value: inactive, unit: '个' },
    ];
  }, [data]);

  const openEdit = useCallback((sku: Sku) => {
    setSkuForm({
      skuCode: sku.skuCode,
      skuName: sku.skuName,
      category1Code: sku.category1Code,
      category2Code: sku.category2Code as Category2Code,
      stockUnit: sku.stockUnit,
      purchaseUnit: sku.purchaseUnit,
      safetyStock: String(sku.safetyStock),
      specifications: sku.specifications ?? '',
    });
    setEditModal({ open: true, sku });
  }, []);

  const openUnitModal = useCallback((sku: Sku) => {
    const rows: ConversionRow[] = sku.unitConversions?.length
      ? sku.unitConversions.map((c) => ({ fromUnit: c.fromUnit, toUnit: c.toUnit, factor: String(c.factor) }))
      : [{ fromUnit: '', toUnit: '', factor: '' }];
    setConversionRows(rows);
    setUnitModal({ open: true, sku });
  }, []);

  const handleCreate = async () => {
    const { skuCode, skuName, stockUnit, purchaseUnit, safetyStock } = skuForm;
    if (!skuCode || !skuName || !stockUnit || !purchaseUnit || !safetyStock) {
      showToast({ type: 'warning', message: '请填写所有必填字段' });
      return;
    }
    try {
      await createMutation.mutateAsync({
        skuCode,
        skuName,
        category1Code: skuForm.category1Code,
        category2Code: skuForm.category2Code as Category2Code,
        stockUnit,
        purchaseUnit,
        safetyStock: Number(safetyStock),
        specifications: skuForm.specifications || undefined,
      });
      showToast({ type: 'success', message: 'SKU 创建成功' });
      setCreateModal(false);
      setSkuForm(EMPTY_SKU_FORM);
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message });
    }
  };

  const handleUpdate = async () => {
    if (!editModal.sku) return;
    const { skuName, safetyStock, specifications } = skuForm;
    if (!skuName) {
      showToast({ type: 'warning', message: '请输入 SKU 名称' });
      return;
    }
    try {
      await updateMutation.mutateAsync({
        id: editModal.sku.id,
        payload: { skuName, safetyStock: Number(safetyStock), specifications: specifications || undefined },
      });
      showToast({ type: 'success', message: '更新成功' });
      setEditModal({ open: false, sku: null });
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message });
    }
  };

  const handleSaveConversions = async () => {
    if (!unitModal.sku) return;
    const valid = conversionRows.filter((r) => r.fromUnit && r.toUnit && r.factor);
    if (valid.length === 0) {
      showToast({ type: 'warning', message: '请至少填写一条换算规则' });
      return;
    }
    const conversions: UnitConversion[] = valid.map((r) => ({
      fromUnit: r.fromUnit,
      toUnit: r.toUnit,
      factor: Number(r.factor),
    }));
    try {
      await unitMutation.mutateAsync({ id: unitModal.sku.id, conversions });
      showToast({ type: 'success', message: '单位换算规则已保存' });
      setUnitModal({ open: false, sku: null });
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message });
    }
  };

  const addConversionRow = () => {
    setConversionRows((rows) => [...rows, { fromUnit: '', toUnit: '', factor: '' }]);
  };
  const removeConversionRow = (idx: number) => {
    setConversionRows((rows) => rows.filter((_, i) => i !== idx));
  };
  const updateConversionRow = (idx: number, field: keyof ConversionRow, value: string) => {
    setConversionRows((rows) => rows.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };

  const columns: Column<SkuRecord>[] = [
    {
      key: 'skuCode',
      title: 'SKU 编码',
      width: 140,
      render: (_, r) => (
        <span style={{ fontFamily: 'var(--font-family-mono)', fontSize: 13 }}>{(r as unknown as Sku).skuCode}</span>
      ),
    },
    {
      key: 'skuName',
      title: 'SKU 名称',
      render: (_, r) => {
        const s = r as unknown as Sku;
        const cat1 = s.category1Code as Category1Code;
        const tagStyle = CATEGORY1_TAG_STYLE[cat1];
        return (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 500 }}>{s.skuName}</span>
              {cat1 && tagStyle && (
                <span
                  style={{
                    ...tagStyle,
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '1px 6px',
                    borderRadius: 'var(--radius-sm)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {Category1Label[cat1] ?? cat1}
                </span>
              )}
            </div>
            {s.specifications && (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{s.specifications}</div>
            )}
          </div>
        );
      },
    },
    {
      key: 'category2Code',
      title: '二级分类',
      width: 120,
      render: (_, r) => {
        const s = r as unknown as Sku;
        return (
          <Tag category2Code={s.category2Code as Category2Code}>
            {Category2Label[s.category2Code as Category2Code] ?? s.category2Code}
          </Tag>
        );
      },
    },
    {
      key: 'stockUnit',
      title: '库存单位',
      width: 90,
      render: (_, r) => (r as unknown as Sku).stockUnit,
    },
    {
      key: 'purchaseUnit',
      title: '采购单位',
      width: 90,
      render: (_, r) => (r as unknown as Sku).purchaseUnit,
    },
    {
      key: 'safetyStock',
      title: '安全库存',
      width: 100,
      render: (_, r) => {
        const s = r as unknown as Sku;
        return `${s.safetyStock} ${s.stockUnit}`;
      },
    },
    {
      key: 'status',
      title: '状态',
      width: 80,
      render: (_, r) => {
        const s = r as unknown as Sku;
        return <Tag variant={SKU_STATUS_VARIANT[s.status]}>{SKU_STATUS_LABEL[s.status]}</Tag>;
      },
    },
    {
      key: 'updatedAt',
      title: '更新时间',
      render: (_, r) => formatDateTime((r as unknown as Sku).updatedAt),
    },
    {
      key: 'actions',
      title: '操作',
      width: 160,
      render: (_, r) => {
        const s = r as unknown as Sku;
        return (
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <Button variant="ghost" size="sm" onClick={() => openEdit(s)}>编辑</Button>
            <Button variant="ghost" size="sm" onClick={() => openUnitModal(s)}>换算</Button>
          </div>
        );
      },
    },
  ];

  const skuList = (data?.list ?? []) as SkuRecord[];

  return (
    <div className={styles.page}>
      <div className="page-header">
        <h1 className="page-header__title">SKU 主数据</h1>
        <div className="page-header__actions">
          <Button variant="primary" size="md" onClick={() => { setSkuForm(EMPTY_SKU_FORM); setCreateModal(true); }}>
            新建 SKU
          </Button>
        </div>
      </div>

      {/* 统计摘要栏 */}
      <SummaryStrip items={summaryItems} />

      {/* 筛选栏 */}
      <div className={styles.filter_bar}>
        <input
          type="search"
          className={styles.filter_search}
          placeholder="搜索编码 / 名称..."
          value={keyword}
          onChange={(e) => { setKeyword(e.target.value); setPage(1); }}
          aria-label="搜索 SKU"
        />
        <select
          className={styles.filter_select}
          value={categoryFilter}
          onChange={(e) => { setCategoryFilter(e.target.value as Category2Code | ''); setPage(1); }}
          aria-label="二级分类筛选"
        >
          <option value="">全部分类</option>
          {(catData?.category2List ?? Object.values(Category2Code)).map((code) => (
            <option key={code} value={code}>{Category2Label[code as Category2Code] ?? code}</option>
          ))}
        </select>
        <select
          className={styles.filter_select}
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value as SkuStatus | ''); setPage(1); }}
          aria-label="状态筛选"
        >
          <option value="">全部状态</option>
          {Object.entries(SKU_STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <Table<SkuRecord>
          columns={columns}
          dataSource={skuList}
          rowKey="id"
          loading={isLoading}
          error={error ? (error as Error).message : null}
          emptyText="暂无 SKU 数据"
          pagination={data ? { page, pageSize: 20, total: data.total, onChange: setPage } : undefined}
        />
      </div>

      {/* 新建 SKU Drawer */}
      <Drawer
        open={createModal}
        title="新建 SKU"
        width={480}
        onClose={() => setCreateModal(false)}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
            <Button variant="ghost" onClick={() => setCreateModal(false)}>取消</Button>
            <Button variant="primary" onClick={() => void handleCreate()} loading={createMutation.isPending}>创建</Button>
          </div>
        }
      >
        <SkuFormFields form={skuForm} onChange={setSkuForm} catData={catData} isNew />
      </Drawer>

      {/* 编辑 SKU Drawer */}
      <Drawer
        open={editModal.open}
        title={`编辑 SKU — ${editModal.sku?.skuCode ?? ''}`}
        width={480}
        onClose={() => setEditModal({ open: false, sku: null })}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
            <Button variant="ghost" onClick={() => setEditModal({ open: false, sku: null })}>取消</Button>
            <Button variant="primary" onClick={() => void handleUpdate()} loading={updateMutation.isPending}>保存</Button>
          </div>
        }
      >
        <SkuFormFields form={skuForm} onChange={setSkuForm} catData={catData} isNew={false} />
      </Drawer>

      {/* 单位换算弹窗（保持 Modal，宽度适中即可） */}
      <Drawer
        open={unitModal.open}
        title={`单位换算 — ${unitModal.sku?.skuName ?? ''}`}
        width={480}
        onClose={() => setUnitModal({ open: false, sku: null })}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
            <Button variant="ghost" onClick={() => setUnitModal({ open: false, sku: null })}>取消</Button>
            <Button variant="primary" onClick={() => void handleSaveConversions()} loading={unitMutation.isPending}>保存换算</Button>
          </div>
        }
      >
        <div className={styles.conversion_form}>
          <p className={styles.conversion_hint}>
            填写此 SKU 的单位换算规则，例如：1 件 = 12 个。系统将自动支持双向换算。
          </p>
          <div className={styles.conversion_header}>
            <span>来源单位</span>
            <span>目标单位</span>
            <span>换算系数</span>
            <span></span>
          </div>
          {conversionRows.map((row, idx) => (
            <div key={idx} className={styles.conversion_row}>
              <input
                className={styles.conversion_input}
                placeholder="如：件"
                value={row.fromUnit}
                onChange={(e) => updateConversionRow(idx, 'fromUnit', e.target.value)}
              />
              <input
                className={styles.conversion_input}
                placeholder="如：个"
                value={row.toUnit}
                onChange={(e) => updateConversionRow(idx, 'toUnit', e.target.value)}
              />
              <input
                className={styles.conversion_input}
                type="number"
                placeholder="如：12"
                min="0.000001"
                step="any"
                value={row.factor}
                onChange={(e) => updateConversionRow(idx, 'factor', e.target.value)}
              />
              <button
                className={styles.conversion_remove}
                onClick={() => removeConversionRow(idx)}
                aria-label="删除此行"
                disabled={conversionRows.length <= 1}
              >
                ×
              </button>
            </div>
          ))}
          <Button variant="ghost" size="sm" onClick={addConversionRow} style={{ alignSelf: 'flex-start' }}>
            + 添加换算规则
          </Button>
        </div>
      </Drawer>
    </div>
  );
}

// ——— 内部子组件：SKU 表单字段 ———

type SkuFormFieldsProps = {
  form: SkuFormData;
  onChange: React.Dispatch<React.SetStateAction<SkuFormData>>;
  catData: { category1List: string[]; category2List: Category2Code[] } | undefined;
  isNew: boolean;
};

function SkuFormFields({ form, onChange, catData, isNew }: SkuFormFieldsProps) {
  const set = (field: keyof SkuFormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    onChange((f) => ({ ...f, [field]: e.target.value }));

  return (
    <div className={styles.sku_form}>
      <div className={styles.form_row}>
        <div className={styles.form_field}>
          <label className={styles.form_label}>SKU 编码 <span className={styles.required}>*</span></label>
          <input
            className={styles.form_input}
            value={form.skuCode}
            onChange={set('skuCode')}
            placeholder="如：YARN-001"
            disabled={!isNew}
          />
        </div>
        <div className={styles.form_field}>
          <label className={styles.form_label}>SKU 名称 <span className={styles.required}>*</span></label>
          <input
            className={styles.form_input}
            value={form.skuName}
            onChange={set('skuName')}
            placeholder="如：精梳棉纱32支"
          />
        </div>
      </div>
      <div className={styles.form_row}>
        <div className={styles.form_field}>
          <label className={styles.form_label}>一级分类</label>
          <select className={styles.form_input} value={form.category1Code} onChange={set('category1Code')} disabled={!isNew}>
            <option value="">请选择</option>
            {(catData?.category1List ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className={styles.form_field}>
          <label className={styles.form_label}>二级分类</label>
          <select className={styles.form_input} value={form.category2Code} onChange={set('category2Code')} disabled={!isNew}>
            <option value="">请选择</option>
            {Object.entries(Category2Label).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
      </div>
      <div className={styles.form_row}>
        <div className={styles.form_field}>
          <label className={styles.form_label}>库存单位 <span className={styles.required}>*</span></label>
          <input className={styles.form_input} value={form.stockUnit} onChange={set('stockUnit')} placeholder="如：kg" disabled={!isNew} />
        </div>
        <div className={styles.form_field}>
          <label className={styles.form_label}>采购单位 <span className={styles.required}>*</span></label>
          <input className={styles.form_input} value={form.purchaseUnit} onChange={set('purchaseUnit')} placeholder="如：件" disabled={!isNew} />
        </div>
      </div>
      <div className={styles.form_row}>
        <div className={styles.form_field}>
          <label className={styles.form_label}>安全库存 <span className={styles.required}>*</span></label>
          <input
            className={styles.form_input}
            type="number"
            min="0"
            step="0.01"
            value={form.safetyStock}
            onChange={set('safetyStock')}
            placeholder="0.00"
          />
        </div>
        <div className={styles.form_field}>
          <label className={styles.form_label}>规格说明</label>
          <input className={styles.form_input} value={form.specifications} onChange={set('specifications')} placeholder="可选" />
        </div>
      </div>
    </div>
  );
}
