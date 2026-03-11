/**
 * [artifact:前端代码] — BOM 管理页
 * 功能：BOM 列表、展开物料清单、激活 BOM 版本、查看物料需求
 */

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useAppStore } from '@/stores/appStore';
import {
  useBomList,
  useBomExpanded,
  useMaterialRequirements,
  useCreateBom,
  useActivateBom,
} from '@/api/bom';
import { BomStatus } from '@/types/enums';
import type { BomHeader, BomDetail, BomItem } from '@/types/models';
import type { Column } from '@/components/common/Table';
import Table from '@/components/common/Table';
import Modal from '@/components/common/Modal';
import Drawer from '@/components/common/Drawer';
import Tag from '@/components/common/Tag';
import Button from '@/components/common/Button';
import SummaryStrip from '@/components/common/SummaryStrip';
import BomTree from '@/components/common/BomTree';
import { formatDateTime, formatQtyStr } from '@/utils/format';
import styles from './BomPage.module.css';

type BomRecord = BomHeader & Record<string, unknown>;

const BOM_STATUS_VARIANT: Record<BomStatus, 'success' | 'neutral' | 'warning' | 'info'> = {
  [BomStatus.ACTIVE]:   'success',
  [BomStatus.DRAFT]:    'neutral',
  [BomStatus.OBSOLETE]: 'warning',
};
const BOM_STATUS_LABEL: Record<BomStatus, string> = {
  [BomStatus.ACTIVE]:   '启用',
  [BomStatus.DRAFT]:    '草稿',
  [BomStatus.OBSOLETE]: '已废弃',
};

type CreateBomForm = {
  skuId: string;
  version: string;
  description: string;
};

export default function BomPage() {
  const { setPageTitle, showToast } = useAppStore();
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<BomStatus | ''>('');

  // 展开详情 Drawer
  const [detailDrawer, setDetailDrawer] = useState<{ open: boolean; bom: BomHeader | null }>({ open: false, bom: null });
  // 物料需求 Drawer
  const [reqDrawer, setReqDrawer] = useState<{ open: boolean; bom: BomHeader | null }>({ open: false, bom: null });
  // 激活确认弹窗
  const [activateModal, setActivateModal] = useState<{ open: boolean; bom: BomHeader | null }>({ open: false, bom: null });
  // 新建 BOM 弹窗
  const [createModal, setCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState<CreateBomForm>({ skuId: '', version: '', description: '' });
  // 新建 BOM 物料行
  const [bomItems, setBomItems] = useState<Array<{ materialSkuId: string; qty: string; unit: string; sequence: string }>>([
    { materialSkuId: '', qty: '', unit: '', sequence: '10' },
  ]);

  useEffect(() => { setPageTitle('BOM 管理'); }, [setPageTitle]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedKeyword(keyword), 350);
    return () => clearTimeout(t);
  }, [keyword]);

  const { data, isLoading, error } = useBomList(
    debouncedKeyword || undefined,
    statusFilter as BomStatus || undefined,
    page,
    20,
  );

  const { data: detailData, isLoading: detailLoading } = useBomExpanded(
    detailDrawer.bom?.id ?? '',
    { enabled: detailDrawer.open && !!detailDrawer.bom },
  );

  const { data: reqData, isLoading: reqLoading } = useMaterialRequirements(
    reqDrawer.bom?.id ?? '',
    { enabled: reqDrawer.open && !!reqDrawer.bom },
  );

  const createMutation  = useCreateBom();
  const activateMutation = useActivateBom();

  const openDetail = useCallback((bom: BomHeader) => setDetailDrawer({ open: true, bom }), []);
  const openReq    = useCallback((bom: BomHeader) => setReqDrawer({ open: true, bom }), []);

  const handleActivate = async () => {
    if (!activateModal.bom) return;
    try {
      await activateMutation.mutateAsync(activateModal.bom.id);
      showToast({ type: 'success', message: `BOM ${activateModal.bom.version} 已激活` });
      setActivateModal({ open: false, bom: null });
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message });
    }
  };

  const handleCreate = async () => {
    const { skuId, version } = createForm;
    if (!skuId || !version) {
      showToast({ type: 'warning', message: '请填写成品 SKU ID 和版本号' });
      return;
    }
    const validItems = bomItems.filter((i) => i.materialSkuId && i.qty && i.unit);
    if (validItems.length === 0) {
      showToast({ type: 'warning', message: '请至少填写一条物料行' });
      return;
    }
    try {
      await createMutation.mutateAsync({
        skuId,
        version,
        description: createForm.description || undefined,
        items: validItems.map((i) => ({
          materialSkuId: i.materialSkuId,
          qty: Number(i.qty),
          unit: i.unit,
          sequence: Number(i.sequence) || 10,
        })),
      });
      showToast({ type: 'success', message: 'BOM 创建成功' });
      setCreateModal(false);
      setCreateForm({ skuId: '', version: '', description: '' });
      setBomItems([{ materialSkuId: '', qty: '', unit: '', sequence: '10' }]);
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message });
    }
  };

  const addBomItem = () =>
    setBomItems((rows) => [...rows, { materialSkuId: '', qty: '', unit: '', sequence: String((rows.length + 1) * 10) }]);
  const removeBomItem = (idx: number) => setBomItems((rows) => rows.filter((_, i) => i !== idx));
  const updateBomItem = (idx: number, field: string, value: string) =>
    setBomItems((rows) => rows.map((r, i) => i === idx ? { ...r, [field]: value } : r));

  const columns: Column<BomRecord>[] = [
    {
      key: 'version',
      title: '版本号',
      width: 100,
      render: (_, r) => {
        const b = r as unknown as BomHeader;
        return <span style={{ fontFamily: 'var(--font-family-mono)', fontSize: 13 }}>{b.version}</span>;
      },
    },
    {
      key: 'skuName',
      title: '成品 SKU',
      render: (_, r) => {
        const b = r as unknown as BomHeader;
        return (
          <div>
            <div style={{ fontWeight: 500 }}>{b.skuName}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-family-mono)' }}>{b.skuCode}</div>
          </div>
        );
      },
    },
    {
      key: 'status',
      title: '状态',
      width: 80,
      render: (_, r) => {
        const b = r as unknown as BomHeader;
        return <Tag variant={BOM_STATUS_VARIANT[b.status]}>{BOM_STATUS_LABEL[b.status]}</Tag>;
      },
    },
    {
      key: 'itemCount',
      title: '物料数',
      width: 80,
      render: (_, r) => `${(r as unknown as BomHeader).itemCount ?? '-'} 项`,
    },
    {
      key: 'description',
      title: '说明',
      render: (_, r) => (r as unknown as BomHeader).description ?? '—',
    },
    {
      key: 'updatedAt',
      title: '更新时间',
      width: 160,
      render: (_, r) => formatDateTime((r as unknown as BomHeader).updatedAt),
    },
    {
      key: 'actions',
      title: '操作',
      width: 200,
      render: (_, r) => {
        const b = r as unknown as BomHeader;
        return (
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <Button variant="ghost" size="sm" onClick={() => openDetail(b)}>物料清单</Button>
            <Button variant="ghost" size="sm" onClick={() => openReq(b)}>需求分析</Button>
            {b.status === BomStatus.DRAFT && (
              <Button variant="ghost" size="sm" onClick={() => setActivateModal({ open: true, bom: b })}>激活</Button>
            )}
          </div>
        );
      },
    },
  ];

  const bomList = (data?.list ?? []) as BomRecord[];

  return (
    <div className={styles.page}>
      <div className="page-header">
        <h1 className="page-header__title">BOM 管理</h1>
        <div className="page-header__actions">
          <Button variant="primary" size="md" onClick={() => setCreateModal(true)}>新建 BOM</Button>
        </div>
      </div>

      {/* 筛选栏 */}
      <div className={styles.filter_bar}>
        <input
          type="search"
          className={styles.filter_search}
          placeholder="搜索 SKU 编码 / 名称 / 版本..."
          value={keyword}
          onChange={(e) => { setKeyword(e.target.value); setPage(1); }}
          aria-label="搜索 BOM"
        />
        <select
          className={styles.filter_select}
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value as BomStatus | ''); setPage(1); }}
          aria-label="状态筛选"
        >
          <option value="">全部状态</option>
          {Object.entries(BOM_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <Table<BomRecord>
          columns={columns}
          dataSource={bomList}
          rowKey="id"
          loading={isLoading}
          error={error ? (error as Error).message : null}
          emptyText="暂无 BOM 数据"
          pagination={data ? { page, pageSize: 20, total: data.total, onChange: setPage } : undefined}
        />
      </div>

      {/* 物料清单 Drawer */}
      <Drawer
        open={detailDrawer.open}
        title={`物料清单 — ${detailDrawer.bom?.skuName ?? ''} (${detailDrawer.bom?.version ?? ''})`}
        width={600}
        onClose={() => setDetailDrawer({ open: false, bom: null })}
      >
        {detailLoading ? (
          <div className={styles.drawer_loading}>
            <div className="spinner" role="status" aria-label="加载中" />
            <span>加载物料清单...</span>
          </div>
        ) : detailData ? (
          <BomDetailTable detail={detailData} />
        ) : (
          <p style={{ color: 'var(--text-secondary)', padding: 'var(--space-4)' }}>暂无数据</p>
        )}
      </Drawer>

      {/* 物料需求分析 Drawer */}
      <Drawer
        open={reqDrawer.open}
        title={`物料需求分析 — ${reqDrawer.bom?.skuName ?? ''}`}
        width={560}
        onClose={() => setReqDrawer({ open: false, bom: null })}
      >
        {reqLoading ? (
          <div className={styles.drawer_loading}>
            <div className="spinner" role="status" aria-label="加载中" />
            <span>计算需求...</span>
          </div>
        ) : reqData ? (
          <MaterialRequirementsView data={reqData} />
        ) : (
          <p style={{ color: 'var(--text-secondary)', padding: 'var(--space-4)' }}>暂无数据</p>
        )}
      </Drawer>

      {/* 激活确认弹窗 */}
      <Modal
        open={activateModal.open}
        title="激活 BOM 版本"
        onClose={() => setActivateModal({ open: false, bom: null })}
        onConfirm={() => void handleActivate()}
        confirmLabel="确认激活"
        confirmLoading={activateMutation.isPending}
        size="sm"
      >
        <div className={styles.activate_body}>
          <p>
            确认激活 BOM 版本 <strong>{activateModal.bom?.version}</strong>？
          </p>
          <div className="alert alert--warning" style={{ marginTop: 'var(--space-3)' }}>
            激活后，同一 SKU 的其他启用版本将自动设为废弃。此操作不可撤销。
          </div>
        </div>
      </Modal>

      {/* 新建 BOM 弹窗 */}
      <Modal
        open={createModal}
        title="新建 BOM"
        onClose={() => setCreateModal(false)}
        onConfirm={() => void handleCreate()}
        confirmLabel="创建"
        confirmLoading={createMutation.isPending}
        size="lg"
      >
        <div className={styles.create_form}>
          <div className={styles.form_row}>
            <div className={styles.form_field}>
              <label className={styles.form_label}>成品 SKU ID <span className={styles.required}>*</span></label>
              <input
                className={styles.form_input}
                value={createForm.skuId}
                onChange={(e) => setCreateForm((f) => ({ ...f, skuId: e.target.value }))}
                placeholder="SKU 内部 ID"
              />
            </div>
            <div className={styles.form_field}>
              <label className={styles.form_label}>版本号 <span className={styles.required}>*</span></label>
              <input
                className={styles.form_input}
                value={createForm.version}
                onChange={(e) => setCreateForm((f) => ({ ...f, version: e.target.value }))}
                placeholder="如：V1.0"
              />
            </div>
          </div>
          <div className={styles.form_field}>
            <label className={styles.form_label}>说明</label>
            <input
              className={styles.form_input}
              value={createForm.description}
              onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="可选"
            />
          </div>

          <div className={styles.items_section}>
            <div className={styles.items_title}>物料明细</div>
            <div className={styles.items_header}>
              <span>物料 SKU ID</span>
              <span>用量</span>
              <span>单位</span>
              <span>序号</span>
              <span></span>
            </div>
            {bomItems.map((item, idx) => (
              <div key={idx} className={styles.items_row}>
                <input
                  className={styles.form_input}
                  value={item.materialSkuId}
                  onChange={(e) => updateBomItem(idx, 'materialSkuId', e.target.value)}
                  placeholder="SKU ID"
                />
                <input
                  className={styles.form_input}
                  type="number"
                  min="0"
                  step="0.000001"
                  value={item.qty}
                  onChange={(e) => updateBomItem(idx, 'qty', e.target.value)}
                  placeholder="0.00"
                />
                <input
                  className={styles.form_input}
                  value={item.unit}
                  onChange={(e) => updateBomItem(idx, 'unit', e.target.value)}
                  placeholder="如：kg"
                />
                <input
                  className={styles.form_input}
                  type="number"
                  min="1"
                  value={item.sequence}
                  onChange={(e) => updateBomItem(idx, 'sequence', e.target.value)}
                  placeholder="10"
                />
                <button
                  className={styles.item_remove}
                  onClick={() => removeBomItem(idx)}
                  disabled={bomItems.length <= 1}
                  aria-label="删除此行"
                >×</button>
              </div>
            ))}
            <Button variant="ghost" size="sm" onClick={addBomItem} style={{ alignSelf: 'flex-start', marginTop: 'var(--space-2)' }}>
              + 添加物料行
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ——— AI 建议类型 ——— */

type AiSuggestion = {
  id: string;
  materialName: string;
  qty: number;
  unit: string;
  confidence: number; // 0–100
  reason: string;
};

/* ——— 内部子组件 ——— */

function BomDetailTable({ detail }: { detail: BomDetail }) {
  const [selectedItemId, setSelectedItemId] = useState<number | undefined>(undefined);

  // AI 建议面板状态
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<AiSuggestion[]>([]);
  const [adoptedIds, setAdoptedIds] = useState<Set<string>>(new Set());
  const aiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSelectItem = useCallback((item: BomItem) => {
    setSelectedItemId((prev) => (prev === item.bomItemId ? undefined : item.bomItemId));
  }, []);

  /** 点击"AI 建议物料"按钮 —— 模拟异步请求 */
  const handleAiSuggest = useCallback(() => {
    setShowAiPanel(true);
    setAiLoading(true);
    setAiSuggestions([]);
    setAdoptedIds(new Set());

    // 模拟 1.5s 后返回建议
    if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    aiTimerRef.current = setTimeout(() => {
      setAiSuggestions([
        {
          id: 'ai-1',
          materialName: '精梳棉纱 32 支',
          qty: 120,
          unit: 'kg',
          confidence: 92,
          reason: '历史订单中该物料使用频率最高，用量匹配当前成品规格',
        },
        {
          id: 'ai-2',
          materialName: '涤纶缝纫线 150D',
          qty: 5,
          unit: '卷',
          confidence: 85,
          reason: '同类 BOM 版本普遍配置此物料，建议补录',
        },
        {
          id: 'ai-3',
          materialName: '内衬无纺布',
          qty: 30,
          unit: '米',
          confidence: 71,
          reason: '基于产品工艺标准推断，置信度中等，请人工确认',
        },
      ]);
      setAiLoading(false);
    }, 1500);
  }, []);

  /** 采纳单条建议 */
  const handleAdopt = useCallback((id: string) => {
    setAdoptedIds((prev) => new Set([...prev, id]));
  }, []);

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    };
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* BOM 基础信息 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
        <InfoRow label="成品 SKU" value={`${detail.skuName} (${detail.skuCode})`} />
        <InfoRow label="BOM 版本" value={detail.version} />
        <InfoRow label="状态" value={BOM_STATUS_LABEL[detail.status]} />
        <InfoRow label="更新时间" value={formatDateTime(detail.updatedAt)} />
      </div>
      {detail.description && <InfoRow label="说明" value={detail.description} />}

      {/* BomTree 递归树形物料清单 */}
      <div className={styles.bom_tree_wrapper}>
        <BomTree
          items={detail.items}
          selectedId={selectedItemId}
          onSelect={handleSelectItem}
        />
      </div>

      {/* AI 建议物料按钮 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', paddingTop: 'var(--space-2)', borderTop: '1px solid var(--border-subtle)' }}>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleAiSuggest}
          loading={aiLoading}
        >
          AI 建议物料
        </Button>
        {showAiPanel && !aiLoading && aiSuggestions.length > 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            共 {aiSuggestions.length} 条建议，已采纳 {adoptedIds.size} 条
          </span>
        )}
      </div>

      {/* AI 建议面板 */}
      {showAiPanel && (
        <div className={styles.ai_panel}>
          <div className={styles.ai_panel__header}>
            <span className={styles.ai_panel__title}>AI 物料建议</span>
            <button
              className={styles.ai_panel__close}
              onClick={() => setShowAiPanel(false)}
              aria-label="关闭 AI 建议面板"
            >
              ×
            </button>
          </div>

          {aiLoading ? (
            <div className={styles.ai_panel__loading}>
              <div className="spinner" role="status" aria-label="AI 分析中" />
              <span>AI 正在分析物料组成...</span>
            </div>
          ) : aiSuggestions.length === 0 ? (
            <p className={styles.ai_panel__empty}>暂无建议</p>
          ) : (
            <ul className={styles.ai_panel__list}>
              {aiSuggestions.map((s) => {
                const adopted = adoptedIds.has(s.id);
                return (
                  <li key={s.id} className={`${styles.ai_panel__item} ${adopted ? styles['ai_panel__item--adopted'] : ''}`}>
                    <div className={styles.ai_panel__item_main}>
                      <div className={styles.ai_panel__item_name}>{s.materialName}</div>
                      <div className={styles.ai_panel__item_meta}>
                        <span>
                          用量：<strong>{s.qty} {s.unit}</strong>
                        </span>
                        <span
                          className={styles.ai_panel__confidence}
                          style={{
                            color: s.confidence >= 85
                              ? 'var(--color-success-700)'
                              : s.confidence >= 70
                              ? 'var(--color-warning-700)'
                              : 'var(--color-error-600)',
                          }}
                        >
                          置信度 {s.confidence}%
                        </span>
                      </div>
                      <div className={styles.ai_panel__item_reason}>{s.reason}</div>
                    </div>
                    <div className={styles.ai_panel__item_action}>
                      {adopted ? (
                        <span className={styles.ai_panel__adopted_label}>已采纳</span>
                      ) : (
                        <Button variant="primary" size="sm" onClick={() => handleAdopt(s.id)}>
                          采纳
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function MaterialRequirementsView({ data }: { data: { items: Array<{ skuCode: string; skuName: string; required: number; available: number; shortfall: number; unit: string }> } }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <p style={{ fontSize: 'var(--text-body-s)', color: 'var(--text-secondary)' }}>
        基于当前库存计算物料缺口，红色行表示库存不足。
      </p>
      <table className={styles.detail_table}>
        <thead>
          <tr>
            <th>物料 SKU</th>
            <th style={{ textAlign: 'right' }}>需求量</th>
            <th style={{ textAlign: 'right' }}>可用量</th>
            <th style={{ textAlign: 'right' }}>缺口</th>
            <th>单位</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((item) => (
            <tr
              key={item.skuCode}
              style={item.shortfall > 0 ? { background: 'var(--color-error-50)' } : undefined}
            >
              <td>
                <div style={{ fontWeight: 500 }}>{item.skuName}</div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-family-mono)' }}>{item.skuCode}</div>
              </td>
              <td style={{ textAlign: 'right', fontFamily: 'var(--font-family-mono)' }}>{formatQtyStr(item.required, 3)}</td>
              <td style={{ textAlign: 'right', fontFamily: 'var(--font-family-mono)' }}>{formatQtyStr(item.available, 3)}</td>
              <td style={{ textAlign: 'right', fontFamily: 'var(--font-family-mono)', color: item.shortfall > 0 ? 'var(--color-error-600)' : 'var(--color-success-600)', fontWeight: item.shortfall > 0 ? 700 : 400 }}>
                {item.shortfall > 0 ? `-${formatQtyStr(item.shortfall, 3)}` : '充足'}
              </td>
              <td>{item.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <span style={{ fontSize: 'var(--text-body-m)', color: 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}
