import { useEffect, useMemo } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import ToastContainer from '@/components/common/ToastContainer';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { UserRole } from '@/types/enums';
import styles from './MobileOpsPage.module.css';
import MobileWorkerOps from './MobileWorkerOps';
import MobileWarehouseOps from './MobileWarehouseOps';
import MobileQualityOps from './MobileQualityOps';

type MobileRoleKey = 'worker' | 'warehouse' | 'qc';

interface MobileRoleMeta {
  key: MobileRoleKey;
  label: string;
  icon: string;
  description: string;
}

const ROLE_META: MobileRoleMeta[] = [
  { key: 'worker', label: '工人', icon: '🧰', description: '查看今日任务、领料、报工和异常上报。' },
  { key: 'warehouse', label: '仓库', icon: '📦', description: '来料入库、收货跟进和盘点处理。' },
  { key: 'qc', label: '质检', icon: '🧪', description: '来料验货、质检结论提交和放行入库。' },
];

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function inferMobileRoles(roles: UserRole[]): MobileRoleMeta[] {
  const roleSet = new Set(roles);
  const isSupervisorView = roleSet.has(UserRole.BOSS) || roleSet.has(UserRole.SUPERVISOR) || roleSet.has(UserRole.ADMIN);
  return ROLE_META.filter((role) => {
    if (isSupervisorView) return true;
    if (role.key === 'worker') return roleSet.has(UserRole.WORKER);
    if (role.key === 'warehouse') return roleSet.has(UserRole.WAREHOUSE);
    return roleSet.has(UserRole.QC);
  });
}

function resolveRoleFromPath(pathname: string): MobileRoleKey {
  if (pathname.startsWith('/m/warehouse')) return 'warehouse';
  if (pathname.startsWith('/m/qc')) return 'qc';
  return 'worker';
}

export default function MobileOpsPage() {
  const setPageTitle = useAppStore((state) => state.setPageTitle);
  const user = useAuthStore((state) => state.user);
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams<{ taskId?: string; stocktakingId?: string; inspectionId?: string }>();
  const availableRoles = useMemo(() => inferMobileRoles(user?.roles ?? []), [user?.roles]);
  const activeRole = resolveRoleFromPath(location.pathname);
  const activeRoleMeta = availableRoles.find((item) => item.key === activeRole) ?? availableRoles[0] ?? ROLE_META[0];
  const workerMode = useMemo<'list' | 'detail' | 'scan'>(() => {
    if (location.pathname === '/m/scan') return 'scan';
    return params.taskId ? 'detail' : 'list';
  }, [location.pathname, params.taskId]);
  const warehouseMode = useMemo<'list' | 'inbound' | 'stocktaking' | 'scan'>(() => {
    if (location.pathname === '/m/warehouse/scan') return 'scan';
    if (location.pathname === '/m/warehouse/inbound') return 'inbound';
    return params.stocktakingId ? 'stocktaking' : 'list';
  }, [location.pathname, params.stocktakingId]);
  const qcMode = useMemo<'list' | 'inspection'>(() => (
    params.inspectionId ? 'inspection' : 'list'
  ), [params.inspectionId]);

  useEffect(() => {
    setPageTitle('移动 H5 工作台');
  }, [setPageTitle]);

  useEffect(() => {
    if (!availableRoles.length) return;
    if (availableRoles.some((item) => item.key === activeRole)) return;
    const firstRole = availableRoles[0]?.key;
    if (!firstRole) return;
    if (firstRole === 'worker') navigate('/m', { replace: true });
    if (firstRole === 'warehouse') navigate('/m/warehouse', { replace: true });
    if (firstRole === 'qc') navigate('/m/qc', { replace: true });
  }, [activeRole, availableRoles, navigate]);

  const navigateRoleHome = (role: MobileRoleKey) => {
    if (role === 'worker') navigate('/m');
    if (role === 'warehouse') navigate('/m/warehouse');
    if (role === 'qc') navigate('/m/qc');
  };

  return (
    <div className={styles.page}>
      <div className={styles.appBar}>
        <div>
          <div className={styles.eyebrow}>Mobile H5</div>
          <h1 className={styles.title}>现场移动工作台</h1>
          <p className={styles.subtitle}>{user?.realName || user?.username || '现场成员'} · {user?.tenantName || '当前工厂'}</p>
        </div>
        <Link className={styles.desktopLink} to="/dashboard">桌面端</Link>
      </div>

      <section className={styles.heroBand}>
        <div className={styles.heroTitleRow}>
          <div>
            <h2>{activeRoleMeta.icon} {activeRoleMeta.label}工作区</h2>
            <p>{activeRoleMeta.description}</p>
          </div>
          <span className={styles.heroDate}>{getToday()}</span>
        </div>
        <div className={styles.tabChips} data-testid="mobile-role-tabs">
          {availableRoles.map((role) => (
            <button
              key={role.key}
              type="button"
              data-testid={`mobile-role-${role.key}`}
              className={`${styles.tabChip} ${activeRole === role.key ? styles.tabChipActive : ''}`}
              onClick={() => navigateRoleHome(role.key)}
            >
              {role.icon} {role.label}
            </button>
          ))}
        </div>
      </section>

      <main className={styles.content}>
        {activeRole === 'worker' && (
          <MobileWorkerOps
            mode={workerMode}
            taskId={params.taskId ? Number(params.taskId) : null}
          />
        )}
        {activeRole === 'warehouse' && (
          <MobileWarehouseOps
            mode={warehouseMode}
            stocktakingId={params.stocktakingId ? Number(params.stocktakingId) : null}
          />
        )}
        {activeRole === 'qc' && (
          <MobileQualityOps
            mode={qcMode}
            inspectionId={params.inspectionId ? Number(params.inspectionId) : null}
          />
        )}
        {!availableRoles.length && (
          <section className={styles.sectionBand}>
            <div className={styles.emptyBlock}>当前账号未配置移动端角色，请联系管理员授权工人、仓库或质检角色。</div>
          </section>
        )}
      </main>

      <ToastContainer />
    </div>
  );
}
