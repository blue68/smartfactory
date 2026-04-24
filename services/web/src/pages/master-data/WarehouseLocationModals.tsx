import { useEffect, useMemo, useState } from 'react';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import type { LocationOption, WarehouseOption } from '@/types/models';
import styles from './WarehouseLocationModals.module.css';

export type MasterDataStatus = 'active' | 'inactive' | 'locked' | 'archived';
export type LocationType = 'general' | 'zone' | 'rack' | 'shelf' | 'bin';

export interface WarehouseFormValues {
  code: string;
  name: string;
  type: string;
  status: MasterDataStatus;
  plantCode?: string;
}

export interface LocationFormValues {
  warehouseId: number;
  code: string;
  name: string;
  locationType: LocationType;
  aisleCode?: string;
  rackCode?: string;
  shelfCode?: string;
  binCode?: string;
  level: number;
  status: MasterDataStatus;
}

const STATUS_LABEL: Record<MasterDataStatus, string> = {
  active: '启用',
  inactive: '停用',
  locked: '锁定',
  archived: '归档',
};

const WAREHOUSE_TYPE_OPTIONS = [
  { value: 'physical', label: '实体仓' },
  { value: 'raw_material', label: '原料仓' },
  { value: 'finished', label: '成品仓' },
  { value: 'virtual', label: '虚拟仓' },
  { value: 'transit', label: '在途仓' },
];

const LOCATION_TYPE_OPTIONS = [
  { value: 'general', label: '通用库位' },
  { value: 'zone', label: '库区' },
  { value: 'rack', label: '货架' },
  { value: 'shelf', label: '货架层' },
  { value: 'bin', label: '货架格' },
];

const LOCATION_TYPE_GUIDE: Record<LocationType, string> = {
  general: '通用库位：不做货架细分时使用，可只维护库位编码与名称。',
  zone: '库区：建议作为区域级节点（如 A 区、B 区），通常不填货架坐标。',
  rack: '货架：建议至少填写巷道编码 + 货架编码。',
  shelf: '货架层：建议填写巷道编码 + 货架编码 + 层编码。',
  bin: '货架格：建议填写完整坐标（巷道 + 货架 + 层 + 格）。',
};

interface WarehouseFormDraft {
  code: string;
  name: string;
  type: string;
  status: MasterDataStatus;
  plantCode: string;
}

interface LocationFormDraft {
  warehouseId: string;
  code: string;
  name: string;
  locationType: LocationType;
  aisleCode: string;
  rackCode: string;
  shelfCode: string;
  binCode: string;
  level: string;
  status: MasterDataStatus;
}

type WarehouseFieldErrors = Partial<Record<keyof WarehouseFormDraft, string>>;
type LocationFieldErrors = Partial<Record<keyof LocationFormDraft, string>>;

interface WarehouseLocationModalsProps {
  warehouseModalOpen: boolean;
  locationModalOpen: boolean;
  editingWarehouse: WarehouseOption | null;
  editingLocation: LocationOption | null;
  allWarehouseOptions: WarehouseOption[];
  warehouseSubmitting: boolean;
  locationSubmitting: boolean;
  onCloseWarehouse: () => void;
  onCloseLocation: () => void;
  onSubmitWarehouse: (values: WarehouseFormValues) => Promise<void> | void;
  onSubmitLocation: (values: LocationFormValues) => Promise<void> | void;
}

function createWarehouseDraft(item: WarehouseOption | null): WarehouseFormDraft {
  return {
    code: item?.code ?? '',
    name: item?.name ?? '',
    type: item?.type ?? 'physical',
    status: (item?.status as MasterDataStatus) ?? 'active',
    plantCode: item?.plantCode ?? '',
  };
}

function createLocationDraft(item: LocationOption | null, warehouses: WarehouseOption[]): LocationFormDraft {
  return {
    warehouseId: String(item?.warehouseId ?? warehouses[0]?.id ?? ''),
    code: item?.code ?? '',
    name: item?.name ?? '',
    locationType: item?.locationType ?? 'general',
    aisleCode: item?.aisleCode ?? '',
    rackCode: item?.rackCode ?? '',
    shelfCode: item?.shelfCode ?? '',
    binCode: item?.binCode ?? '',
    level: String(item?.level ?? 1),
    status: (item?.status as MasterDataStatus) ?? 'active',
  };
}

function validateWarehouseDraft(draft: WarehouseFormDraft): WarehouseFieldErrors {
  const next: WarehouseFieldErrors = {};
  if (!draft.code.trim()) next.code = '请填写仓库编码';
  if (!draft.name.trim()) next.name = '请填写仓库名称';
  return next;
}

function validateLocationDraft(draft: LocationFormDraft): LocationFieldErrors {
  const next: LocationFieldErrors = {};
  if (!draft.warehouseId) next.warehouseId = '请选择所属仓库';
  if (!draft.code.trim()) next.code = '请填写库位编码';
  if (!draft.name.trim()) next.name = '请填写库位名称';
  const level = Number(draft.level);
  if (!draft.level.trim() || !Number.isInteger(level) || level < 1 || level > 9) {
    next.level = '层级需为 1-9 的整数';
  }

  if (draft.locationType === 'rack' || draft.locationType === 'shelf' || draft.locationType === 'bin') {
    if (!draft.aisleCode.trim()) next.aisleCode = '当前库位类型要求填写巷道编码';
    if (!draft.rackCode.trim()) next.rackCode = '当前库位类型要求填写货架编码';
  }
  if (draft.locationType === 'shelf' || draft.locationType === 'bin') {
    if (!draft.shelfCode.trim()) next.shelfCode = '当前库位类型要求填写货架层编码';
  }
  if (draft.locationType === 'bin' && !draft.binCode.trim()) {
    next.binCode = '当前库位类型要求填写货架格编码';
  }
  return next;
}

export default function WarehouseLocationModals({
  warehouseModalOpen,
  locationModalOpen,
  editingWarehouse,
  editingLocation,
  allWarehouseOptions,
  warehouseSubmitting,
  locationSubmitting,
  onCloseWarehouse,
  onCloseLocation,
  onSubmitWarehouse,
  onSubmitLocation,
}: WarehouseLocationModalsProps) {
  const [warehouseDraft, setWarehouseDraft] = useState<WarehouseFormDraft>(() => createWarehouseDraft(editingWarehouse));
  const [locationDraft, setLocationDraft] = useState<LocationFormDraft>(() => createLocationDraft(editingLocation, allWarehouseOptions));
  const [warehouseErrors, setWarehouseErrors] = useState<WarehouseFieldErrors>({});
  const [locationErrors, setLocationErrors] = useState<LocationFieldErrors>({});

  useEffect(() => {
    if (!warehouseModalOpen) return;
    setWarehouseDraft(createWarehouseDraft(editingWarehouse));
    setWarehouseErrors({});
  }, [editingWarehouse, warehouseModalOpen]);

  useEffect(() => {
    if (!locationModalOpen) return;
    setLocationDraft(createLocationDraft(editingLocation, allWarehouseOptions));
    setLocationErrors({});
  }, [allWarehouseOptions, editingLocation, locationModalOpen]);

  const currentLocationType = locationDraft.locationType;
  const locationGuide = useMemo(
    () => LOCATION_TYPE_GUIDE[currentLocationType] ?? LOCATION_TYPE_GUIDE.general,
    [currentLocationType],
  );

  const warehouseErrorList = Object.values(warehouseErrors).filter(Boolean);
  const locationErrorList = Object.values(locationErrors).filter(Boolean);

  const handleWarehouseConfirm = async () => {
    const nextErrors = validateWarehouseDraft(warehouseDraft);
    setWarehouseErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    await onSubmitWarehouse({
      code: warehouseDraft.code,
      name: warehouseDraft.name,
      type: warehouseDraft.type,
      status: warehouseDraft.status,
      plantCode: warehouseDraft.plantCode,
    });
  };

  const handleLocationConfirm = async () => {
    const nextErrors = validateLocationDraft(locationDraft);
    setLocationErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    await onSubmitLocation({
      warehouseId: Number(locationDraft.warehouseId),
      code: locationDraft.code,
      name: locationDraft.name,
      locationType: locationDraft.locationType,
      aisleCode: locationDraft.aisleCode,
      rackCode: locationDraft.rackCode,
      shelfCode: locationDraft.shelfCode,
      binCode: locationDraft.binCode,
      level: Number(locationDraft.level),
      status: locationDraft.status,
    });
  };

  return (
    <>
      <Modal
        open={warehouseModalOpen}
        title={editingWarehouse ? '编辑仓库' : '新增仓库'}
        onClose={onCloseWarehouse}
        onConfirm={() => void handleWarehouseConfirm()}
        confirmLabel={editingWarehouse ? '保存修改' : '确认新增'}
        confirmLoading={warehouseSubmitting}
        size="md"
      >
        <div className={styles.formStack}>
          {warehouseErrorList.length > 0 && (
            <div className="alert alert--error" role="alert">
              <span className="alert__icon" aria-hidden="true">❌</span>
              <div className="alert__body">
                <div className="alert__title">表单未完成</div>
                <div className="alert__desc">{warehouseErrorList[0]}</div>
              </div>
            </div>
          )}

          <label className={styles.field}>
            <span>仓库编码</span>
            <input
              value={warehouseDraft.code}
              onChange={(e) => setWarehouseDraft((prev) => ({ ...prev, code: e.target.value }))}
              placeholder="如：WH-MAIN"
            />
            {warehouseErrors.code && <em className={styles.errorText}>{warehouseErrors.code}</em>}
          </label>

          <label className={styles.field}>
            <span>仓库名称</span>
            <input
              value={warehouseDraft.name}
              onChange={(e) => setWarehouseDraft((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="如：主仓库"
            />
            {warehouseErrors.name && <em className={styles.errorText}>{warehouseErrors.name}</em>}
          </label>

          <div className={styles.grid2}>
            <label className={styles.field}>
              <span>仓库类型</span>
              <select
                value={warehouseDraft.type}
                onChange={(e) => setWarehouseDraft((prev) => ({ ...prev, type: e.target.value }))}
              >
                {WAREHOUSE_TYPE_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span>状态</span>
              <select
                value={warehouseDraft.status}
                onChange={(e) => setWarehouseDraft((prev) => ({ ...prev, status: e.target.value as MasterDataStatus }))}
              >
                {Object.entries(STATUS_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
          </div>

          <label className={styles.field}>
            <span>厂区编码</span>
            <input
              value={warehouseDraft.plantCode}
              onChange={(e) => setWarehouseDraft((prev) => ({ ...prev, plantCode: e.target.value }))}
              placeholder="可选，如：PLANT-01"
            />
          </label>
        </div>
      </Modal>

      <Modal
        open={locationModalOpen}
        title={editingLocation ? '编辑库位' : '新增库位'}
        onClose={onCloseLocation}
        onConfirm={() => void handleLocationConfirm()}
        confirmLabel={editingLocation ? '保存修改' : '确认新增'}
        confirmLoading={locationSubmitting}
        size="lg"
      >
        <div className={styles.formStack}>
          <div className="alert alert--info" role="alert">
            <span className="alert__icon" aria-hidden="true">ℹ️</span>
            <div className="alert__body">
              <div className="alert__title">库位层级建议：库区 - 货架 - 货架层 - 货架格</div>
              <div className="alert__desc">当前类型说明：{locationGuide}</div>
            </div>
          </div>

          {locationErrorList.length > 0 && (
            <div className="alert alert--error" role="alert">
              <span className="alert__icon" aria-hidden="true">❌</span>
              <div className="alert__body">
                <div className="alert__title">表单未完成</div>
                <div className="alert__desc">{locationErrorList[0]}</div>
              </div>
            </div>
          )}

          <label className={styles.field}>
            <span>所属仓库</span>
            <select
              value={locationDraft.warehouseId}
              onChange={(e) => setLocationDraft((prev) => ({ ...prev, warehouseId: e.target.value }))}
            >
              {allWarehouseOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code} · {item.name}
                </option>
              ))}
            </select>
            {locationErrors.warehouseId && <em className={styles.errorText}>{locationErrors.warehouseId}</em>}
          </label>

          <div className={styles.grid2}>
            <label className={styles.field}>
              <span>库位编码</span>
              <input
                value={locationDraft.code}
                onChange={(e) => setLocationDraft((prev) => ({ ...prev, code: e.target.value }))}
                placeholder="如：A-01"
              />
              {locationErrors.code && <em className={styles.errorText}>{locationErrors.code}</em>}
            </label>

            <label className={styles.field}>
              <span>库位名称</span>
              <input
                value={locationDraft.name}
                onChange={(e) => setLocationDraft((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="如：A区-01货架"
              />
              {locationErrors.name && <em className={styles.errorText}>{locationErrors.name}</em>}
            </label>
          </div>

          <div className={styles.grid3}>
            <label className={styles.field}>
              <span>库位类型</span>
              <select
                value={locationDraft.locationType}
                onChange={(e) => setLocationDraft((prev) => ({ ...prev, locationType: e.target.value as LocationType }))}
              >
                {LOCATION_TYPE_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
              <small className={styles.hint}>按实际粒度选择，建议与层级关系保持一致。</small>
            </label>

            <label className={styles.field}>
              <span>层级</span>
              <input
                type="number"
                min={1}
                max={9}
                value={locationDraft.level}
                onChange={(e) => setLocationDraft((prev) => ({ ...prev, level: e.target.value }))}
              />
              {locationErrors.level && <em className={styles.errorText}>{locationErrors.level}</em>}
            </label>

            <label className={styles.field}>
              <span>状态</span>
              <select
                value={locationDraft.status}
                onChange={(e) => setLocationDraft((prev) => ({ ...prev, status: e.target.value as MasterDataStatus }))}
              >
                {Object.entries(STATUS_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
          </div>

          <div className={styles.grid4}>
            <label className={styles.field}>
              <span>巷道编码</span>
              <input
                value={locationDraft.aisleCode}
                onChange={(e) => setLocationDraft((prev) => ({ ...prev, aisleCode: e.target.value }))}
                placeholder="可选，如：A"
              />
              <small className={styles.hint}>货架/层/格必填。</small>
              {locationErrors.aisleCode && <em className={styles.errorText}>{locationErrors.aisleCode}</em>}
            </label>

            <label className={styles.field}>
              <span>货架编码</span>
              <input
                value={locationDraft.rackCode}
                onChange={(e) => setLocationDraft((prev) => ({ ...prev, rackCode: e.target.value }))}
                placeholder="可选，如：01"
              />
              <small className={styles.hint}>货架/层/格必填。</small>
              {locationErrors.rackCode && <em className={styles.errorText}>{locationErrors.rackCode}</em>}
            </label>

            <label className={styles.field}>
              <span>货架层编码</span>
              <input
                value={locationDraft.shelfCode}
                onChange={(e) => setLocationDraft((prev) => ({ ...prev, shelfCode: e.target.value }))}
                placeholder="可选，如：02"
              />
              <small className={styles.hint}>货架层/货架格必填。</small>
              {locationErrors.shelfCode && <em className={styles.errorText}>{locationErrors.shelfCode}</em>}
            </label>

            <label className={styles.field}>
              <span>货架格编码</span>
              <input
                value={locationDraft.binCode}
                onChange={(e) => setLocationDraft((prev) => ({ ...prev, binCode: e.target.value }))}
                placeholder="可选，如：03"
              />
              <small className={styles.hint}>货架格必填。</small>
              {locationErrors.binCode && <em className={styles.errorText}>{locationErrors.binCode}</em>}
            </label>
          </div>
        </div>
      </Modal>
    </>
  );
}
