/**
 * [artifact:前端代码] — 采购价格管理页
 * 功能：价格协议列表、关键字搜索(防抖)、状态筛选、新建/编辑价格协议
 *       T206-T207：双视图（按供应商 Accordion / 按物料表格）
 *       T208：按物料视图多供应商比价，最低价高亮绿色
 *       T209：价格涨跌幅箭头（△▽）+ tooltip
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useAppStore } from '@/stores/appStore';
import {
  usePriceList,
  useCreatePrice,
  useUpdatePrice,
} from '@/api/price';
import type { Price, CreatePricePayload } from '@/api/price';
import type { Column } from '@/components/common/Table';
import Table from '@/components/common/Table';
import Modal from '@/components/common/Modal';
import Tag from '@/components/common/Tag';
import Button from '@/components/common/Button';
import { formatCNY, formatDate } from '@/utils/format';
import styles from './PricePage.module.css';

// ─────────────────────────────────────────────
// 常量
// ─────────────────────────────────────────────

const PAGE_SIZE = 20;

type StatusFilter = '' | 'active' | 'inactive';

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: '', label: '全部状态' },
  { value: 'active', label: '有效' },
  { value: 'inactive', label: '失效' },
];

// T206: 视图模式
type ViewMode = 'by-supplier' | 'by-sku';

// T209: 扩展 Price 类型，携带涨跌幅信息（后端返回时生效，前端做降级处理）
type PriceWithChange = Price & {
  /** 与上次价格相比的变动百分比，正数涨、负数跌、null表示首次报价 */
  priceChangePct?: number | null;
};

// ─────────────────────────────────────────────
// T209: 价格涨跌幅指示器
// ─────────────────────────────────────────────

function PriceChangeIndicator({ pct }: { pct: number | null | undefined }) {
  const tooltipRef = useRef<HTMLSpanElement>(null);

  if (pct == null) return null;

  const isRise = pct > 0;
  const isFall = pct < 0;
  if (!isRise && !isFall) return null;

  const absStr = Math.abs(pct).toFixed(2);
  const label = isRise ? `涨幅 +${absStr}%` : `跌幅 -${absStr}%`;

  return (
    <span
      ref={tooltipRef}
      className={isRise ? styles.change_rise : styles.change_fall}
      title={label}
      aria-label={label}
    >
      {isRise ? '△' : '▽'}
    </span>
  );
}

// ─────────────────────────────────────────────
// T208: SKU 比价表（按物料视图用）
// ─────────────────────────────────────────────

type SkuGroup = {
  skuId: number;
  skuCode: string;
  skuName: string;
  prices: PriceWithChange[];
};

function buildSkuGroups(prices: PriceWithChange[]): SkuGroup[] {
  const map = new Map<number, SkuGroup>();
  for (const p of prices) {
    if (!map.has(p.skuId)) {
      map.set(p.skuId, { skuId: p.skuId, skuCode: p.skuCode, skuName: p.skuName, prices: [] });
    }
    map.get(p.skuId)!.prices.push(p);
  }
  return Array.from(map.values());
}

function PriceComparisonSection({ prices }: { prices: PriceWithChange[] }) {
  const groups = buildSkuGroups(prices);

  if (groups.length === 0) {
    return <div className={styles.comparison_empty}>暂无数据</div>;
  }

  return (
    <div className={styles.comparison_wrapper}>
      {groups.map((group) => {
        // 找最低价（含税单价数值最小）
        const numericPrices = group.prices.map((p) => Number(p.unitPrice));
        const minPrice = Math.min(...numericPrices);

        return (
          <div key={group.skuId} className={styles.comparison_card}>
            <div className={styles.comparison_card_header}>
              <span className={styles.mono}>{group.skuCode}</span>
              <span className={styles.comparison_sku_name}>{group.skuName}</span>
              <span className={styles.comparison_count}>{group.prices.length} 家供应商</span>
            </div>
            <table className={styles.comparison_table}>
              <thead>
                <tr>
                  <th>供应商</th>
                  <th>含税单价</th>
                  <th>采购单位</th>
                  <th>MOQ</th>
                  <th>有效期至</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {group.prices
                  .sort((a, b) => Number(a.unitPrice) - Number(b.unitPrice))
                  .map((p) => {
                    const isLowest = Number(p.unitPrice) === minPrice;
                    return (
                      <tr key={p.id} className={isLowest ? styles.comparison_row_best : ''}>
                        <td>{p.supplierName}</td>
                        <td className={styles.comparison_price_cell}>
                          <span className={isLowest ? styles.comparison_price_best : ''}>
                            {formatCNY(p.unitPrice)}
                          </span>
                          {isLowest && (
                            <span className={styles.comparison_best_badge}>最低</span>
                          )}
                          <PriceChangeIndicator pct={p.priceChangePct} />
                        </td>
                        <td>{p.purchaseUnit}</td>
                        <td>{p.moq != null ? String(p.moq) : '—'}</td>
                        <td>{p.validTo ? formatDate(p.validTo) : '长期'}</td>
                        <td>
                          {p.isActive
                            ? <Tag variant="success">有效</Tag>
                            : <Tag variant="neutral">失效</Tag>}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────
// T207: 按供应商 Accordion 折叠分组视图
// ─────────────────────────────────────────────

type SupplierGroup = {
  supplierId: number;
  supplierName: string;
  prices: PriceWithChange[];
};

function buildSupplierGroups(prices: PriceWithChange[]): SupplierGroup[] {
  const map = new Map<number, SupplierGroup>();
  for (const p of prices) {
    if (!map.has(p.supplierId)) {
      map.set(p.supplierId, { supplierId: p.supplierId, supplierName: p.supplierName, prices: [] });
    }
    map.get(p.supplierId)!.prices.push(p);
  }
  return Array.from(map.values());
}

function SupplierAccordion({
  group,
  onEdit,
}: {
  group: SupplierGroup;
  onEdit: (p: Price) => void;
}) {
  const [open, setOpen] = useState(true);
  const latestUpdatedAt = group.prices
    .map((p) => p.updatedAt)
    .sort()
    .at(-1);

  return (
    <div className={styles.accordion}>
      <button
        type="button"
        className={styles.accordion_header}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={styles.accordion_chevron} data-open={open}>▶</span>
        <span className={styles.accordion_supplier_name}>{group.supplierName}</span>
        <span className={styles.accordion_meta}>
          {group.prices.length} 条价格
          {latestUpdatedAt && (
            <> · 最近更新 {formatDate(latestUpdatedAt)}</>
          )}
        </span>
      </button>

      {open && (
        <div className={styles.accordion_body}>
          <table className={styles.supplier_table}>
            <thead>
              <tr>
                <th>SKU 编码</th>
                <th>物料名称</th>
                <th>含税单价</th>
                <th>采购单位</th>
                <th>MOQ</th>
                <th>有效期</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {group.prices.map((p) => {
                const isAnomaly = (p as Price & { priceAnomaly?: boolean }).priceAnomaly === true;
                return (
                  <tr key={p.id}>
                    <td><span className={styles.mono}>{p.skuCode}</span></td>
                    <td>{p.skuName}</td>
                    <td>
                      <span className={isAnomaly ? styles.price_anomaly : styles.price_normal}>
                        {formatCNY(p.unitPrice)}
                      </span>
                      <PriceChangeIndicator pct={p.priceChangePct} />
                    </td>
                    <td>{p.purchaseUnit}</td>
                    <td>{p.moq != null ? String(p.moq) : '—'}</td>
                    <td>{renderValidPeriod(p)}</td>
                    <td>
                      {p.isActive
                        ? <Tag variant="success">有效</Tag>
                        : <Tag variant="neutral">失效</Tag>}
                    </td>
                    <td>
                      <Button variant="ghost" size="sm" onClick={() => onEdit(p)}>
                        编辑
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 表单类型
// ─────────────────────────────────────────────

type PriceFormData = {
  supplierId: string;
  skuId: string;
  unitPrice: string;
  purchaseUnit: string;
  moq: string;
  validFrom: string;
  validTo: string;
  notes: string;
};

const EMPTY_PRICE_FORM: PriceFormData = {
  supplierId: '',
  skuId: '',
  unitPrice: '',
  purchaseUnit: '',
  moq: '',
  validFrom: '',
  validTo: '',
  notes: '',
};

type PriceRecord = PriceWithChange & Record<string, unknown>;

// ─────────────────────────────────────────────
// 辅助：有效期列显示
// ─────────────────────────────────────────────

function renderValidPeriod(price: Price): string {
  const from = formatDate(price.validFrom);
  const to = price.validTo ? formatDate(price.validTo) : '长期';
  return `${from} ~ ${to}`;
}

// ─────────────────────────────────────────────
// 页面组件
// ─────────────────────────────────────────────

export default function PricePage() {
  const { setPageTitle, showToast } = useAppStore();

  // T206: 视图模式状态
  const [viewMode, setViewMode] = useState<ViewMode>('by-sku');

  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');

  // 弹窗状态
  const [createModal, setCreateModal] = useState(false);
  const [editModal, setEditModal] = useState<{ open: boolean; price: Price | null }>({
    open: false,
    price: null,
  });

  const [priceForm, setPriceForm] = useState<PriceFormData>(EMPTY_PRICE_FORM);

  useEffect(() => { setPageTitle('采购价格管理'); }, [setPageTitle]);

  // 关键字防抖 350ms
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedKeyword(keyword); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [keyword]);

  // 状态筛选转 boolean
  const isActiveFilter: boolean | undefined =
    statusFilter === 'active' ? true :
    statusFilter === 'inactive' ? false :
    undefined;

  const { data, isLoading, error } = usePriceList({
    page,
    pageSize: PAGE_SIZE,
    keyword: debouncedKeyword || undefined,
    isActive: isActiveFilter,
  });

  const createMutation = useCreatePrice();
  const updateMutation = useUpdatePrice();

  // 打开编辑弹窗，预填字段
  const openEdit = useCallback((price: Price) => {
    setPriceForm({
      supplierId: String(price.supplierId),
      skuId: String(price.skuId),
      unitPrice: price.unitPrice,
      purchaseUnit: price.purchaseUnit,
      moq: price.moq != null ? String(price.moq) : '',
      validFrom: price.validFrom ? price.validFrom.slice(0, 10) : '',
      validTo: price.validTo ? price.validTo.slice(0, 10) : '',
      notes: price.notes ?? '',
    });
    setEditModal({ open: true, price });
  }, []);

  // 新建提交
  const handleCreate = async () => {
    const { supplierId, skuId, unitPrice, purchaseUnit, validFrom } = priceForm;
    if (!supplierId || !skuId || !unitPrice || !purchaseUnit || !validFrom) {
      showToast({ type: 'warning', message: '请填写所有必填字段' });
      return;
    }
    const payload: CreatePricePayload = {
      supplierId: Number(supplierId),
      skuId: Number(skuId),
      unitPrice,
      purchaseUnit,
      moq: priceForm.moq ? Number(priceForm.moq) : undefined,
      validFrom,
      validTo: priceForm.validTo || undefined,
      notes: priceForm.notes || undefined,
    };
    try {
      await createMutation.mutateAsync(payload);
      showToast({ type: 'success', message: '价格协议创建成功' });
      setCreateModal(false);
      setPriceForm(EMPTY_PRICE_FORM);
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message });
    }
  };

  // 编辑提交（仅可编辑非 skuId/supplierId 的字段）
  const handleUpdate = async () => {
    if (!editModal.price) return;
    const { unitPrice, purchaseUnit, validFrom } = priceForm;
    if (!unitPrice || !purchaseUnit || !validFrom) {
      showToast({ type: 'warning', message: '请填写所有必填字段' });
      return;
    }
    try {
      await updateMutation.mutateAsync({
        id: editModal.price.id,
        payload: {
          unitPrice,
          purchaseUnit,
          moq: priceForm.moq ? Number(priceForm.moq) : undefined,
          validFrom,
          validTo: priceForm.validTo || undefined,
          notes: priceForm.notes || undefined,
        },
      });
      showToast({ type: 'success', message: '价格协议已更新' });
      setEditModal({ open: false, price: null });
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message });
    }
  };

  // 列定义
  const columns: Column<PriceRecord>[] = [
    {
      key: 'skuCode',
      title: 'SKU 编码',
      width: '130px',
      render: (_, r) => {
        const p = r as unknown as Price;
        return (
          <span className={styles.mono}>{p.skuCode}</span>
        );
      },
    },
    {
      key: 'skuName',
      title: '物料名称',
      render: (_, r) => {
        const p = r as unknown as Price;
        return <span className={styles.cell_name}>{p.skuName}</span>;
      },
    },
    {
      key: 'supplierName',
      title: '供应商',
      width: '160px',
      render: (_, r) => (r as unknown as Price).supplierName,
    },
    {
      key: 'unitPrice',
      title: '含税单价',
      width: '120px',
      render: (_, r) => {
        const p = r as unknown as Price;
        // priceAnomaly 标记高亮（接口未来返回时生效）
        const isAnomaly = (p as Price & { priceAnomaly?: boolean }).priceAnomaly === true;
        return (
          <span className={isAnomaly ? styles.price_anomaly : styles.price_normal}>
            {formatCNY(p.unitPrice)}
          </span>
        );
      },
    },
    {
      key: 'purchaseUnit',
      title: '采购单位',
      width: '90px',
      render: (_, r) => (r as unknown as Price).purchaseUnit,
    },
    {
      key: 'moq',
      title: '最小起订量',
      width: '110px',
      render: (_, r) => {
        const p = r as unknown as Price;
        return p.moq != null ? String(p.moq) : '—';
      },
    },
    {
      key: 'validPeriod',
      title: '有效期',
      width: '200px',
      render: (_, r) => renderValidPeriod(r as unknown as Price),
    },
    {
      key: 'isActive',
      title: '状态',
      width: '80px',
      render: (_, r) => {
        const p = r as unknown as Price;
        return p.isActive
          ? <Tag variant="success">有效</Tag>
          : <Tag variant="neutral">失效</Tag>;
      },
    },
    {
      key: 'actions',
      title: '操作',
      width: '80px',
      render: (_, r) => {
        const p = r as unknown as Price;
        return (
          <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>
            编辑
          </Button>
        );
      },
    },
  ];

  const priceList = (data?.list ?? []) as PriceRecord[];

  return (
    <div className={styles.page}>
      {/* 页头 */}
      <div className="page-header">
        <h1 className="page-header__title">采购价格管理</h1>
        <div className="page-header__actions">
          <Button
            variant="primary"
            size="md"
            onClick={() => { setPriceForm(EMPTY_PRICE_FORM); setCreateModal(true); }}
          >
            新建价格协议
          </Button>
        </div>
      </div>

      {/* 筛选栏 */}
      <div className={styles.filter_bar}>
        <input
          type="search"
          className={styles.filter_search}
          placeholder="搜索 SKU 编码 / 名称 / 供应商..."
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          aria-label="搜索价格协议"
        />
        <select
          className={styles.filter_select}
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value as StatusFilter); setPage(1); }}
          aria-label="状态筛选"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* 数据表格 */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <Table<PriceRecord>
          columns={columns}
          dataSource={priceList}
          rowKey="id"
          loading={isLoading}
          error={error ? (error as Error).message : null}
          emptyText="暂无价格协议数据"
          pagination={
            data
              ? { page, pageSize: PAGE_SIZE, total: data.total, onChange: setPage }
              : undefined
          }
        />
      </div>

      {/* 新建价格协议 Modal */}
      <Modal
        open={createModal}
        title="新建价格协议"
        onClose={() => setCreateModal(false)}
        onConfirm={() => void handleCreate()}
        confirmLabel="创建"
        confirmLoading={createMutation.isPending}
        size="md"
      >
        <PriceFormFields form={priceForm} onChange={setPriceForm} isNew />
      </Modal>

      {/* 编辑价格协议 Modal */}
      <Modal
        open={editModal.open}
        title={`编辑价格协议 — ${editModal.price?.skuCode ?? ''}`}
        onClose={() => setEditModal({ open: false, price: null })}
        onConfirm={() => void handleUpdate()}
        confirmLabel="保存"
        confirmLoading={updateMutation.isPending}
        size="md"
      >
        <PriceFormFields form={priceForm} onChange={setPriceForm} isNew={false} />
      </Modal>
    </div>
  );
}

// ─────────────────────────────────────────────
// 内部子组件：价格协议表单字段
// ─────────────────────────────────────────────

type PriceFormFieldsProps = {
  form: PriceFormData;
  onChange: React.Dispatch<React.SetStateAction<PriceFormData>>;
  isNew: boolean;
};

function PriceFormFields({ form, onChange, isNew }: PriceFormFieldsProps) {
  const set =
    (field: keyof PriceFormData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange((f) => ({ ...f, [field]: e.target.value }));

  return (
    <div className={styles.price_form}>
      {/* 供应商 ID / SKU ID */}
      <div className={styles.form_row}>
        <div className={styles.form_field}>
          <label className={styles.form_label}>
            供应商 ID <span className={styles.required}>*</span>
          </label>
          <input
            className={styles.form_input}
            type="number"
            min="1"
            step="1"
            placeholder="供应商数字 ID"
            value={form.supplierId}
            onChange={set('supplierId')}
            disabled={!isNew}
          />
        </div>
        <div className={styles.form_field}>
          <label className={styles.form_label}>
            SKU ID <span className={styles.required}>*</span>
          </label>
          <input
            className={styles.form_input}
            type="number"
            min="1"
            step="1"
            placeholder="SKU 数字 ID"
            value={form.skuId}
            onChange={set('skuId')}
            disabled={!isNew}
          />
        </div>
      </div>

      {/* 含税单价 / 采购单位 */}
      <div className={styles.form_row}>
        <div className={styles.form_field}>
          <label className={styles.form_label}>
            含税单价（元）<span className={styles.required}>*</span>
          </label>
          <input
            className={styles.form_input}
            type="number"
            min="0"
            step="0.01"
            placeholder="如：128.50"
            value={form.unitPrice}
            onChange={set('unitPrice')}
          />
        </div>
        <div className={styles.form_field}>
          <label className={styles.form_label}>
            采购单位 <span className={styles.required}>*</span>
          </label>
          <input
            className={styles.form_input}
            placeholder="如：件、kg、卷"
            value={form.purchaseUnit}
            onChange={set('purchaseUnit')}
          />
        </div>
      </div>

      {/* 最小起订量 / 有效期开始 */}
      <div className={styles.form_row}>
        <div className={styles.form_field}>
          <label className={styles.form_label}>最小起订量（MOQ）</label>
          <input
            className={styles.form_input}
            type="number"
            min="0"
            step="1"
            placeholder="可选，如：100"
            value={form.moq}
            onChange={set('moq')}
          />
        </div>
        <div className={styles.form_field}>
          <label className={styles.form_label}>
            有效期开始 <span className={styles.required}>*</span>
          </label>
          <input
            className={styles.form_input}
            type="date"
            value={form.validFrom}
            onChange={set('validFrom')}
          />
        </div>
      </div>

      {/* 有效期截止（可选） */}
      <div className={styles.form_row}>
        <div className={styles.form_field}>
          <label className={styles.form_label}>
            有效期截止
            <span className={styles.form_label_hint}>（留空表示长期有效）</span>
          </label>
          <input
            className={styles.form_input}
            type="date"
            value={form.validTo}
            onChange={set('validTo')}
          />
        </div>
        <div className={styles.form_field} />
      </div>

      {/* 备注 */}
      <div className={styles.form_field}>
        <label className={styles.form_label}>备注</label>
        <textarea
          className={styles.form_textarea}
          rows={3}
          placeholder="可选，填写备注信息"
          value={form.notes}
          onChange={set('notes')}
        />
      </div>
    </div>
  );
}
