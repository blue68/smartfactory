import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import { authApi } from '@/api/auth';
import {
  useCreateTenant,
  useTenantFeatureFlags,
  useTenantList,
  useUpdateTenant,
  useUpdateTenantFeatureFlags,
  useUpdateTenantStatus,
} from '@/api/accessControl';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { UserRole } from '@/types/enums';
import type { TenantFeatureFlagItem, TenantMutationPayload, TenantSummary } from '@/types/accessControl';
import styles from './SystemPageShell.module.css';

const EMPTY_FORM: TenantMutationPayload = {
  code: '',
  name: '',
  status: 'active',
};

const FEATURE_CATALOG: Record<string, { label: string; description: string; category: string }> = {
  rbac_center: {
    label: '权限中心',
    description: '控制租户是否可访问系统管理、角色授权、人员角色分配等 RBAC 能力。',
    category: '权限治理',
  },
  tenant_admin: {
    label: '租户治理入口',
    description: '控制租户管理员可见的治理类菜单和平台代管入口的相关行为。',
    category: '平台治理',
  },
};

function getFeatureMeta(featureCode: string, featureName?: string | null) {
  const preset = FEATURE_CATALOG[featureCode];
  return {
    label: featureName?.trim() || preset?.label || featureCode,
    description: preset?.description || '当前功能未配置专属说明，可通过名称、备注和来源判断其治理用途。',
    category: preset?.category || '未分类',
  };
}

function normalizeSourceLabel(sourceType?: string | null) {
  if (!sourceType || sourceType === 'manual') return '人工配置';
  if (sourceType === 'system') return '系统默认';
  if (sourceType === 'package') return '套餐下发';
  if (sourceType === 'trial') return '试用发放';
  return sourceType;
}

function normalizeSourceHint(sourceType?: string | null) {
  if (!sourceType || sourceType === 'manual') return '管理员手工维护';
  if (sourceType === 'system') return '系统默认生效';
  if (sourceType === 'package') return '按套餐自动下发';
  if (sourceType === 'trial') return '试用期临时授权';
  return '按来源规则生效';
}

function isExpiringSoon(expiresAt?: string | null) {
  if (!expiresAt) return false;
  const expires = new Date(expiresAt);
  if (Number.isNaN(expires.getTime())) return false;
  const now = new Date();
  const diff = expires.getTime() - now.getTime();
  return diff >= 0 && diff <= 1000 * 60 * 60 * 24 * 30;
}

function renderStatus(status?: string) {
  const text = status === 'active'
    ? '启用'
    : status === 'suspended'
      ? '暂停'
      : status === 'cancelled'
        ? '已注销'
        : status || '-';
  const cls = status === 'active'
    ? styles.statusActive
    : status === 'cancelled'
      ? styles.statusCancelled
      : styles.statusSuspended;
  return <span className={`${styles.statusBadge} ${cls}`}>{text}</span>;
}

export default function TenantConfigPage() {
  const navigate = useNavigate();
  const setPageTitle = useAppStore((s) => s.setPageTitle);
  const showToast = useAppStore((s) => s.showToast);
  const user = useAuthStore((s) => s.user);
  const setAuth = useAuthStore((s) => s.setAuth);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState<TenantSummary | null>(null);
  const [form, setForm] = useState<TenantMutationPayload>(EMPTY_FORM);
  const [featureTenant, setFeatureTenant] = useState<TenantSummary | null>(null);
  const [featureDraft, setFeatureDraft] = useState<TenantFeatureFlagItem[]>([]);
  const [featureEnabledOnly, setFeatureEnabledOnly] = useState(false);
  const [featureManualOnly, setFeatureManualOnly] = useState(false);
  const [featureExpiringOnly, setFeatureExpiringOnly] = useState(false);
  const [switchingTenantId, setSwitchingTenantId] = useState<number | null>(null);

  const { data, isLoading, error } = useTenantList({
    page: 1,
    pageSize: 20,
    keyword: keyword.trim() || undefined,
    status: status || undefined,
  });
  const createTenantMutation = useCreateTenant();
  const updateTenantMutation = useUpdateTenant();
  const updateTenantStatusMutation = useUpdateTenantStatus();
  const updateTenantFeatureFlagsMutation = useUpdateTenantFeatureFlags();
  const { data: featureFlags, isLoading: featureLoading } = useTenantFeatureFlags(featureTenant?.id ?? null);

  useEffect(() => {
    setPageTitle('系统管理 · 租户配置');
  }, [setPageTitle]);

  const tenants = data?.list ?? [];
  const activeCount = tenants.filter((item) => item.status === 'active').length;
  const suspendedCount = tenants.filter((item) => item.status === 'suspended').length;
  const modalLoading = createTenantMutation.isPending || updateTenantMutation.isPending;
  const isPlatformSuperAdmin = user?.roles?.includes(UserRole.PLATFORM_SUPER_ADMIN) ?? false;
  const isPlatformScope = user?.scopeLevel === 'platform';
  const currentManagedTenantId = user?.contextTenantId ?? null;
  const visibleFeatureDraft = useMemo(() => {
    return featureDraft.filter((item) => {
      if (featureEnabledOnly && !(item.isEnabled === true || item.isEnabled === 1)) {
        return false;
      }
      if (featureManualOnly && (item.sourceType ?? 'manual') !== 'manual') {
        return false;
      }
      if (featureExpiringOnly && !isExpiringSoon(item.expiresAt)) {
        return false;
      }
      return true;
    });
  }, [featureDraft, featureEnabledOnly, featureManualOnly, featureExpiringOnly]);

  const modalTitle = useMemo(
    () => (editingTenant ? `编辑租户 · ${editingTenant.code}` : '新增租户'),
    [editingTenant],
  );

  const resetFilters = () => {
    setKeyword('');
    setStatus('');
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingTenant(null);
    setForm(EMPTY_FORM);
  };

  useEffect(() => {
    if (!featureTenant || !featureFlags) return;
    setFeatureDraft(featureFlags.map((item) => ({ ...item, isEnabled: item.isEnabled === true || item.isEnabled === 1 })));
  }, [featureFlags, featureTenant]);

  const openCreate = () => {
    setEditingTenant(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (tenant: TenantSummary) => {
    setEditingTenant(tenant);
    setForm({
      code: tenant.code,
      name: tenant.name,
      status: tenant.status,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      showToast({ type: 'warning', message: '请填写租户编码和租户名称' });
      return;
    }

    try {
      if (editingTenant) {
        await updateTenantMutation.mutateAsync({
          id: editingTenant.id,
          payload: { ...form, code: form.code.trim(), name: form.name.trim() },
        });
        showToast({ type: 'success', message: '租户信息已更新' });
      } else {
        await createTenantMutation.mutateAsync({
          code: form.code.trim(),
          name: form.name.trim(),
          status: form.status,
        });
        showToast({ type: 'success', message: '租户已创建' });
      }
      closeModal();
    } catch (err) {
      showToast({ type: 'error', message: (err as Error).message || '保存失败' });
    }
  };

  const handleToggleStatus = async (tenant: TenantSummary) => {
    const nextStatus = tenant.status === 'active' ? 'suspended' : 'active';
    const confirmed = window.confirm(
      `确认将租户“${tenant.name}”${nextStatus === 'active' ? '启用' : '暂停'}吗？`,
    );
    if (!confirmed) return;
    try {
      await updateTenantStatusMutation.mutateAsync({
        id: tenant.id,
        payload: { status: nextStatus },
      });
      showToast({ type: 'success', message: `租户已${nextStatus === 'active' ? '启用' : '暂停'}` });
    } catch (err) {
      showToast({ type: 'error', message: (err as Error).message || '状态更新失败' });
    }
  };

  const openFeatureModal = (tenant: TenantSummary) => {
    setFeatureTenant(tenant);
  };

  const closeFeatureModal = () => {
    setFeatureTenant(null);
    setFeatureDraft([]);
    setFeatureEnabledOnly(false);
    setFeatureManualOnly(false);
    setFeatureExpiringOnly(false);
  };

  const updateFeatureDraft = (featureCode: string, patch: Partial<TenantFeatureFlagItem>) => {
    setFeatureDraft((prev) => prev.map((item) => (
      item.featureCode === featureCode ? { ...item, ...patch } : item
    )));
  };

  const handleSaveFeatures = async () => {
    if (!featureTenant) return;
    try {
      await updateTenantFeatureFlagsMutation.mutateAsync({
        id: featureTenant.id,
        payload: {
          flags: featureDraft.map((item) => ({
            featureCode: item.featureCode,
            featureName: item.featureName ?? item.featureCode,
            isEnabled: item.isEnabled === true || item.isEnabled === 1,
            sourceType: item.sourceType ?? 'manual',
            expiresAt: item.expiresAt ?? null,
            remark: item.remark ?? null,
          })),
        },
      });
      showToast({ type: 'success', message: '租户功能开关已保存' });
      closeFeatureModal();
    } catch (err) {
      showToast({ type: 'error', message: (err as Error).message || '保存功能开关失败' });
    }
  };

  const handleSwitchTenant = async (tenant: TenantSummary) => {
    setSwitchingTenantId(tenant.id);
    try {
      const data = await authApi.switchTenant(tenant.id);
      setAuth(data.user, data.accessToken, data.permissionSnapshot ?? null);
      showToast({ type: 'success', message: `已进入租户 ${tenant.name}` });
      navigate('/system/roles');
    } catch (err) {
      showToast({ type: 'error', message: (err as Error).message || '切换租户失败' });
    } finally {
      setSwitchingTenantId(null);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>租户配置</h1>
          <p className={styles.subtitle}>支持新建、编辑与租户状态维护，作为权限中心的租户基础主数据。</p>
        </div>
        <div className={styles.actions}>
          <Button variant="primary" onClick={openCreate}>+ 新建租户</Button>
        </div>
      </div>

      <div className={styles.stats}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>租户总数</div>
          <div className={styles.statValue}>{data?.total ?? 0}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>启用中</div>
          <div className={styles.statValue}>{activeCount}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>暂停中</div>
          <div className={styles.statValue}>{suspendedCount}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>接口状态</div>
          <div className={styles.statValue}>{error ? '异常' : isLoading ? '加载中' : '正常'}</div>
        </div>
      </div>

      <div className={styles.filterBar}>
        <input
          className={styles.input}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="搜索租户名称/编码"
        />
        <select
          className={styles.select}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">全部状态</option>
          <option value="active">启用</option>
          <option value="suspended">暂停</option>
          <option value="cancelled">已注销</option>
        </select>
        <Button variant="ghost" onClick={resetFilters}>重置筛选</Button>
      </div>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>租户列表</h2>
          <span className={styles.tag}>{tenants.length}</span>
        </div>
        <div className={styles.cardBody}>
          {error && <div className={styles.hint}>租户加载失败：{(error as Error).message}</div>}
          {!error && (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>租户编码</th>
                    <th>租户名称</th>
                    <th>状态</th>
                    <th>套餐</th>
                    <th>默认管理员</th>
                    <th>到期日</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && (
                    <tr>
                      <td colSpan={7} className={styles.muted}>加载中...</td>
                    </tr>
                  )}
                  {!isLoading && tenants.length === 0 && (
                    <tr>
                      <td colSpan={7} className={styles.muted}>暂无租户数据。</td>
                    </tr>
                  )}
                  {!isLoading && tenants.map((tenant) => (
                    <tr key={tenant.id}>
                      <td>{tenant.code}</td>
                      <td>{tenant.name}</td>
                      <td>{renderStatus(tenant.status)}</td>
                      <td>{tenant.packageType ?? '-'}</td>
                      <td>{tenant.defaultAdminName ?? '-'}</td>
                      <td>{tenant.expiresAt ? String(tenant.expiresAt).slice(0, 10) : '-'}</td>
                      <td>
                        <div className={styles.tableActions}>
                          <Button variant="secondary" size="sm" onClick={() => openEdit(tenant)}>编辑</Button>
                          <Button variant="ghost" size="sm" onClick={() => openFeatureModal(tenant)}>功能开关</Button>
                          {isPlatformSuperAdmin && (
                            <Button
                              variant={isPlatformScope || currentManagedTenantId !== tenant.id ? 'primary' : 'secondary'}
                              size="sm"
                              onClick={() => void handleSwitchTenant(tenant)}
                              loading={switchingTenantId === tenant.id}
                              disabled={!isPlatformScope && currentManagedTenantId === tenant.id}
                            >
                              {!isPlatformScope && currentManagedTenantId === tenant.id ? '当前代管' : '进入租户'}
                            </Button>
                          )}
                          <Button
                            variant={tenant.status === 'active' ? 'warning' : 'success'}
                            size="sm"
                            onClick={() => void handleToggleStatus(tenant)}
                            loading={updateTenantStatusMutation.isPending}
                          >
                            {tenant.status === 'active' ? '暂停' : '启用'}
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
        title={modalTitle}
        onClose={closeModal}
        onConfirm={() => void handleSave()}
        confirmLabel={editingTenant ? '保存租户' : '创建租户'}
        confirmLoading={modalLoading}
      >
        <div className={styles.fieldGrid}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>租户编码</span>
            <input
              className={styles.input}
              value={form.code}
              onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value }))}
              placeholder="例如 TENANT-EAST-01"
            />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>租户名称</span>
            <input
              className={styles.input}
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="例如 华东家具厂"
            />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>租户状态</span>
            <select
              className={styles.select}
              value={form.status ?? 'active'}
              onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}
            >
              <option value="active">启用</option>
              <option value="suspended">暂停</option>
              <option value="cancelled">已注销</option>
            </select>
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>说明</span>
            <div className={styles.hint}>当前先维护租户编码、名称、状态。套餐、功能开关与到期策略仍按后续阶段补齐。</div>
          </div>
        </div>
      </Modal>

      <Modal
        open={featureTenant !== null}
        title={featureTenant ? `租户功能开关 · ${featureTenant.name}` : '租户功能开关'}
        onClose={closeFeatureModal}
        onConfirm={() => void handleSaveFeatures()}
        confirmLabel="保存开关"
        confirmLoading={updateTenantFeatureFlagsMutation.isPending}
        size="lg"
      >
        <div className={styles.stack}>
          <div className={styles.hint}>
            用于控制当前租户可用的治理能力。关闭后不会删除数据，但会影响页面入口和接口守卫。
            来源为 <strong>manual</strong> 表示这条开关是由管理员手工配置，而不是系统默认或套餐自动下发。
          </div>
          <div className={styles.filterBar}>
            <label className={styles.checkCard}>
              <input
                type="checkbox"
                checked={featureEnabledOnly}
                onChange={(event) => setFeatureEnabledOnly(event.target.checked)}
              />
              <div className={styles.checkBody}>
                <span className={styles.checkTitle}>只看已启用</span>
                <span className={styles.checkMeta}>聚焦当前已生效的租户能力</span>
              </div>
            </label>
            <label className={styles.checkCard}>
              <input
                type="checkbox"
                checked={featureManualOnly}
                onChange={(event) => setFeatureManualOnly(event.target.checked)}
              />
              <div className={styles.checkBody}>
                <span className={styles.checkTitle}>只看人工配置</span>
                <span className={styles.checkMeta}>筛出来源为 manual 的人工覆盖项</span>
              </div>
            </label>
            <label className={styles.checkCard}>
              <input
                type="checkbox"
                checked={featureExpiringOnly}
                onChange={(event) => setFeatureExpiringOnly(event.target.checked)}
              />
              <div className={styles.checkBody}>
                <span className={styles.checkTitle}>只看 30 天内到期</span>
                <span className={styles.checkMeta}>提前识别试用或临时授权即将过期的能力</span>
              </div>
            </label>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>功能编码</th>
                  <th>功能说明</th>
                  <th>启用</th>
                  <th>来源</th>
                  <th>到期日</th>
                  <th>备注</th>
                </tr>
              </thead>
              <tbody>
                {featureLoading && (
                  <tr>
                    <td colSpan={6} className={styles.muted}>加载中...</td>
                  </tr>
                )}
                {!featureLoading && visibleFeatureDraft.length === 0 && (
                  <tr>
                    <td colSpan={6} className={styles.muted}>当前筛选条件下没有功能开关。</td>
                  </tr>
                )}
                {!featureLoading && visibleFeatureDraft.map((item) => {
                  const meta = getFeatureMeta(item.featureCode, item.featureName);
                  const sourceLabel = normalizeSourceLabel(item.sourceType);
                  const sourceHint = normalizeSourceHint(item.sourceType);
                  return (
                  <tr key={item.featureCode}>
                    <td>
                      <div className={styles.checkBody}>
                        <span className={styles.checkTitle}>{item.featureCode}</span>
                        <span className={styles.checkMeta}>{meta.category}</span>
                      </div>
                    </td>
                    <td>
                      <div className={styles.checkBody}>
                        <input
                          className={styles.input}
                          value={item.featureName ?? meta.label}
                          onChange={(event) => updateFeatureDraft(item.featureCode, { featureName: event.target.value })}
                        />
                        <span className={styles.checkMeta}>{meta.description}</span>
                      </div>
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={item.isEnabled === true || item.isEnabled === 1}
                        onChange={(event) => updateFeatureDraft(item.featureCode, { isEnabled: event.target.checked })}
                      />
                    </td>
                    <td>
                      <div className={styles.sourceCell}>
                        <span className={styles.tag}>{sourceLabel}</span>
                        <span className={styles.sourceHint}>{sourceHint}</span>
                      </div>
                    </td>
                    <td>
                      <div className={styles.checkBody}>
                        <input
                          className={styles.input}
                          type="date"
                          value={item.expiresAt ? String(item.expiresAt).slice(0, 10) : ''}
                          onChange={(event) => updateFeatureDraft(item.featureCode, { expiresAt: event.target.value || null })}
                        />
                        <span className={styles.checkMeta}>
                          {item.expiresAt
                            ? isExpiringSoon(item.expiresAt)
                              ? '30 天内到期'
                              : '已设置到期时间'
                            : '长期有效'}
                        </span>
                      </div>
                    </td>
                    <td>
                      <input
                        className={styles.input}
                        value={item.remark ?? ''}
                        onChange={(event) => updateFeatureDraft(item.featureCode, { remark: event.target.value })}
                      />
                    </td>
                  </tr>
                );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>
    </div>
  );
}
