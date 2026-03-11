/**
 * [artifact:前端代码] — 工序配置页
 * 功能：工序模板列表、关键字搜索（防抖350ms）、类型筛选、新建/编辑/删除 Modal、分页
 */

import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import {
  useProcessConfigList,
  useCreateProcessConfig,
  useUpdateProcessConfig,
  useDeleteProcessConfig,
} from '@/api/processConfig';
import type {
  ProcessConfig,
  ProcessConfigListQuery,
  CreateProcessConfigPayload,
} from '@/api/processConfig';
import type { Column } from '@/components/common/Table';
import Table from '@/components/common/Table';
import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import Tag from '@/components/common/Tag';
import styles from './ProcessConfigPage.module.css';

// ——— 工序类型 → CSS 修饰类映射 ———

const PROCESS_TYPE_MODIFIER: Record<string, string> = {
  裁剪: 'cj',
  缝制: 'fz',
  整烫: 'zt',
  检验: 'jy',
  包装: 'bz',
};

// ——— T210: ProcessRouteFlow — 工序路由流程图组件 ———

type ProcessRouteFlowProps = {
  /** 工序列表，按 sortOrder 已排好序或由组件内部排序 */
  steps: ProcessConfig[];
  /** 路线名称，用于区域标题 */
  routeTitle?: string;
};

/**
 * 将工序路线步骤渲染为横向（桌面）/ 纵向（移动端 <768px）流程图。
 * - 每个节点展示：步骤序号、工序名称、工序类型（彩色标签）、工作站名称、标准工时
 * - 节点间用箭头连接
 * - 无步骤时展示空状态提示
 * - 纯 CSS Module 实现，无第三方图表库依赖
 */
function ProcessRouteFlow({ steps, routeTitle = '工序路由流程' }: ProcessRouteFlowProps) {
  const sorted = [...steps].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  return (
    <div className={`card ${styles.process_flow}`}>
      <h3 className={styles.process_flow__title}>{routeTitle}</h3>

      {sorted.length === 0 ? (
        /* 空状态 */
        <div className={styles.process_flow__empty}>
          <span className={styles.process_flow__empty_icon} aria-hidden="true">⚙️</span>
          <span className={styles.process_flow__empty_text}>暂无工序步骤，请先添加工序配置</span>
        </div>
      ) : (
        <div className={styles.process_flow__track} role="list" aria-label={`${routeTitle}步骤列表`}>
          {sorted.map((step, idx) => {
            const modifier = PROCESS_TYPE_MODIFIER[step.type];
            const nodeClass = [
              styles.process_flow__node,
              modifier ? styles[`process_flow__node--${modifier}` as keyof typeof styles] : '',
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <div
                key={step.id}
                className={styles.process_flow__node_wrap}
                role="listitem"
              >
                {/* 流程节点 */}
                <div className={nodeClass} title={step.description ?? step.name}>
                  {/* 序号圆点 */}
                  <span className={styles.process_flow__node_order} aria-label={`步骤 ${idx + 1}`}>
                    {idx + 1}
                  </span>

                  {/* 节点文字内容区 */}
                  <div className={styles.process_flow__node_content}>
                    <span className={styles.process_flow__node_name}>{step.name}</span>
                    <span className={styles.process_flow__node_type}>{step.type}</span>
                    {step.workstation && (
                      <span className={styles.process_flow__node_workstation}>{step.workstation}</span>
                    )}
                    <span className={styles.process_flow__node_meta}>
                      {Number(step.standardHours).toFixed(1)} h/套
                    </span>
                  </div>
                </div>

                {/* 连接箭头（最后一个节点不渲染） */}
                {idx < sorted.length - 1 && (
                  <span className={styles.process_flow__arrow} aria-hidden="true">→</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ——— 类型扩展 ———

type ProcessConfigRecord = ProcessConfig & Record<string, unknown>;

// ——— 表单类型 ———

type ProcessConfigFormData = {
  name: string;
  type: string;
  standardHours: string;
  unitCost: string;
  workstation: string;
  description: string;
  sortOrder: string;
};

const EMPTY_FORM: ProcessConfigFormData = {
  name: '',
  type: '',
  standardHours: '',
  unitCost: '',
  workstation: '',
  description: '',
  sortOrder: '0',
};

// ——— 工序类型选项（固定枚举，后端一般约定几种核心类型） ———

const PROCESS_TYPE_OPTIONS = [
  { value: '', label: '全部类型' },
  { value: '裁剪', label: '裁剪' },
  { value: '缝制', label: '缝制' },
  { value: '整烫', label: '整烫' },
  { value: '检验', label: '检验' },
  { value: '包装', label: '包装' },
  { value: '其他', label: '其他' },
];

const PROCESS_TYPE_TAG_VARIANT: Record<string, 'info' | 'success' | 'warning' | 'neutral' | 'danger'> = {
  裁剪: 'info',
  缝制: 'success',
  整烫: 'warning',
  检验: 'neutral',
  包装: 'info',
  其他: 'neutral',
};

// ——— 工序配置页面主组件 ———

export default function ProcessConfigPage() {
  const { setPageTitle, showToast } = useAppStore();

  // 分页
  const [page, setPage] = useState(1);

  // 筛选
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  // Modal 状态
  const [createModal, setCreateModal] = useState(false);
  const [editModal, setEditModal] = useState<{ open: boolean; record: ProcessConfig | null }>({
    open: false,
    record: null,
  });
  const [deleteModal, setDeleteModal] = useState<{ open: boolean; record: ProcessConfig | null }>({
    open: false,
    record: null,
  });

  // 表单数据
  const [form, setForm] = useState<ProcessConfigFormData>(EMPTY_FORM);

  // 页面标题
  useEffect(() => {
    setPageTitle('工序配置');
  }, [setPageTitle]);

  // 防抖搜索关键字（350ms）
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedKeyword(keyword);
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [keyword]);

  // 构建查询参数
  const query: ProcessConfigListQuery = {
    keyword: debouncedKeyword || undefined,
    type: typeFilter || undefined,
    page,
    pageSize: 20,
  };

  // API hooks
  const { data, isLoading } = useProcessConfigList(query);
  const createMutation = useCreateProcessConfig();
  const updateMutation = useUpdateProcessConfig();
  const deleteMutation = useDeleteProcessConfig();

  // ——— 操作处理 ———

  const openCreate = useCallback(() => {
    setForm(EMPTY_FORM);
    setCreateModal(true);
  }, []);

  const openEdit = useCallback((record: ProcessConfig) => {
    setForm({
      name: record.name,
      type: record.type,
      standardHours: String(record.standardHours),
      unitCost: String(record.unitCost),
      workstation: record.workstation ?? '',
      description: record.description ?? '',
      sortOrder: String(record.sortOrder ?? 0),
    });
    setEditModal({ open: true, record });
  }, []);

  const openDelete = useCallback((record: ProcessConfig) => {
    setDeleteModal({ open: true, record });
  }, []);

  const validateForm = (): boolean => {
    if (!form.name.trim()) {
      showToast({ type: 'warning', message: '请输入工序名称' });
      return false;
    }
    if (!form.type.trim()) {
      showToast({ type: 'warning', message: '请输入工序类型' });
      return false;
    }
    if (!form.standardHours || Number(form.standardHours) < 0) {
      showToast({ type: 'warning', message: '请输入有效的标准工时' });
      return false;
    }
    if (!form.unitCost || Number(form.unitCost) < 0) {
      showToast({ type: 'warning', message: '请输入有效的单位成本' });
      return false;
    }
    return true;
  };

  const handleCreate = async () => {
    if (!validateForm()) return;
    const payload: CreateProcessConfigPayload = {
      name: form.name.trim(),
      type: form.type.trim(),
      standardHours: Number(form.standardHours),
      unitCost: Number(form.unitCost),
      workstation: form.workstation.trim() || undefined,
      description: form.description.trim() || undefined,
      sortOrder: Number(form.sortOrder) || 0,
    };
    try {
      await createMutation.mutateAsync(payload);
      showToast({ type: 'success', message: '工序配置创建成功' });
      setCreateModal(false);
      setForm(EMPTY_FORM);
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message ?? '创建失败' });
    }
  };

  const handleUpdate = async () => {
    if (!editModal.record) return;
    if (!validateForm()) return;
    try {
      await updateMutation.mutateAsync({
        id: editModal.record.id,
        payload: {
          name: form.name.trim(),
          type: form.type.trim(),
          standardHours: Number(form.standardHours),
          unitCost: Number(form.unitCost),
          workstation: form.workstation.trim() || undefined,
          description: form.description.trim() || undefined,
          sortOrder: Number(form.sortOrder) || 0,
        },
      });
      showToast({ type: 'success', message: '工序配置更新成功' });
      setEditModal({ open: false, record: null });
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message ?? '更新失败' });
    }
  };

  const handleDelete = async () => {
    if (!deleteModal.record) return;
    try {
      await deleteMutation.mutateAsync(deleteModal.record.id);
      showToast({ type: 'success', message: `工序「${deleteModal.record.name}」已删除` });
      setDeleteModal({ open: false, record: null });
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message ?? '删除失败' });
    }
  };

  // ——— 表格列定义 ———

  const columns: Column<ProcessConfigRecord>[] = [
    {
      key: 'name',
      title: '工序名称',
      render: (_, r) => {
        const record = r as unknown as ProcessConfig;
        return (
          <div>
            <div className={styles.cell_name}>{record.name}</div>
            {record.description && (
              <div className={styles.cell_desc}>{record.description}</div>
            )}
          </div>
        );
      },
    },
    {
      key: 'type',
      title: '工序类型',
      width: 110,
      render: (_, r) => {
        const record = r as unknown as ProcessConfig;
        const variant = PROCESS_TYPE_TAG_VARIANT[record.type] ?? 'neutral';
        return <Tag variant={variant}>{record.type}</Tag>;
      },
    },
    {
      key: 'standardHours',
      title: '标准工时',
      width: 120,
      align: 'right',
      render: (_, r) => {
        const record = r as unknown as ProcessConfig;
        return (
          <span className={styles.cell_numeric}>
            {Number(record.standardHours).toFixed(2)}{' '}
            <span className={styles.cell_unit}>h/套</span>
          </span>
        );
      },
    },
    {
      key: 'unitCost',
      title: '单位成本',
      width: 120,
      align: 'right',
      render: (_, r) => {
        const record = r as unknown as ProcessConfig;
        return (
          <span className={styles.cell_numeric}>
            ¥{Number(record.unitCost).toFixed(2)}{' '}
            <span className={styles.cell_unit}>元</span>
          </span>
        );
      },
    },
    {
      key: 'workstation',
      title: '工作站',
      width: 130,
      render: (_, r) => {
        const record = r as unknown as ProcessConfig;
        return record.workstation ? (
          <span className={styles.cell_workstation}>{record.workstation}</span>
        ) : (
          <span className={styles.cell_empty}>—</span>
        );
      },
    },
    {
      key: 'sortOrder',
      title: '排序',
      width: 72,
      align: 'center',
      render: (_, r) => {
        const record = r as unknown as ProcessConfig;
        return (
          <span className={styles.cell_sort}>{record.sortOrder ?? 0}</span>
        );
      },
    },
    {
      key: 'actions',
      title: '操作',
      width: 130,
      render: (_, r) => {
        const record = r as unknown as ProcessConfig;
        return (
          <div className={styles.cell_actions}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openEdit(record)}
            >
              编辑
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openDelete(record)}
            >
              删除
            </Button>
          </div>
        );
      },
    },
  ];

  const list = (data?.list ?? []) as ProcessConfigRecord[];

  return (
    <div className={styles.page}>
      {/* 页头 */}
      <div className="page-header">
        <h1 className="page-header__title">工序配置</h1>
        <div className="page-header__actions">
          <Button variant="primary" size="md" onClick={openCreate}>
            新建工序
          </Button>
        </div>
      </div>

      {/* 筛选栏 */}
      <div className={styles.filter_bar}>
        <input
          type="search"
          className={styles.filter_search}
          placeholder="搜索工序名称 / 工作站..."
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          aria-label="搜索工序配置"
        />
        <select
          className={styles.filter_select}
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value);
            setPage(1);
          }}
          aria-label="工序类型筛选"
        >
          {PROCESS_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* T210: 工序路由流程图 — ProcessRouteFlow 组件 */}
      {/* 有工序数据时展示流程图；无数据时组件内部显示空状态，始终渲染保持区域稳定 */}
      <ProcessRouteFlow
        steps={(data?.list ?? []) as ProcessConfig[]}
        routeTitle={
          typeFilter
            ? `工序路由流程 — ${typeFilter}`
            : debouncedKeyword
            ? `工序路由流程 — 搜索：${debouncedKeyword}`
            : '工序路由流程'
        }
      />

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <Table<ProcessConfigRecord>
          columns={columns}
          dataSource={list}
          rowKey="id"
          loading={isLoading}
          emptyText="暂无工序配置，点击「新建工序」添加"
          pagination={
            data
              ? {
                  page,
                  pageSize: 20,
                  total: data.total,
                  onChange: setPage,
                }
              : undefined
          }
        />
      </div>

      {/* 新建工序 Modal */}
      <Modal
        open={createModal}
        title="新建工序配置"
        onClose={() => setCreateModal(false)}
        onConfirm={() => void handleCreate()}
        confirmLabel="创建"
        confirmLoading={createMutation.isPending}
        size="md"
      >
        <ProcessConfigForm form={form} onChange={setForm} />
      </Modal>

      {/* 编辑工序 Modal */}
      <Modal
        open={editModal.open}
        title={`编辑工序 — ${editModal.record?.name ?? ''}`}
        onClose={() => setEditModal({ open: false, record: null })}
        onConfirm={() => void handleUpdate()}
        confirmLabel="保存"
        confirmLoading={updateMutation.isPending}
        size="md"
      >
        <ProcessConfigForm form={form} onChange={setForm} />
      </Modal>

      {/* 删除确认 Modal */}
      <Modal
        open={deleteModal.open}
        title="删除工序配置"
        onClose={() => setDeleteModal({ open: false, record: null })}
        onConfirm={() => void handleDelete()}
        confirmLabel="确认删除"
        confirmVariant="danger"
        confirmLoading={deleteMutation.isPending}
        size="sm"
      >
        <div className={styles.delete_body}>
          <p className={styles.delete_text}>
            确认删除工序「<strong>{deleteModal.record?.name}</strong>」？
          </p>
          <div className="alert alert--warning" style={{ marginTop: 'var(--space-3)' }}>
            删除后该工序配置将无法恢复，请谨慎操作。
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ——— 内部子组件：工序配置表单 ———

type ProcessConfigFormProps = {
  form: ProcessConfigFormData;
  onChange: React.Dispatch<React.SetStateAction<ProcessConfigFormData>>;
};

function ProcessConfigForm({ form, onChange }: ProcessConfigFormProps) {
  const set =
    (field: keyof ProcessConfigFormData) =>
    (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >
    ) =>
      onChange((f) => ({ ...f, [field]: e.target.value }));

  return (
    <div className={styles.config_form}>
      {/* 名称 + 类型 */}
      <div className={styles.form_row}>
        <div className={styles.form_field}>
          <label className={styles.form_label}>
            工序名称 <span className={styles.required}>*</span>
          </label>
          <input
            className={styles.form_input}
            value={form.name}
            onChange={set('name')}
            placeholder="如：精裁内衬"
            maxLength={64}
          />
        </div>
        <div className={styles.form_field}>
          <label className={styles.form_label}>
            工序类型 <span className={styles.required}>*</span>
          </label>
          <input
            className={styles.form_input}
            list="process-type-list"
            value={form.type}
            onChange={set('type')}
            placeholder="如：裁剪"
            maxLength={32}
          />
          {/* datalist 提供候选项，不强制限定 */}
          <datalist id="process-type-list">
            {PROCESS_TYPE_OPTIONS.filter((o) => o.value).map((opt) => (
              <option key={opt.value} value={opt.value} />
            ))}
          </datalist>
        </div>
      </div>

      {/* 标准工时 + 单位成本 */}
      <div className={styles.form_row}>
        <div className={styles.form_field}>
          <label className={styles.form_label}>
            标准工时（小时/套）<span className={styles.required}>*</span>
          </label>
          <input
            className={styles.form_input}
            type="number"
            min="0"
            step="0.01"
            value={form.standardHours}
            onChange={set('standardHours')}
            placeholder="0.00"
          />
        </div>
        <div className={styles.form_field}>
          <label className={styles.form_label}>
            单位成本（元）<span className={styles.required}>*</span>
          </label>
          <input
            className={styles.form_input}
            type="number"
            min="0"
            step="0.01"
            value={form.unitCost}
            onChange={set('unitCost')}
            placeholder="0.00"
          />
        </div>
      </div>

      {/* 工作站 + 排序 */}
      <div className={styles.form_row}>
        <div className={styles.form_field}>
          <label className={styles.form_label}>工作站</label>
          <input
            className={styles.form_input}
            value={form.workstation}
            onChange={set('workstation')}
            placeholder="如：裁剪车间A区"
            maxLength={64}
          />
        </div>
        <div className={styles.form_field}>
          <label className={styles.form_label}>排序</label>
          <input
            className={styles.form_input}
            type="number"
            min="0"
            step="1"
            value={form.sortOrder}
            onChange={set('sortOrder')}
            placeholder="0"
          />
        </div>
      </div>

      {/* 描述（独占一行） */}
      <div className={styles.form_field}>
        <label className={styles.form_label}>工序描述</label>
        <textarea
          className={styles.form_textarea}
          value={form.description}
          onChange={set('description')}
          placeholder="可选，描述该工序的操作要点或注意事项"
          rows={3}
          maxLength={256}
        />
      </div>
    </div>
  );
}
