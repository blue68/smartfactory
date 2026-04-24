import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import Button from '@/components/common/Button';
import Table, { type Column } from '@/components/common/Table';
import Tag from '@/components/common/Tag';
import { ACTION_CODES } from '@/constants/accessControl';
import { usePermission } from '@/hooks/usePermission';
import { useAppStore } from '@/stores/appStore';
import {
  inventoryApi,
  useCreateLocation,
  useCreateWarehouse,
  useDeleteLocation,
  useDeleteWarehouse,
  useImportLocationsCsv,
  useImportWarehousesCsv,
  useLocationOptions,
  useUpdateLocation,
  useUpdateWarehouse,
  useWarehouseOptions,
} from '@/api/inventory';
import type { LocationOption, WarehouseOption } from '@/types/models';
import type {
  LocationFormValues,
  LocationType,
  MasterDataStatus,
  WarehouseFormValues,
} from './WarehouseLocationModals';
import styles from './WarehouseLocationPage.module.css';

const WarehouseLocationModals = lazy(() => import('./WarehouseLocationModals'));

type MasterDataTab = 'warehouse' | 'location';

const STATUS_LABEL: Record<MasterDataStatus, string> = {
  active: '启用',
  inactive: '停用',
  locked: '锁定',
  archived: '归档',
};

const STATUS_VARIANT: Record<MasterDataStatus, 'success' | 'warning' | 'error' | 'neutral'> = {
  active: 'success',
  inactive: 'warning',
  locked: 'error',
  archived: 'neutral',
};

const WAREHOUSE_TYPE_LABEL: Record<string, string> = {
  physical: '实体仓',
  raw_material: '原料仓',
  finished: '成品仓',
  virtual: '虚拟仓',
  transit: '在途仓',
};

const LOCATION_TYPE_LABEL: Record<LocationType, string> = {
  general: '通用库位',
  zone: '库区',
  rack: '货架',
  shelf: '货架层',
  bin: '货架格',
};

const PAGE_SIZE = 10;

function getErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function formatRackCoordinate(item: LocationOption): string {
  const tokens = [
    item.aisleCode ? `巷道:${item.aisleCode}` : null,
    item.rackCode ? `架:${item.rackCode}` : null,
    item.shelfCode ? `层:${item.shelfCode}` : null,
    item.binCode ? `格:${item.binCode}` : null,
  ].filter(Boolean);
  return tokens.length > 0 ? tokens.join(' / ') : '-';
}

function slicePage<T>(items: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

export default function WarehouseLocationPage() {
  const setPageTitle = useAppStore((state) => state.setPageTitle);
  const showToast = useAppStore((state) => state.showToast);
  const { can } = usePermission();

  const [activeTab, setActiveTab] = useState<MasterDataTab>('warehouse');
  const [onlyActive, setOnlyActive] = useState(true);
  const [locationWarehouseId, setLocationWarehouseId] = useState<number | undefined>(undefined);
  const [warehouseModalOpen, setWarehouseModalOpen] = useState(false);
  const [locationModalOpen, setLocationModalOpen] = useState(false);
  const [editingWarehouse, setEditingWarehouse] = useState<WarehouseOption | null>(null);
  const [editingLocation, setEditingLocation] = useState<LocationOption | null>(null);
  const [warehouseUploadFile, setWarehouseUploadFile] = useState<File | null>(null);
  const [locationUploadFile, setLocationUploadFile] = useState<File | null>(null);
  const [selectedLocationRowKeys, setSelectedLocationRowKeys] = useState<number[]>([]);
  const [isBarcodePrinting, setIsBarcodePrinting] = useState(false);
  const [warehousePage, setWarehousePage] = useState(1);
  const [locationPage, setLocationPage] = useState(1);
  const printWindowRef = useRef<Window | null>(null);

  const { data: warehouseOptions = [] } = useWarehouseOptions(onlyActive);
  const { data: allWarehouseOptions = [] } = useWarehouseOptions(false);
  const { data: locationOptions = [] } = useLocationOptions(locationWarehouseId, onlyActive);

  const importWarehouses = useImportWarehousesCsv();
  const importLocations = useImportLocationsCsv();
  const createWarehouse = useCreateWarehouse();
  const updateWarehouse = useUpdateWarehouse();
  const deleteWarehouse = useDeleteWarehouse();
  const createLocation = useCreateLocation();
  const updateLocation = useUpdateLocation();
  const deleteLocation = useDeleteLocation();

  const canManage = useMemo(() => can(ACTION_CODES.WAREHOUSE_LOCATION_MANAGE), [can]);
  const canImport = useMemo(() => can(ACTION_CODES.WAREHOUSE_LOCATION_IMPORT), [can]);

  const isBusy = importWarehouses.isPending
    || importLocations.isPending
    || createWarehouse.isPending
    || updateWarehouse.isPending
    || deleteWarehouse.isPending
    || createLocation.isPending
    || updateLocation.isPending
    || deleteLocation.isPending;

  useEffect(() => {
    setPageTitle('仓库库位配置');
  }, [setPageTitle]);

  useEffect(() => {
    if (activeTab !== 'location') {
      setSelectedLocationRowKeys([]);
    }
  }, [activeTab]);

  useEffect(() => {
    setWarehousePage(1);
  }, [warehouseOptions.length, onlyActive]);

  useEffect(() => {
    setLocationPage(1);
  }, [locationOptions.length, onlyActive, locationWarehouseId]);

  const locationWarehouseCodeMap = useMemo(
    () => new Map(allWarehouseOptions.map((item) => [item.id, item.code])),
    [allWarehouseOptions],
  );

  const selectedLocations = useMemo(() => {
    if (selectedLocationRowKeys.length === 0) return [];
    const keySet = new Set(selectedLocationRowKeys);
    return locationOptions.filter((item) => keySet.has(item.id));
  }, [locationOptions, selectedLocationRowKeys]);

  const visibleWarehouses = useMemo(
    () => slicePage(warehouseOptions, warehousePage, PAGE_SIZE),
    [warehouseOptions, warehousePage],
  );

  const visibleLocations = useMemo(
    () => slicePage(locationOptions, locationPage, PAGE_SIZE),
    [locationOptions, locationPage],
  );

  const notify = (type: 'success' | 'warning' | 'error' | 'info', message: string) => {
    showToast({ type, message });
  };

  const openCreateWarehouse = () => {
    setEditingWarehouse(null);
    setWarehouseModalOpen(true);
  };

  const openEditWarehouse = (item: WarehouseOption) => {
    setEditingWarehouse(item);
    setWarehouseModalOpen(true);
  };

  const openCreateLocation = () => {
    setEditingLocation(null);
    setLocationModalOpen(true);
  };

  const openEditLocation = (item: LocationOption) => {
    setEditingLocation(item);
    setLocationModalOpen(true);
  };

  const handleWarehouseSubmit = async (values: WarehouseFormValues) => {
    if (!canManage) {
      notify('error', '当前账号无编辑权限');
      return;
    }
    try {
      const payload = {
        code: values.code.trim().toUpperCase(),
        name: values.name.trim(),
        type: values.type?.trim() || undefined,
        status: values.status,
        plantCode: values.plantCode?.trim() || undefined,
      };
      if (editingWarehouse) {
        await updateWarehouse.mutateAsync({ id: editingWarehouse.id, payload });
        notify('success', '仓库更新成功');
      } else {
        await createWarehouse.mutateAsync(payload);
        notify('success', '仓库新增成功');
      }
      setWarehouseModalOpen(false);
      setEditingWarehouse(null);
    } catch (err) {
      notify('error', getErrorMessage(err, '保存仓库失败'));
    }
  };

  const handleLocationSubmit = async (values: LocationFormValues) => {
    if (!canManage) {
      notify('error', '当前账号无编辑权限');
      return;
    }
    try {
      const payload = {
        warehouseId: Number(values.warehouseId),
        code: values.code.trim().toUpperCase(),
        name: values.name.trim(),
        locationType: values.locationType,
        aisleCode: values.aisleCode?.trim().toUpperCase() || undefined,
        rackCode: values.rackCode?.trim().toUpperCase() || undefined,
        shelfCode: values.shelfCode?.trim().toUpperCase() || undefined,
        binCode: values.binCode?.trim().toUpperCase() || undefined,
        level: Number(values.level || 1),
        status: values.status,
      };
      if (editingLocation) {
        await updateLocation.mutateAsync({ id: editingLocation.id, payload });
        notify('success', '库位更新成功');
      } else {
        await createLocation.mutateAsync(payload);
        notify('success', '库位新增成功');
      }
      setLocationModalOpen(false);
      setEditingLocation(null);
    } catch (err) {
      notify('error', getErrorMessage(err, '保存库位失败'));
    }
  };

  const handleDeleteWarehouse = async (item: WarehouseOption) => {
    if (!canManage) {
      notify('error', '当前账号无编辑权限');
      return;
    }
    if (!window.confirm(`确认删除仓库 ${item.code} 吗？删除前会校验引用关系。`)) return;
    try {
      await deleteWarehouse.mutateAsync(item.id);
      notify('success', `仓库 ${item.code} 已删除`);
    } catch (err) {
      notify('error', getErrorMessage(err, '删除仓库失败'));
    }
  };

  const handleDeleteLocation = async (item: LocationOption) => {
    if (!canManage) {
      notify('error', '当前账号无编辑权限');
      return;
    }
    if (!window.confirm(`确认删除库位 ${item.code} 吗？删除前会校验引用关系。`)) return;
    try {
      await deleteLocation.mutateAsync(item.id);
      notify('success', `库位 ${item.code} 已删除`);
    } catch (err) {
      notify('error', getErrorMessage(err, '删除库位失败'));
    }
  };

  const handleImport = async () => {
    const file = activeTab === 'warehouse' ? warehouseUploadFile : locationUploadFile;
    if (!file) {
      notify('warning', '请先选择 CSV 文件');
      return;
    }
    if (!canImport) {
      notify('error', '导入权限仅限老板/主管');
      return;
    }
    try {
      const result = activeTab === 'warehouse'
        ? await importWarehouses.mutateAsync(file)
        : await importLocations.mutateAsync(file);
      notify('success', `导入完成：成功 ${result.successCount} 条，失败 ${result.failCount} 条`);
      if (activeTab === 'warehouse') {
        setWarehouseUploadFile(null);
      } else {
        setLocationUploadFile(null);
      }
    } catch (err) {
      notify('error', getErrorMessage(err, '导入失败'));
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      if (activeTab === 'warehouse') {
        await inventoryApi.downloadWarehouseImportTemplateCsv();
      } else {
        await inventoryApi.downloadLocationImportTemplateCsv();
      }
      notify('success', '模板下载完成');
    } catch (err) {
      notify('error', getErrorMessage(err, '模板下载失败'));
    }
  };

  const handlePrintLocationBarcodes = async (items: LocationOption[]) => {
    if (isBarcodePrinting) {
      notify('info', '条码正在生成，请稍候');
      return;
    }
    if (items.length === 0) {
      notify('warning', '请先选择需要打印条码的库位');
      return;
    }

    setIsBarcodePrinting(true);
    try {
      const { openLocationBarcodePrintWindow } = await import('./warehouseLocationPrint');
      printWindowRef.current = openLocationBarcodePrintWindow({
        items,
        locationWarehouseCodeMap,
        existingWindow: printWindowRef.current,
      });
      notify('success', `已打开 ${items.length} 条库位条码打印页，请在页面中点击“立即打印”`);
    } catch (err) {
      notify('error', getErrorMessage(err, '生成库位条码失败'));
    } finally {
      setIsBarcodePrinting(false);
    }
  };

  const warehouseColumns: Column<WarehouseOption>[] = [
    { key: 'code', title: '编码', width: 160 },
    { key: 'name', title: '名称', width: 220 },
    {
      key: 'type',
      title: '类型',
      width: 160,
      render: (value) => (value ? (WAREHOUSE_TYPE_LABEL[String(value)] ?? String(value)) : '-'),
    },
    { key: 'plantCode', title: '厂区编码', width: 160, render: (value) => value || '-' },
    {
      key: 'status',
      title: '状态',
      width: 130,
      render: (value) => {
        const status = (String(value || 'active') as MasterDataStatus);
        return <Tag variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status] ?? String(value)}</Tag>;
      },
    },
    {
      key: 'action',
      title: '操作',
      width: 210,
      render: (_value, record) => (
        <div className={styles.rowActions}>
          <Button size="sm" variant="secondary" onClick={() => openEditWarehouse(record)} disabled={!canManage}>
            编辑
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => void handleDeleteWarehouse(record)}
            disabled={!canManage || record.code === 'DEFAULT'}
          >
            删除
          </Button>
        </div>
      ),
    },
  ];

  const locationColumns: Column<LocationOption>[] = [
    {
      key: 'select',
      title: '选择',
      width: 84,
      render: (_value, record) => (
        <label className={styles.checkboxCell}>
          <input
            type="checkbox"
            checked={selectedLocationRowKeys.includes(record.id)}
            onChange={(e) => {
              setSelectedLocationRowKeys((prev) => {
                if (e.target.checked) return [...prev, record.id];
                return prev.filter((id) => id !== record.id);
              });
            }}
          />
          <span>勾选</span>
        </label>
      ),
    },
    {
      key: 'warehouse',
      title: '仓库',
      width: 180,
      render: (_value, record) => locationWarehouseCodeMap.get(record.warehouseId) ?? `#${record.warehouseId}`,
    },
    { key: 'code', title: '库位编码', width: 170 },
    { key: 'name', title: '库位名称', width: 220 },
    {
      key: 'locationType',
      title: '库位类型',
      width: 130,
      render: (value) => LOCATION_TYPE_LABEL[String(value) as LocationType] ?? String(value),
    },
    {
      key: 'rackCoordinate',
      title: '货架坐标',
      width: 260,
      render: (_value, record) => formatRackCoordinate(record),
    },
    { key: 'level', title: '层级', width: 100, align: 'center' },
    {
      key: 'status',
      title: '状态',
      width: 130,
      render: (value) => {
        const status = (String(value || 'active') as MasterDataStatus);
        return <Tag variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status] ?? String(value)}</Tag>;
      },
    },
    {
      key: 'action',
      title: '操作',
      width: 260,
      render: (_value, record) => (
        <div className={styles.rowActions}>
          <Button size="sm" variant="secondary" disabled={isBarcodePrinting} onClick={() => void handlePrintLocationBarcodes([record])}>
            打印条码
          </Button>
          <Button size="sm" variant="secondary" onClick={() => openEditLocation(record)} disabled={!canManage}>
            编辑
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => void handleDeleteLocation(record)}
            disabled={!canManage || record.code === 'DEFAULT-UNKNOWN'}
          >
            删除
          </Button>
        </div>
      ),
    },
  ];

  const currentUploadFile = activeTab === 'warehouse' ? warehouseUploadFile : locationUploadFile;

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <h1 className={styles.title}>仓库与库位配置</h1>
          <p className={styles.subtitle}>把仓库、库位和条码管理拆开处理，避免一次加载整套重组件。</p>
        </div>
      </header>

      <div className={styles.segmented} role="tablist" aria-label="仓库库位主数据切换">
        <button
          type="button"
          className={activeTab === 'warehouse' ? styles.segmentedActive : styles.segmentedButton}
          onClick={() => setActiveTab('warehouse')}
          aria-selected={activeTab === 'warehouse'}
        >
          仓库主数据
        </button>
        <button
          type="button"
          className={activeTab === 'location' ? styles.segmentedActive : styles.segmentedButton}
          onClick={() => setActiveTab('location')}
          aria-selected={activeTab === 'location'}
        >
          库位主数据
        </button>
      </div>

      <section className={styles.card}>
        <div className="alert alert--info" role="alert">
          <span className="alert__icon" aria-hidden="true">ℹ️</span>
          <div className="alert__body">
            <div className="alert__title">关系：库位（总称） &gt; 库区（zone） &gt; 货架（rack） &gt; 货架层（shelf） &gt; 货架格（bin）</div>
            <div className="alert__desc">巷道是坐标维度，不是独立层级节点。建议维护顺序：先建库区，再建货架，再建货架层/货架格。</div>
          </div>
        </div>
        <div className={styles.guideList}>
          <strong>具体规则：</strong>
          <ol>
            <li>类型=库区（zone）：坐标可留空。</li>
            <li>类型=货架（rack）：巷道编码、货架编码必填。</li>
            <li>类型=货架层（shelf）：巷道编码、货架编码、货架层编码必填。</li>
            <li>类型=货架格（bin）：巷道编码、货架编码、货架层编码、货架格编码全部必填。</li>
            <li>编码建议统一大写，例如 A / 01 / 02 / 03；可拼为库位编码 A-01-02-03。</li>
          </ol>
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.toolbar}>
          <div className={styles.toggleGroup}>
            <button
              type="button"
              className={onlyActive ? styles.toggleActive : styles.toggleButton}
              onClick={() => setOnlyActive(true)}
            >
              仅启用
            </button>
            <button
              type="button"
              className={!onlyActive ? styles.toggleActive : styles.toggleButton}
              onClick={() => setOnlyActive(false)}
            >
              全部状态
            </button>
          </div>

          {activeTab === 'location' && (
            <div className={styles.inlineField}>
              <label htmlFor="warehouse-filter">筛选仓库</label>
              <select
                id="warehouse-filter"
                value={locationWarehouseId ?? ''}
                onChange={(e) => {
                  const value = e.target.value;
                  setLocationWarehouseId(value ? Number(value) : undefined);
                }}
              >
                <option value="">全部仓库</option>
                {allWarehouseOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.code} · {item.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className={styles.toolbarActions}>
            {activeTab === 'location' && (
              <Button
                variant="secondary"
                loading={isBarcodePrinting}
                disabled={selectedLocations.length === 0 || isBarcodePrinting}
                onClick={() => void handlePrintLocationBarcodes(selectedLocations)}
              >
                批量打印条码
              </Button>
            )}

            {activeTab === 'warehouse' ? (
              <Button onClick={openCreateWarehouse} disabled={!canManage}>
                新增仓库
              </Button>
            ) : (
              <Button onClick={openCreateLocation} disabled={!canManage}>
                新增库位
              </Button>
            )}
          </div>
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2>{activeTab === 'warehouse' ? '仓库 CSV 导入' : '库位 CSV 导入'}</h2>
            <p>只保留 CSV 模板下载和一次一份导入，避免大上传组件常驻。</p>
          </div>
        </div>

        <div className={styles.importRow}>
          <label className={styles.filePicker}>
            <span>选择 CSV</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                if (activeTab === 'warehouse') {
                  setWarehouseUploadFile(file);
                } else {
                  setLocationUploadFile(file);
                }
              }}
            />
          </label>

          <div className={styles.fileMeta}>
            {currentUploadFile ? `已选择：${currentUploadFile.name}` : '尚未选择文件'}
          </div>

          <Button variant="secondary" onClick={() => void handleDownloadTemplate()}>
            下载模板
          </Button>
          <Button loading={isBusy} onClick={() => void handleImport()} disabled={!canImport}>
            上传导入
          </Button>
        </div>

        {!canManage && (
          <div className="alert alert--info" role="alert">
            <span className="alert__icon" aria-hidden="true">ℹ️</span>
            <div className="alert__body">
              <div className="alert__title">当前账号仅可查看</div>
              <div className="alert__desc">新增、编辑、删除和导入都受权限控制。</div>
            </div>
          </div>
        )}
      </section>

      <section className={styles.card}>
        {activeTab === 'warehouse' ? (
          <Table
            rowKey="id"
            columns={warehouseColumns}
            dataSource={visibleWarehouses}
            pagination={{
              page: warehousePage,
              pageSize: PAGE_SIZE,
              total: warehouseOptions.length,
              onChange: setWarehousePage,
            }}
          />
        ) : (
          <Table
            rowKey="id"
            columns={locationColumns}
            dataSource={visibleLocations}
            pagination={{
              page: locationPage,
              pageSize: PAGE_SIZE,
              total: locationOptions.length,
              onChange: setLocationPage,
            }}
          />
        )}
      </section>

      {(warehouseModalOpen || locationModalOpen) && (
        <Suspense fallback={null}>
          <WarehouseLocationModals
            warehouseModalOpen={warehouseModalOpen}
            locationModalOpen={locationModalOpen}
            editingWarehouse={editingWarehouse}
            editingLocation={editingLocation}
            allWarehouseOptions={allWarehouseOptions}
            warehouseSubmitting={createWarehouse.isPending || updateWarehouse.isPending}
            locationSubmitting={createLocation.isPending || updateLocation.isPending}
            onCloseWarehouse={() => {
              setWarehouseModalOpen(false);
              setEditingWarehouse(null);
            }}
            onCloseLocation={() => {
              setLocationModalOpen(false);
              setEditingLocation(null);
            }}
            onSubmitWarehouse={handleWarehouseSubmit}
            onSubmitLocation={handleLocationSubmit}
          />
        </Suspense>
      )}
    </div>
  );
}
