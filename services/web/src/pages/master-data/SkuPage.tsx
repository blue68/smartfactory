/**
 * [artifact:前端代码] — SKU 主数据页（完整重写）
 * 按设计稿 100% 视觉还原
 */

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { useAppStore } from '@/stores/appStore';
import {
  skuApi,
  useSkuList,
  useSkuDetail,
  useSkuStats,
  useCreateSku,
  useUpdateSku,
  useBatchUpdateStatus,
  useBatchSetSafetyStock,
} from '@/api/sku';
import { useSkuCategoryList } from '@/api/skuCategory';
import { useCustomerOptions } from '@/api/customer';
import {
  SkuStatus,
  Category1Code,
  Category1Label,
  Category2Code,
  Category2Label,
} from '@/types/enums';
import type {
  AssetProfile,
  AssetTrackingMode,
  BusinessClass,
  ConsumableProfile,
  ControlMode,
  CustomerSkuRef,
  DefaultWarehouseType,
  Sku,
  SkuBrandScope,
  SkuCategory,
  SkuCategoryFull,
  SkuListQuery,
} from '@/types/models';
import type { Column } from '@/components/common/Table';
import Table from '@/components/common/Table';
import Drawer from '@/components/common/Drawer';
import Tag from '@/components/common/Tag';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import { exportObjectsToCSV } from '@/utils/exportExcel';
import { formatAssetCategoryLabel, formatDepreciationMethodLabel } from '@/utils/assetDisplay';
import styles from './SkuPage.module.css';

// ──────────────────────────────────────────────
// 辅助类型
// ──────────────────────────────────────────────
type SkuRecord = Sku & Record<string, unknown>;

// ──────────────────────────────────────────────
// 常量
// ──────────────────────────────────────────────
const UNIT_OPTIONS = ['张', '件', '卷', '米', 'kg', 'g', '个', 'mm²', '片', '套', '组', '块', '条'] as const;

const CATEGORY1_TAG_STYLE: Partial<Record<Category1Code, string>> = {
  [Category1Code.RAW_MATERIAL]: styles['cat1_tag--raw'],
  [Category1Code.SEMI_PRODUCT]: styles['cat1_tag--semi'],
  [Category1Code.FINISHED]:     styles['cat1_tag--done'],
  [Category1Code.PACKING]:      styles['cat1_tag--raw'],
  [Category1Code.ASSET]:        styles['cat1_tag--asset'],
};

// ──────────────────────────────────────────────
// 表单数据类型
// ──────────────────────────────────────────────
interface SkuFormData {
  name: string;
  category1Code: Category1Code | '';
  category2Id: number | '';
  spec: string;
  purchaseUnit: string;
  stockUnit: string;
  stockConvFactor: string;
  productionUnit: string;
  productionConvFactor: string;
  prodConvNote: string;
  safetyStock: string;
  hasDyeLot: boolean;
  useFifo: boolean;
  businessClass: BusinessClass;
  controlMode: ControlMode;
  allowBomComponent: boolean;
  allowPurchase: boolean;
  allowInventory: boolean;
  allowProductionIssue: boolean;
  requiresAssetAcceptance: boolean;
  defaultWarehouseType: DefaultWarehouseType | '';
  approvalPolicyCode: string;
  assetTrackingMode: AssetTrackingMode | '';
  consumableProfile: EditableConsumableProfile;
  assetProfile: EditableAssetProfile;
  brandScope: SkuBrandScope;
  brandCustomerId: number | '';
  customerRefs: EditableCustomerSkuRef[];
  description: string;
  status: 'active' | 'inactive';
}

interface EditableCustomerSkuRef {
  customerId: number | '';
  customerSkuCode: string;
  customerSkuName: string;
  status: 'active' | 'inactive';
}

interface EditableConsumableProfile {
  issueMode: NonNullable<ConsumableProfile['issueMode']>;
  approvalLevel: NonNullable<ConsumableProfile['approvalLevel']>;
  expenseSubject: string;
  minStock: string;
  maxStock: string;
  purchaseLeadDays: string;
  issueDeptRequired: boolean;
  notes: string;
}

interface EditableAssetProfile {
  assetCategory: string;
  depreciationMethod: NonNullable<AssetProfile['depreciationMethod']>;
  usefulLifeMonths: string;
  residualRate: string;
  capexSubject: string;
  requiresSerialNo: boolean;
  maintenanceCycleDays: string;
  warrantyMonths: string;
  notes: string;
}

const DEFAULT_CONSUMABLE_PROFILE: EditableConsumableProfile = {
  issueMode: 'department_issue',
  approvalLevel: 'normal',
  expenseSubject: '',
  minStock: '',
  maxStock: '',
  purchaseLeadDays: '',
  issueDeptRequired: true,
  notes: '',
};

const DEFAULT_ASSET_PROFILE: EditableAssetProfile = {
  assetCategory: '',
  depreciationMethod: 'straight_line',
  usefulLifeMonths: '',
  residualRate: '',
  capexSubject: '',
  requiresSerialNo: true,
  maintenanceCycleDays: '',
  warrantyMonths: '',
  notes: '',
};

function getBusinessClassPreset(businessClass: BusinessClass): Pick<
  SkuFormData,
  | 'businessClass'
  | 'controlMode'
  | 'allowBomComponent'
  | 'allowPurchase'
  | 'allowInventory'
  | 'allowProductionIssue'
  | 'requiresAssetAcceptance'
  | 'defaultWarehouseType'
  | 'approvalPolicyCode'
  | 'assetTrackingMode'
> {
  switch (businessClass) {
    case 'finished_goods':
      return {
        businessClass,
        controlMode: 'stock_only',
        allowBomComponent: false,
        allowPurchase: true,
        allowInventory: true,
        allowProductionIssue: false,
        requiresAssetAcceptance: false,
        defaultWarehouseType: 'finished',
        approvalPolicyCode: '',
        assetTrackingMode: 'none',
      };
    case 'consumable':
      return {
        businessClass,
        controlMode: 'stock_only',
        allowBomComponent: false,
        allowPurchase: true,
        allowInventory: true,
        allowProductionIssue: false,
        requiresAssetAcceptance: false,
        defaultWarehouseType: 'consumable',
        approvalPolicyCode: 'CONS-NORMAL',
        assetTrackingMode: 'none',
      };
    case 'fixed_asset':
      return {
        businessClass,
        controlMode: 'asset',
        allowBomComponent: false,
        allowPurchase: true,
        allowInventory: false,
        allowProductionIssue: false,
        requiresAssetAcceptance: true,
        defaultWarehouseType: 'asset_pending',
        approvalPolicyCode: 'ASSET-STRICT',
        assetTrackingMode: 'serial',
      };
    default:
      return {
        businessClass: 'production_material',
        controlMode: 'mrp',
        allowBomComponent: true,
        allowPurchase: true,
        allowInventory: true,
        allowProductionIssue: true,
        requiresAssetAcceptance: false,
        defaultWarehouseType: 'raw_material',
        approvalPolicyCode: '',
        assetTrackingMode: 'none',
      };
  }
}

function createEmptyForm(businessClass: BusinessClass = 'production_material'): SkuFormData {
  return {
    name: '',
    category1Code: '',
    category2Id: '',
    spec: '',
    purchaseUnit: '',
    stockUnit: '',
    stockConvFactor: '1',
    productionUnit: '',
    productionConvFactor: '',
    prodConvNote: '',
    safetyStock: '',
    hasDyeLot: false,
    useFifo: true,
    ...getBusinessClassPreset(businessClass),
    consumableProfile: { ...DEFAULT_CONSUMABLE_PROFILE },
    assetProfile: { ...DEFAULT_ASSET_PROFILE },
    brandScope: 'factory',
    brandCustomerId: '',
    customerRefs: [],
    description: '',
    status: 'active',
  };
}

const EMPTY_FORM: SkuFormData = createEmptyForm();

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────
function getCat1CodeFromId(catData: SkuCategory[], cat1Id: number): Category1Code | undefined {
  const found = catData.find((c) => c.level === 1 && Number(c.id) === Number(cat1Id));
  return found?.code as Category1Code | undefined;
}

function getCat2ByParentCode(catData: SkuCategory[], cat1Code: Category1Code): SkuCategory[] {
  const parent = catData.find((c) => c.level === 1 && c.code === cat1Code);
  if (!parent) return [];
  return catData.filter((c) => c.level === 2 && c.parentId === parent.id);
}

function getCat1IdByCode(catData: SkuCategory[], code: Category1Code): number | undefined {
  return catData.find((c) => c.level === 1 && c.code === code)?.id;
}

function flattenCategoryTree(nodes: SkuCategoryFull[]): SkuCategory[] {
  return nodes.flatMap((node) => {
    const current: SkuCategory = {
      id: Number(node.id),
      level: node.level,
      parentId: node.parentId == null ? null : Number(node.parentId),
      code: node.code as Category1Code | Category2Code,
      name: node.name,
      sortOrder: Number(node.sortOrder ?? 0),
    };

    const children = (node.children ?? []).map((child) => ({
      id: Number(child.id),
      level: child.level,
      parentId: child.parentId == null ? null : Number(child.parentId),
      code: child.code as Category1Code | Category2Code,
      name: child.name,
      sortOrder: Number(child.sortOrder ?? 0),
    }));

    return [current, ...children];
  });
}

function toEditableCustomerRefs(refs?: CustomerSkuRef[]): EditableCustomerSkuRef[] {
  return (refs ?? []).map((ref) => ({
    customerId: Number(ref.customerId) || '',
    customerSkuCode: ref.customerSkuCode ?? '',
    customerSkuName: ref.customerSkuName ?? '',
    status: ref.status ?? 'active',
  }));
}

function isFinishedCategory(code: Category1Code | '' | undefined): boolean {
  return code === Category1Code.FINISHED;
}

function getRecommendedBusinessClassByCategory1(code: Category1Code | '' | undefined): BusinessClass {
  if (code === Category1Code.PACKING) return 'consumable';
  if (code === Category1Code.FINISHED) return 'finished_goods';
  if (code === Category1Code.ASSET) return 'fixed_asset';
  return 'production_material';
}

function isFinishedSkuRecord(sku: Sku): boolean {
  if (sku.category1Code) {
    return sku.category1Code === Category1Code.FINISHED;
  }
  return sku.category1Name === Category1Label[Category1Code.FINISHED];
}

function getBusinessClassLabel(value?: Sku['businessClass']): string {
  switch (value) {
    case 'finished_goods':
      return '成品商品';
    case 'consumable':
      return '损耗品';
    case 'fixed_asset':
      return '固定资产';
    case 'production_material':
      return '生产物料';
    default:
      return '未配置';
  }
}

function getBusinessClassTagVariant(value?: Sku['businessClass']): 'success' | 'warning' | 'info' | 'neutral' {
  switch (value) {
    case 'finished_goods':
      return 'success';
    case 'consumable':
      return 'warning';
    case 'fixed_asset':
      return 'info';
    default:
      return 'neutral';
  }
}

function getControlModeLabel(value?: Sku['controlMode']): string {
  switch (value) {
    case 'mrp':
      return 'MRP';
    case 'stock_only':
      return '仅库存';
    case 'direct_expense':
      return '直耗';
    case 'asset':
      return '资产';
    default:
      return '未配置';
  }
}

function getDefaultWarehouseTypeLabel(value?: Sku['defaultWarehouseType']): string {
  switch (value) {
    case 'raw_material':
      return '原料仓';
    case 'consumable':
      return '损耗品仓';
    case 'asset_pending':
      return '资产待验收仓';
    case 'asset':
      return '资产仓';
    case 'finished':
      return '成品仓';
    default:
      return '未配置';
  }
}

function getAssetTrackingModeLabel(value?: Sku['assetTrackingMode'] | ''): string {
  switch (value) {
    case 'batch':
      return '批次';
    case 'serial':
      return '序列号';
    case 'none':
      return '不跟踪';
    default:
      return '未配置';
  }
}

function toBooleanFlag(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

function toEditableConsumableProfile(profile?: ConsumableProfile | null): EditableConsumableProfile {
  return {
    issueMode: profile?.issueMode ?? 'department_issue',
    approvalLevel: profile?.approvalLevel ?? 'normal',
    expenseSubject: profile?.expenseSubject ?? '',
    minStock: profile?.minStock ?? '',
    maxStock: profile?.maxStock ?? '',
    purchaseLeadDays: profile?.purchaseLeadDays != null ? String(profile.purchaseLeadDays) : '',
    issueDeptRequired: profile?.issueDeptRequired ?? true,
    notes: profile?.notes ?? '',
  };
}

function toEditableAssetProfile(profile?: AssetProfile | null): EditableAssetProfile {
  return {
    assetCategory: profile?.assetCategory ?? '',
    depreciationMethod: profile?.depreciationMethod ?? 'straight_line',
    usefulLifeMonths: profile?.usefulLifeMonths != null ? String(profile.usefulLifeMonths) : '',
    residualRate: profile?.residualRate ?? '',
    capexSubject: profile?.capexSubject ?? '',
    requiresSerialNo: profile?.requiresSerialNo ?? true,
    maintenanceCycleDays: profile?.maintenanceCycleDays != null ? String(profile.maintenanceCycleDays) : '',
    warrantyMonths: profile?.warrantyMonths != null ? String(profile.warrantyMonths) : '',
    notes: profile?.notes ?? '',
  };
}

function applyBusinessClassPreset(form: SkuFormData, businessClass: BusinessClass): SkuFormData {
  const preset = getBusinessClassPreset(businessClass);
  return {
    ...form,
    ...preset,
    consumableProfile: businessClass === 'consumable'
      ? {
          ...DEFAULT_CONSUMABLE_PROFILE,
          ...form.consumableProfile,
          expenseSubject: form.consumableProfile.expenseSubject || DEFAULT_CONSUMABLE_PROFILE.expenseSubject,
        }
      : { ...DEFAULT_CONSUMABLE_PROFILE, ...form.consumableProfile },
    assetProfile: businessClass === 'fixed_asset'
      ? {
          ...DEFAULT_ASSET_PROFILE,
          ...form.assetProfile,
          assetCategory: form.assetProfile.assetCategory || DEFAULT_ASSET_PROFILE.assetCategory,
        }
      : { ...DEFAULT_ASSET_PROFILE, ...form.assetProfile },
  };
}

function buildSkuFormData(sku: Sku, catData: SkuCategory[]): SkuFormData {
  const cat1Code = getCat1CodeFromId(catData, sku.category1Id) ?? '';
  const businessClass = sku.businessClass ?? getRecommendedBusinessClassByCategory1(cat1Code);
  const preset = getBusinessClassPreset(businessClass);
  return {
    ...createEmptyForm(businessClass),
    name: sku.name,
    category1Code: cat1Code,
    category2Id: sku.category2Id,
    spec: sku.spec ?? '',
    purchaseUnit: sku.purchaseUnit,
    stockUnit: sku.stockUnit,
    stockConvFactor: String(sku.stockConvFactor ?? 1),
    productionUnit: sku.productionUnit,
    productionConvFactor: sku.productionConvFactor != null ? String(sku.productionConvFactor) : '',
    prodConvNote: sku.prodConvNote ?? '',
    safetyStock: sku.safetyStock ?? '',
    hasDyeLot: sku.hasDyeLot,
    useFifo: sku.useFifo,
    businessClass,
    controlMode: sku.controlMode ?? preset.controlMode,
    allowBomComponent: sku.allowBomComponent ?? preset.allowBomComponent,
    allowPurchase: sku.allowPurchase ?? preset.allowPurchase,
    allowInventory: sku.allowInventory ?? preset.allowInventory,
    allowProductionIssue: sku.allowProductionIssue ?? preset.allowProductionIssue,
    requiresAssetAcceptance: sku.requiresAssetAcceptance ?? preset.requiresAssetAcceptance,
    defaultWarehouseType: sku.defaultWarehouseType ?? preset.defaultWarehouseType,
    approvalPolicyCode: sku.approvalPolicyCode ?? preset.approvalPolicyCode,
    assetTrackingMode: sku.assetTrackingMode ?? preset.assetTrackingMode,
    consumableProfile: toEditableConsumableProfile(sku.consumableProfile),
    assetProfile: toEditableAssetProfile(sku.assetProfile),
    brandScope: sku.brandScope ?? 'factory',
    brandCustomerId: sku.brandCustomerId ?? '',
    customerRefs: toEditableCustomerRefs(sku.customerRefs),
    description: sku.description ?? '',
    status: sku.status === SkuStatus.INACTIVE ? 'inactive' : 'active',
  };
}

// ──────────────────────────────────────────────
// 主页面
// ──────────────────────────────────────────────
export default function SkuPage() {
  const { setPageTitle, showToast } = useAppStore();

  // 列表查询参数
  const [query, setQuery] = useState<SkuListQuery>({ page: 1, pageSize: 20 });
  const [keyword, setKeyword] = useState('');

  // UI 状态
  const [warnDismissed, setWarnDismissed] = useState(false);
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit' | 'detail' | null>(null);
  const [editingSku, setEditingSku] = useState<Sku | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showBatchSafety, setShowBatchSafety] = useState(false);
  const [batchSafetyVal, setBatchSafetyVal] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [skuForm, setSkuForm] = useState<SkuFormData>(EMPTY_FORM);

  useEffect(() => { setPageTitle('SKU 主数据'); }, [setPageTitle]);

  // 防抖搜索
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery((q) => ({ ...q, keyword: keyword || undefined, page: 1 }));
    }, 350);
    return () => clearTimeout(t);
  }, [keyword]);

  // 数据
  const { data: rawCatTree = [] } = useSkuCategoryList({ editableView: true });
  const catData: SkuCategory[] = useMemo(() => flattenCategoryTree(rawCatTree), [rawCatTree]);
  const { data: customerOptions = [] } = useCustomerOptions();
  const { data: statsData } = useSkuStats();
  const { data, isLoading, error } = useSkuList(query);
  const activeSkuId = drawerMode && editingSku ? Number(editingSku.id) : null;
  const { data: skuDetail } = useSkuDetail(
    drawerMode === 'edit' || drawerMode === 'detail'
      ? activeSkuId
      : null,
  );

  // Mutations
  const createMutation       = useCreateSku();
  const updateMutation       = useUpdateSku();
  const batchStatusMutation  = useBatchUpdateStatus();
  const batchSafetyMutation  = useBatchSetSafetyStock();

  // 分类下拉选项
  const cat1Options = useMemo(
    () => catData.filter((c) => c.level === 1),
    [catData],
  );
  const cat2Options = useMemo(
    () => catData.filter((c) => c.level === 2),
    [catData],
  );
  const filterCat2Options = useMemo(
    () => {
      if (!query.category1Id) return cat2Options;
      return cat2Options.filter((category) => Number(category.parentId) === Number(query.category1Id));
    },
    [cat2Options, query.category1Id],
  );

  // 选中 category1Code 时的二级分类列表（表单内）
  const formCat2Options = useMemo(
    () => skuForm.category1Code
      ? getCat2ByParentCode(catData, skuForm.category1Code)
      : cat2Options,
    [catData, skuForm.category1Code, cat2Options],
  );
  const customerLabelById = useMemo(
    () => new Map(customerOptions.map((customer) => [
      Number(customer.id),
      `${customer.name}（${customer.code}）`,
    ])),
    [customerOptions],
  );
  const categoryNameById = useMemo(
    () => new Map(catData.map((category) => [Number(category.id), category.name])),
    [catData],
  );

  // SKU 列表
  const skuList = useMemo(() => (data?.list ?? []) as SkuRecord[], [data]);
  const showCurrentStockColumn = useMemo(
    () => skuList.some((sku) => sku.qtyOnHand != null),
    [skuList],
  );

  // 未分类 SKU 数（二级品类 NONE）
  const noCategory2Count = useMemo(
    () => statsData?.incomplete ?? 0,
    [statsData],
  );

  // ── 全选逻辑 ──
  const isAllSelected = skuList.length > 0 && skuList.every((s) => selectedIds.includes(Number(s.id)));
  const isIndeterminate = !isAllSelected && skuList.some((s) => selectedIds.includes(Number(s.id)));

  const handleSelectAll = useCallback((checked: boolean) => {
    if (checked) {
      const ids = skuList.map((s) => Number(s.id));
      setSelectedIds((prev) => Array.from(new Set([...prev, ...ids])));
    } else {
      const ids = new Set(skuList.map((s) => Number(s.id)));
      setSelectedIds((prev) => prev.filter((id) => !ids.has(id)));
    }
  }, [skuList]);

  const handleSelectRow = useCallback((id: number, checked: boolean) => {
    setSelectedIds((prev) => checked ? [...prev, id] : prev.filter((x) => x !== id));
  }, []);

  // ── Drawer 开关 ──
  const openCreate = useCallback(() => {
    setSkuForm(createEmptyForm());
    setEditingSku(null);
    setDrawerMode('create');
  }, []);

  const openEdit = useCallback((sku: Sku) => {
    setSkuForm(buildSkuFormData(sku, catData));
    setEditingSku(sku);
    setDrawerMode('edit');
  }, [catData]);

  const openDetail = useCallback((sku: Sku) => {
    setEditingSku(sku);
    setDrawerMode('detail');
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerMode(null);
    setEditingSku(null);
  }, []);

  useEffect(() => {
    if (!skuDetail || (drawerMode !== 'edit' && drawerMode !== 'detail')) return;
    setEditingSku(skuDetail);
    if (drawerMode === 'edit') {
      setSkuForm(buildSkuFormData(skuDetail, catData));
    }
  }, [skuDetail, drawerMode, catData]);

  // ── 表单提交 ──
  const handleSave = useCallback(async () => {
    const { name, category1Code, category2Id, stockUnit, purchaseUnit, brandScope, brandCustomerId } = skuForm;
    const isFinished = isFinishedCategory(category1Code);
    if (!name.trim()) { showToast({ type: 'warning', message: '请填写物料名称' }); return; }
    if (!category1Code) { showToast({ type: 'warning', message: '请选择物料分类（一级）' }); return; }
    if (!category2Id) { showToast({ type: 'warning', message: '请选择二级品类' }); return; }
    if (!stockUnit) { showToast({ type: 'warning', message: '请填写库存单位' }); return; }
    if (!purchaseUnit) { showToast({ type: 'warning', message: '请填写采购单位' }); return; }
    if (purchaseUnit !== stockUnit && !(parseFloat(skuForm.stockConvFactor) > 0)) {
      showToast({ type: 'warning', message: '采购单位与库存单位不一致时，请填写大于 0 的库存换算系数' });
      return;
    }
    const effectiveProductionUnit = skuForm.productionUnit || stockUnit;
    if (effectiveProductionUnit !== stockUnit && !(parseFloat(skuForm.productionConvFactor) > 0)) {
      showToast({ type: 'warning', message: '生产领用单位与库存单位不一致时，请填写大于 0 的生产领用换算系数' });
      return;
    }
    if (!skuForm.businessClass) { showToast({ type: 'warning', message: '请选择业务大类' }); return; }
    if (!skuForm.controlMode) { showToast({ type: 'warning', message: '请选择控制模式' }); return; }
    if (isFinished && brandScope === 'customer' && !brandCustomerId) {
      showToast({ type: 'warning', message: '客户专属 SKU 必须选择所属客户' });
      return;
    }

    const cat1Id = getCat1IdByCode(catData, category1Code);
    if (!cat1Id) { showToast({ type: 'warning', message: '无法识别一级分类，请重新选择' }); return; }

    const normalizedCustomerRefs = skuForm.customerRefs
      .filter((ref) => ref.customerId || ref.customerSkuCode.trim() || ref.customerSkuName.trim())
      .map((ref) => ({
        customerId: Number(ref.customerId),
        customerSkuCode: ref.customerSkuCode.trim(),
        customerSkuName: ref.customerSkuName.trim() || undefined,
        status: ref.status,
      }));

    for (const ref of normalizedCustomerRefs) {
      if (!Number.isInteger(ref.customerId) || ref.customerId <= 0) {
        showToast({ type: 'warning', message: '客户编码映射需要先选择客户' });
        return;
      }
      if (!ref.customerSkuCode) {
        showToast({ type: 'warning', message: '客户编码映射中的客户 SKU 编码不能为空' });
        return;
      }
      if (isFinished && brandScope === 'customer' && Number(brandCustomerId) !== ref.customerId) {
        showToast({ type: 'warning', message: '客户专属 SKU 只能维护所属客户的客户编码' });
        return;
      }
    }

    const effectiveBrandScope: SkuBrandScope = isFinished ? brandScope : 'factory';
    const effectiveBrandCustomerId = isFinished && brandScope === 'customer'
      ? Number(brandCustomerId)
      : null;
    const effectiveCustomerRefs = isFinished ? normalizedCustomerRefs : [];
    const trimmedApprovalPolicyCode = skuForm.approvalPolicyCode.trim();

    const consumableProfile = skuForm.businessClass === 'consumable'
      ? {
          issueMode: skuForm.consumableProfile.issueMode,
          approvalLevel: skuForm.consumableProfile.approvalLevel,
          expenseSubject: skuForm.consumableProfile.expenseSubject.trim() || undefined,
          minStock: skuForm.consumableProfile.minStock.trim() || undefined,
          maxStock: skuForm.consumableProfile.maxStock.trim() || undefined,
          purchaseLeadDays: skuForm.consumableProfile.purchaseLeadDays
            ? Number(skuForm.consumableProfile.purchaseLeadDays)
            : undefined,
          issueDeptRequired: skuForm.consumableProfile.issueDeptRequired,
          notes: skuForm.consumableProfile.notes.trim() || undefined,
        }
      : undefined;
    const assetProfile = skuForm.businessClass === 'fixed_asset'
      ? {
          assetCategory: skuForm.assetProfile.assetCategory.trim() || undefined,
          depreciationMethod: skuForm.assetProfile.depreciationMethod,
          usefulLifeMonths: skuForm.assetProfile.usefulLifeMonths
            ? Number(skuForm.assetProfile.usefulLifeMonths)
            : undefined,
          residualRate: skuForm.assetProfile.residualRate.trim() || undefined,
          capexSubject: skuForm.assetProfile.capexSubject.trim() || undefined,
          requiresSerialNo: skuForm.assetProfile.requiresSerialNo,
          maintenanceCycleDays: skuForm.assetProfile.maintenanceCycleDays
            ? Number(skuForm.assetProfile.maintenanceCycleDays)
            : undefined,
          warrantyMonths: skuForm.assetProfile.warrantyMonths
            ? Number(skuForm.assetProfile.warrantyMonths)
            : undefined,
          notes: skuForm.assetProfile.notes.trim() || undefined,
        }
      : undefined;

    const payload = {
      name: name.trim(),
      category1Id: Number(cat1Id),
      category2Id: Number(category2Id),
      spec: skuForm.spec || undefined,
      stockUnit,
      purchaseUnit,
      productionUnit: effectiveProductionUnit,
      stockConvFactor: parseFloat(skuForm.stockConvFactor) || 1,
      productionConvFactor: skuForm.productionConvFactor
        ? (parseFloat(skuForm.productionConvFactor) || undefined)
        : undefined,
      prodConvNote: skuForm.prodConvNote || undefined,
      safetyStock: skuForm.safetyStock || undefined,
      hasDyeLot: Boolean(skuForm.hasDyeLot),
      useFifo: Boolean(skuForm.useFifo),
      businessClass: skuForm.businessClass,
      controlMode: skuForm.controlMode,
      allowBomComponent: Boolean(skuForm.allowBomComponent),
      allowPurchase: Boolean(skuForm.allowPurchase),
      allowInventory: Boolean(skuForm.allowInventory),
      allowProductionIssue: Boolean(skuForm.allowProductionIssue),
      requiresAssetAcceptance: Boolean(skuForm.requiresAssetAcceptance),
      defaultWarehouseType: skuForm.defaultWarehouseType || null,
      approvalPolicyCode: trimmedApprovalPolicyCode || undefined,
      assetTrackingMode: skuForm.assetTrackingMode || undefined,
      brandScope: effectiveBrandScope,
      brandCustomerId: effectiveBrandCustomerId,
      customerRefs: effectiveCustomerRefs,
      consumableProfile,
      assetProfile,
      description: skuForm.description || undefined,
      status: skuForm.status,
    };

    try {
      if (drawerMode === 'create') {
        await createMutation.mutateAsync(payload);
        showToast({ type: 'success', message: 'SKU 创建成功' });
      } else if (drawerMode === 'edit' && editingSku) {
        await updateMutation.mutateAsync({ id: editingSku.id, payload });
        showToast({ type: 'success', message: 'SKU 更新成功' });
      }
      closeDrawer();
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message ?? '操作失败' });
    }
  }, [skuForm, catData, drawerMode, editingSku, createMutation, updateMutation, closeDrawer, showToast]);

  // ── 单条启用 ──
  const handleEnableSku = useCallback(async (id: number) => {
    try {
      await batchStatusMutation.mutateAsync({ ids: [id], status: SkuStatus.ACTIVE });
      showToast({ type: 'success', message: 'SKU 已启用' });
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message ?? '操作失败' });
    }
  }, [batchStatusMutation, showToast]);

  // ── 批量操作 ──
  const handleBatchDisable = useCallback(async () => {
    if (selectedIds.length === 0) return;
    try {
      await batchStatusMutation.mutateAsync({ ids: selectedIds, status: SkuStatus.INACTIVE });
      showToast({ type: 'success', message: `已停用 ${selectedIds.length} 个 SKU` });
      setSelectedIds([]);
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message ?? '操作失败' });
    }
  }, [selectedIds, batchStatusMutation, showToast]);

  const handleBatchSafety = useCallback(async () => {
    const val = parseFloat(batchSafetyVal);
    if (isNaN(val) || val < 0) { showToast({ type: 'warning', message: '请输入有效的安全库存数量' }); return; }
    try {
      await batchSafetyMutation.mutateAsync({ ids: selectedIds, safetyStock: val });
      showToast({ type: 'success', message: `已为 ${selectedIds.length} 个 SKU 设置安全库存` });
      setShowBatchSafety(false);
      setBatchSafetyVal('');
      setSelectedIds([]);
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message ?? '操作失败' });
    }
  }, [batchSafetyVal, selectedIds, batchSafetyMutation, showToast]);

  // ── 导出 ──
  const handleExport = useCallback(() => {
    exportObjectsToCSV('SKU主数据', [
      { key: 'skuCode',    label: 'SKU编码' },
      { key: 'name',       label: '物料名称' },
      { key: 'spec',       label: '规格' },
      { key: 'category1Name', label: '一级分类' },
      { key: 'category2Name', label: '二级品类' },
      { key: 'brandScope', label: '品牌归属' },
      { key: 'brandCustomerName', label: '所属客户' },
      { key: 'stockUnit',  label: '库存单位' },
      { key: 'purchaseUnit', label: '采购单位' },
      { key: 'productionUnit', label: '生产领用单位' },
      { key: 'stockConvFactor', label: '采购换算系数' },
      { key: 'productionConvFactor', label: '领用换算系数' },
      { key: 'safetyStock', label: '安全库存' },
      { key: 'qtyOnHand',  label: '当前库存' },
      { key: 'status',     label: '状态' },
    ], (selectedIds.length > 0
      ? skuList.filter((s) => selectedIds.includes(Number(s.id)))
      : skuList).map((sku) => ({
      ...sku,
      brandScope: sku.brandScope === 'customer' ? '客户专属' : '工厂自主品牌',
      brandCustomerName: sku.brandScope === 'customer'
        ? (customerLabelById.get(Number(sku.brandCustomerId)) ?? `客户 #${sku.brandCustomerId ?? ''}`)
        : '全部客户',
    })) as Record<string, unknown>[], (value, key) => {
      if (key === 'status') {
        return value === 'active' ? '启用' : value === 'inactive' ? '停用' : String(value ?? '');
      }
      return String(value ?? '');
    });
    showToast({ type: 'success', message: '导出成功' });
  }, [skuList, selectedIds, showToast, customerLabelById]);

  // ── 表格列定义 ──
  const columns: Column<SkuRecord>[] = useMemo(() => [
    // 复选框列
    {
      key: 'checkbox',
      title: '',
      width: 44,
      render: (_, r) => {
        const id = Number(r.id);
        return (
          <div className={styles.checkbox_col}>
            <input
              type="checkbox"
              className={styles.row_checkbox}
              checked={selectedIds.includes(id)}
              onChange={(e) => handleSelectRow(id, e.target.checked)}
              onClick={(e) => e.stopPropagation()}
              aria-label={`选择 ${r.skuCode as string}`}
            />
          </div>
        );
      },
    },
    // SKU编码
    {
      key: 'skuCode',
      title: 'SKU编码',
      width: 120,
      render: (_, r) => (
        <button
          className={styles.sku_code_link}
          onClick={() => openDetail(r as unknown as Sku)}
          type="button"
        >
          {r.skuCode as string}
        </button>
      ),
    },
    // 物料名称/规格
    {
      key: 'name',
      title: '物料名称 / 规格',
      width: 260,
      render: (_, r) => {
        const sku = r as unknown as Sku;
        return (
          <div className={styles.sku_name_cell}>
            <div className={styles.sku_name_row}>
              <span className={styles.sku_name_text}>{sku.name}</span>
              {toBooleanFlag(sku.hasDyeLot) && (
                <span className={styles.dye_lot_tag}>需缸号管理</span>
              )}
            </div>
            {sku.spec && <span className={styles.sku_spec_text}>{sku.spec}</span>}
            {isFinishedSkuRecord(sku) && (
              <div className={styles.sku_meta_row}>
                <span className={styles.sku_meta_tag}>
                  {sku.brandScope === 'customer' ? '客户专属' : '工厂自主品牌'}
                </span>
                {sku.brandScope === 'customer' && (
                  <span className={`${styles.sku_meta_tag} ${styles['sku_meta_tag--customer']}`}>
                    {sku.brandCustomerId
                      ? (customerLabelById.get(Number(sku.brandCustomerId)) ?? `客户 #${sku.brandCustomerId}`)
                      : '所属客户未设置'}
                  </span>
                )}
              </div>
            )}
            {(sku.businessClass || sku.controlMode) && (
              <div className={styles.sku_meta_row}>
                <span className={styles.sku_meta_tag}>{getBusinessClassLabel(sku.businessClass)}</span>
                <span className={`${styles.sku_meta_tag} ${styles['sku_meta_tag--customer']}`}>
                  {getControlModeLabel(sku.controlMode)}
                </span>
              </div>
            )}
          </div>
        );
      },
    },
    // 一级分类
    {
      key: 'category1Name',
      title: '一级分类',
      width: 100,
      render: (_, r) => {
        const sku = r as unknown as Sku;
        const code = sku.category1Code as Category1Code;
        const cls = code ? CATEGORY1_TAG_STYLE[code] : '';
        return (
          <span className={`${styles.cat1_tag} ${cls}`}>
            {sku.category1Name}
          </span>
        );
      },
    },
    // 二级品类
    {
      key: 'category2Name',
      title: '二级品类',
      width: 100,
      render: (_, r) => {
        const sku = r as unknown as Sku;
        const code = sku.category2Code as Category2Code | undefined;
        if (!code || code === Category2Code.NONE) {
          return <Tag variant="warning">{sku.category2Name || '未分类'}</Tag>;
        }
        return <Tag category2Code={code}>{sku.category2Name}</Tag>;
      },
    },
    // 库存单位
    {
      key: 'stockUnit',
      title: '库存单位',
      width: 80,
      align: 'center',
      render: (_, r) => <span style={{ fontSize: 13 }}>{r.stockUnit as string}</span>,
    },
    // 采购单位
    {
      key: 'purchaseUnit',
      title: '采购单位',
      width: 80,
      align: 'center',
      render: (_, r) => <span style={{ fontSize: 13 }}>{r.purchaseUnit as string}</span>,
    },
    // 安全库存
    {
      key: 'safetyStock',
      title: '安全库存',
      width: 120,
      render: (_, r) => {
        const sku = r as unknown as Sku;
        if (!sku.safetyStock) {
          return (
            <span className={styles.safety_warn}>
              <span>△</span>
              <span>未设置</span>
            </span>
          );
        }
        return (
          <span className={styles.safety_value}>
            {sku.safetyStock}
            <span className={styles.stock_unit}>{sku.stockUnit}</span>
          </span>
        );
      },
    },
    ...(showCurrentStockColumn
      ? [{
        // 当前库存
        key: 'qtyOnHand',
        title: '当前库存',
        width: 110,
        render: (_: unknown, r: SkuRecord) => {
          const sku = r as unknown as Sku;
          if (sku.qtyOnHand == null) return <span style={{ color: '#9ca3af', fontSize: 12 }}>—</span>;
          return (
            <>
              <span className={styles.stock_value}>{sku.qtyOnHand}</span>
              <span className={styles.stock_unit}>{sku.stockUnit}</span>
            </>
          );
        },
      }] as Column<SkuRecord>[]
      : []),
    // 状态
    {
      key: 'status',
      title: '状态',
      width: 72,
      render: (_, r) => {
        const sku = r as unknown as Sku;
        const isActive = String(sku.status) === SkuStatus.ACTIVE;
        return (
          <span style={{
            display: 'inline-block',
            padding: '2px 8px',
            borderRadius: '4px',
            fontSize: '0.75rem',
            fontWeight: 500,
            background: isActive ? 'var(--color-success-50, #ecfdf5)' : 'var(--color-error-50, #fef2f2)',
            color: isActive ? 'var(--color-success-600, #059669)' : 'var(--color-error-600, #dc2626)',
          }}>
            {isActive ? '启用' : '停用'}
          </span>
        );
      },
    },
    // 操作
    {
      key: 'actions',
      title: '操作',
      width: 150,
      render: (_, r) => {
        const sku = r as unknown as Sku;
        const isActive = String(sku.status) === SkuStatus.ACTIVE;
        return (
          <div className={styles.action_btns}>
            <button className={styles.action_link} onClick={() => openEdit(sku)} type="button">
              编辑
            </button>
            <button className={styles.action_link} onClick={() => openDetail(sku)} type="button">
              详情
            </button>
            {!isActive && (
              <button
                className={styles.action_link}
                style={{ color: 'var(--color-success-600, #059669)' }}
                onClick={() => void handleEnableSku(Number(sku.id))}
                type="button"
              >
                启用
              </button>
            )}
          </div>
        );
      },
    },
  ], [selectedIds, handleSelectRow, openEdit, openDetail, handleEnableSku, customerLabelById, showCurrentStockColumn]);

  // ── 筛选参数更新助手 ──
  const setFilter = useCallback((patch: Partial<SkuListQuery>) => {
    setQuery((q) => ({ ...q, ...patch, page: 1 }));
  }, []);

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className={styles.page}>
      {/* ── 页头 ── */}
      <div className={styles.page_header}>
        <div className={styles.breadcrumb}>
          <span>基础数据</span>
          <span className={styles.breadcrumb_sep}>&gt;</span>
          <span className={styles.breadcrumb_current}>SKU主数据</span>
        </div>
        <div className={styles.header_actions}>
          <Button variant="primary" size="md" onClick={openCreate} icon={<span>+</span>}>
            新增SKU
          </Button>
          <Button
            variant="secondary"
            size="md"
            icon={<span>⬆</span>}
            onClick={() => setShowImport(true)}
          >
            批量导入Excel
          </Button>
          <Button variant="secondary" size="md" icon={<span>⬇</span>} onClick={handleExport}>
            导出
          </Button>
        </div>
      </div>

      {/* ── 警告横幅 ── */}
      {!warnDismissed && noCategory2Count > 0 && (
        <div className={styles.warn_banner}>
          <span className={styles.warn_banner_icon}>⚠</span>
          <span className={styles.warn_banner_text}>
            <strong>{noCategory2Count} 个 SKU</strong> 的二级品类尚未设置（历史导入数据默认"未分类"），建议批量补录以启用品类成本分析功能。
          </span>
          <div className={styles.warn_banner_actions}>
            <button
              className={styles.warn_batch_btn}
              onClick={() => {
                setFilter({ category2Id: undefined });
                setKeyword('');
                showToast({ type: 'info', message: '请在列表中筛选未分类 SKU 后批量编辑' });
              }}
            >
              批量补录
            </button>
            <button className={styles.warn_close_btn} onClick={() => setWarnDismissed(true)} aria-label="关闭提示">
              ×
            </button>
          </div>
        </div>
      )}

      {/* ── 统计卡片栏 ── */}
      <div className={styles.stats_row}>
        <div className={styles.stats_card}>
          <span className={styles.stats_card_label}>全部SKU</span>
          <span className={`${styles.stats_card_value} ${styles['stats_card_value--blue']}`}>
            {statsData?.total ?? (data?.total ?? '—')}
          </span>
        </div>
        <div className={styles.stats_card}>
          <span className={styles.stats_card_label}>原材料</span>
          <span className={`${styles.stats_card_value} ${styles['stats_card_value--blue']}`}>
            {statsData?.rawMaterial ?? '—'}
          </span>
        </div>
        <div className={styles.stats_card}>
          <span className={styles.stats_card_label}>半成品</span>
          <span className={`${styles.stats_card_value} ${styles['stats_card_value--orange']}`}>
            {statsData?.semiProduct ?? '—'}
          </span>
        </div>
        <div className={styles.stats_card}>
          <span className={styles.stats_card_label}>成品</span>
          <span className={`${styles.stats_card_value} ${styles['stats_card_value--green']}`}>
            {statsData?.finished ?? '—'}
          </span>
        </div>
        <div className={styles.stats_card}>
          <span className={styles.stats_card_label}>固定资产</span>
          <span className={`${styles.stats_card_value} ${styles['stats_card_value--teal']}`}>
            {statsData?.fixedAsset ?? '—'}
          </span>
        </div>

        <div className={styles.stats_badges}>
          {statsData && statsData.noSafetyStock > 0 && (
            <span className={`${styles.stats_badge} ${styles['stats_badge--red']}`}>
              <span>✕</span>
              <span>安全库存未设置: {statsData.noSafetyStock}个</span>
            </span>
          )}
          {statsData && statsData.incomplete > 0 && (
            <span className={`${styles.stats_badge} ${styles['stats_badge--yellow']}`}>
              <span>△</span>
              <span>数据不完整: {statsData.incomplete}个</span>
            </span>
          )}
        </div>
      </div>

      {/* ── 筛选栏 ── */}
      <div className={styles.filter_bar}>
        <input
          type="search"
          className={styles.filter_search}
          placeholder="搜索SKU编码 / 名称 / 规格..."
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          aria-label="搜索 SKU"
        />

        {/* 一级分类 */}
        <select
          className={styles.filter_select}
          value={query.category1Id ?? ''}
          onChange={(e) => setFilter({
            category1Id: e.target.value ? Number(e.target.value) : undefined,
            category2Id: undefined,
          })}
          aria-label="一级分类筛选"
        >
          <option value="">全部分类</option>
          {cat1Options.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        {/* 二级品类 */}
        <select
          className={styles.filter_select}
          value={query.category2Id ?? ''}
          onChange={(e) => setFilter({ category2Id: e.target.value ? Number(e.target.value) : undefined })}
          aria-label="二级品类筛选"
        >
          <option value="">全部二级品类</option>
          {filterCat2Options.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        {/* 状态 */}
        <select
          className={styles.filter_select}
          value={query.status ?? ''}
          onChange={(e) => setFilter({ status: (e.target.value as SkuStatus) || undefined })}
          aria-label="状态筛选"
        >
          <option value="">全部状态</option>
          <option value={SkuStatus.ACTIVE}>启用</option>
          <option value={SkuStatus.INACTIVE}>停用</option>
        </select>
      </div>

      {/* ── 数据表格 ── */}
      <div className={styles.table_card}>
        {/* 表头选择与批量操作行 */}
        <div className={styles.table_header_bar}>
          <input
            type="checkbox"
            className={styles.row_checkbox}
            checked={isAllSelected}
            ref={(el) => { if (el) el.indeterminate = isIndeterminate; }}
            onChange={(e) => handleSelectAll(e.target.checked)}
            aria-label="全选当前页"
          />
          {selectedIds.length > 0 ? (
            <>
              <span className={styles.batch_bar_count}>
                已选 <strong>{selectedIds.length}</strong> 条
              </span>
              <button
                className={styles.batch_select_all}
                onClick={() => handleSelectAll(true)}
                type="button"
              >
                全选本页
              </button>
              <div className={styles.batch_divider} />
              <span className={styles.batch_label}>批量操作:</span>
              <div className={styles.batch_actions}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => { setBatchSafetyVal(''); setShowBatchSafety(true); }}
                >
                  设置安全库存
                </Button>
                <Button variant="secondary" size="sm" onClick={handleExport}>
                  导出所选
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  loading={batchStatusMutation.isPending}
                  onClick={() => void handleBatchDisable()}
                >
                  批量停用
                </Button>
              </div>
              <button className={styles.batch_clear} onClick={() => setSelectedIds([])} type="button">
                清除选择
              </button>
            </>
          ) : (
            <span className={styles.table_header_summary}>共 {data?.total ?? 0} 条记录</span>
          )}
        </div>

        <Table<SkuRecord>
          columns={columns}
          dataSource={skuList}
          rowKey="id"
          loading={isLoading}
          error={error ? (error as Error).message : null}
          emptyText="暂无 SKU 数据，点击右上角「新增SKU」添加"
          pagination={
            data
              ? {
                  page: query.page ?? 1,
                  pageSize: query.pageSize ?? 20,
                  total: data.total,
                  onChange: (p) => setQuery((q) => ({ ...q, page: p })),
                }
              : undefined
          }
        />

      </div>

      {/* ── 新增 / 编辑 SKU Drawer ── */}
      <Drawer
        open={drawerMode === 'create' || drawerMode === 'edit'}
        title={drawerMode === 'create' ? '新增SKU' : `编辑SKU — ${editingSku?.skuCode ?? ''}`}
        width={760}
        onClose={closeDrawer}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="ghost" onClick={closeDrawer}>取消</Button>
            <Button variant="primary" loading={isSaving} onClick={() => void handleSave()}>
              保存SKU
            </Button>
          </div>
        }
      >
        <SkuFormDrawerContent
          form={skuForm}
          onChange={setSkuForm}
          isNew={drawerMode === 'create'}
          cat1Options={cat1Options}
          cat2Options={formCat2Options}
          editingSku={editingSku}
          customerOptions={customerOptions}
        />
      </Drawer>

      {/* ── SKU 详情 Drawer ── */}
      <Drawer
        open={drawerMode === 'detail'}
        title={`SKU 详情 — ${editingSku?.skuCode ?? ''}`}
        width={520}
        onClose={closeDrawer}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="ghost" onClick={closeDrawer}>关闭</Button>
            {editingSku && (
              <Button variant="primary" onClick={() => { closeDrawer(); openEdit(editingSku); }}>
                编辑
              </Button>
            )}
          </div>
        }
      >
        {editingSku && (
          <SkuDetailContent
            sku={editingSku}
            customerLabelById={customerLabelById}
            categoryNameById={categoryNameById}
          />
        )}
      </Drawer>

      {/* ── 批量设置安全库存 Modal ── */}
      <Modal
        open={showBatchSafety}
        title={`批量设置安全库存（已选 ${selectedIds.length} 个SKU）`}
        onClose={() => setShowBatchSafety(false)}
        onConfirm={() => void handleBatchSafety()}
        confirmLabel="确认设置"
        confirmLoading={batchSafetyMutation.isPending}
        size="sm"
      >
        <div className={styles.batch_safety_wrap}>
          <div className={styles.batch_safety_info}>
            将为选中的 <strong>{selectedIds.length}</strong> 个 SKU 统一设置安全库存阈值。低于此数量时系统将触发采购预警。
          </div>
          <div className={styles.batch_safety_field}>
            <input
              type="number"
              min="0"
              step="any"
              className={styles.batch_safety_input}
              placeholder="请输入安全库存数量"
              value={batchSafetyVal}
              onChange={(e) => setBatchSafetyVal(e.target.value)}
              autoFocus
            />
            <span className={styles.batch_safety_unit}>（各自库存单位）</span>
          </div>
        </div>
      </Modal>

      {/* ── 批量导入向导 Modal ── */}
      <ImportWizardModal
        open={showImport}
        onClose={() => setShowImport(false)}
        onSuccess={(count) => {
          showToast({ type: 'success', message: `成功导入 ${count} 条 SKU` });
          setShowImport(false);
        }}
      />
    </div>
  );
}

// ──────────────────────────────────────────────
// 子组件：SKU 表单
// ──────────────────────────────────────────────
interface SkuFormDrawerContentProps {
  form: SkuFormData;
  onChange: React.Dispatch<React.SetStateAction<SkuFormData>>;
  isNew: boolean;
  cat1Options: SkuCategory[];
  cat2Options: SkuCategory[];
  editingSku: Sku | null;
  customerOptions: Array<{ id: number; code: string; name: string }>;
}

function SkuFormDrawerContent({
  form,
  onChange,
  isNew,
  cat1Options,
  cat2Options,
  editingSku,
  customerOptions,
}: SkuFormDrawerContentProps) {
  const isFinished = isFinishedCategory(form.category1Code);
  const isFinishedGoods = form.businessClass === 'finished_goods';
  const isConsumable = form.businessClass === 'consumable';
  const isFixedAsset = form.businessClass === 'fixed_asset';
  const isDerivedControlReadonly = true;
  const set = useCallback(
    (field: keyof SkuFormData) =>
      (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
        onChange((f) => ({ ...f, [field]: e.target.value })),
    [onChange],
  );

  const setCheck = useCallback(
    (
      field:
        | 'hasDyeLot'
        | 'useFifo'
        | 'allowBomComponent'
        | 'allowPurchase'
        | 'allowInventory'
        | 'allowProductionIssue'
        | 'requiresAssetAcceptance'
    ) =>
      (e: React.ChangeEvent<HTMLInputElement>) =>
        onChange((f) => ({ ...f, [field]: e.target.checked })),
    [onChange],
  );
  const setConsumableField = useCallback(
    (field: keyof EditableConsumableProfile) =>
      (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
        onChange((current) => ({
          ...current,
          consumableProfile: {
            ...current.consumableProfile,
            [field]: e.target.value,
          },
        })),
    [onChange],
  );
  const setConsumableCheck = useCallback(
    (field: 'issueDeptRequired') =>
      (e: React.ChangeEvent<HTMLInputElement>) =>
        onChange((current) => ({
          ...current,
          consumableProfile: {
            ...current.consumableProfile,
            [field]: e.target.checked,
          },
        })),
    [onChange],
  );
  const setAssetField = useCallback(
    (field: keyof EditableAssetProfile) =>
      (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
        onChange((current) => ({
          ...current,
          assetProfile: {
            ...current.assetProfile,
            [field]: e.target.value,
          },
        })),
    [onChange],
  );
  const setAssetCheck = useCallback(
    (field: 'requiresSerialNo') =>
      (e: React.ChangeEvent<HTMLInputElement>) =>
        onChange((current) => ({
          ...current,
          assetProfile: {
            ...current.assetProfile,
            [field]: e.target.checked,
          },
        })),
    [onChange],
  );
  const setBusinessClass = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const nextBusinessClass = e.target.value as BusinessClass;
      onChange((current) => applyBusinessClassPreset(current, nextBusinessClass));
    },
    [onChange],
  );

  // 一级分类改变时清空二级品类
  const handleCat1Change = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const nextCategory1Code = e.target.value as Category1Code | '';
      onChange((f) => {
        const nextBusinessClass = getRecommendedBusinessClassByCategory1(nextCategory1Code);
        return applyBusinessClassPreset({
          ...f,
          category1Code: nextCategory1Code,
          category2Id: '',
          brandScope: nextCategory1Code === Category1Code.FINISHED ? f.brandScope : 'factory',
          brandCustomerId: nextCategory1Code === Category1Code.FINISHED ? f.brandCustomerId : '',
          customerRefs: nextCategory1Code === Category1Code.FINISHED ? f.customerRefs : [],
        }, nextBusinessClass);
      });
    },
    [onChange],
  );

  // 自动生成编码（显示用，只读）
  const autoCode = editingSku?.skuCode ?? '（系统自动生成）';
  const setBrandScope = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const nextScope = e.target.value as SkuBrandScope;
      onChange((current) => ({
        ...current,
        brandScope: nextScope,
        brandCustomerId: nextScope === 'factory' ? '' : current.brandCustomerId,
      }));
    },
    [onChange],
  );
  const addCustomerRefRow = useCallback(() => {
    onChange((current) => ({
      ...current,
      customerRefs: [
        ...current.customerRefs,
        { customerId: '', customerSkuCode: '', customerSkuName: '', status: 'active' },
      ],
    }));
  }, [onChange]);
  const updateCustomerRef = useCallback(
    <K extends keyof EditableCustomerSkuRef>(index: number, field: K, value: EditableCustomerSkuRef[K]) => {
      onChange((current) => ({
        ...current,
        customerRefs: current.customerRefs.map((ref, refIndex) => (
          refIndex === index ? { ...ref, [field]: value } : ref
        )),
      }));
    },
    [onChange],
  );
  const removeCustomerRef = useCallback(
    (index: number) => {
      onChange((current) => ({
        ...current,
        customerRefs: current.customerRefs.filter((_, refIndex) => refIndex !== index),
      }));
    },
    [onChange],
  );

  return (
    <div className={styles.form_wrap}>
      {/* ─ 基本信息 ─ */}
      <div className={styles.form_section_title}>基本信息</div>

      {/* 物料名称 */}
      <div className={styles.form_field}>
        <label className={styles.form_label}>
          物料名称 <span className={styles.required}>*</span>
        </label>
        <input
          className={styles.form_input}
          value={form.name}
          onChange={set('name')}
          placeholder="如：红橡木板 200×2400"
        />
      </div>

      {/* 物料分类（一级） 下拉列表 */}
      <div className={styles.form_field}>
        <label className={styles.form_label}>
          物料分类（一级） <span className={styles.required}>*</span>
        </label>
        <select
          className={styles.form_input}
          value={form.category1Code}
          onChange={handleCat1Change}
          disabled={!isNew}
        >
          <option value="">请选择一级分类</option>
          {cat1Options.map((c) => (
            <option key={c.id} value={c.code}>{c.name}</option>
          ))}
          {cat1Options.length === 0 && Object.entries(Category1Label).map(([code, label]) => (
            <option key={code} value={code}>{label}</option>
          ))}
        </select>
      </div>

      {/* 二级品类 */}
      <div className={styles.form_field}>
        <label className={styles.form_label}>
          二级品类 <span className={styles.required}>*</span>
        </label>
        <select
          className={styles.form_input}
          value={form.category2Id}
          onChange={(e) => onChange((f) => ({ ...f, category2Id: e.target.value ? Number(e.target.value) : '' }))}
        >
          <option value="">请选择二级品类</option>
          {cat2Options.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <span className={styles.form_hint}>
          二级品类为必填项；如当前一级分类下暂无可选项，请先到“类目配置”维护对应二级品类。
        </span>
      </div>

      {/* 规格描述 */}
      <div className={styles.form_field}>
        <label className={styles.form_label}>规格描述</label>
        <input
          className={styles.form_input}
          value={form.spec}
          onChange={set('spec')}
          placeholder="如：200×2400mm，厚18mm"
        />
      </div>

      {/* 系统编码（只读） */}
      <div className={styles.form_field}>
        <label className={styles.form_label}>系统编码</label>
        <div className={styles.form_input_readonly}>{autoCode}</div>
        <span className={styles.form_hint}>系统自动生成，不可手动修改</span>
      </div>

      {/* ─ 多单位配置 ─ */}
      <div className={styles.form_section_title}>多单位配置</div>

      {/* 采购单位 */}
      <div className={styles.unit_config_row}>
        <span className={styles.unit_config_label}>采购单位</span>
        <select
          className={styles.form_input}
          value={form.purchaseUnit}
          onChange={set('purchaseUnit')}
          disabled={!isNew}
        >
          <option value="">请选择</option>
          {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <input
          className={styles.form_input}
          value={form.purchaseUnit}
          onChange={set('purchaseUnit')}
          placeholder="或直接输入"
        />
      </div>

      {/* 库存单位 + 换算系数 */}
      <div className={styles.unit_config_row}>
        <span className={styles.unit_config_label}>库存单位</span>
        <select
          className={styles.form_input}
          value={form.stockUnit}
          onChange={set('stockUnit')}
          disabled={!isNew}
        >
          <option value="">请选择</option>
          {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <input
          type="number"
          min="0.000001"
          step="any"
          className={styles.form_input}
          value={form.stockConvFactor}
          onChange={set('stockConvFactor')}
          placeholder="换算系数"
        />
      </div>

      {/* 生产领用单位 */}
      <div className={styles.unit_config_row}>
        <span className={styles.unit_config_label}>生产领用单位</span>
        <select
          className={styles.form_input}
          value={form.productionUnit}
          onChange={set('productionUnit')}
        >
          <option value="">请选择</option>
          {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <input
          type="number"
          min="0.000001"
          step="any"
          className={styles.form_input}
          value={form.productionConvFactor}
          onChange={set('productionConvFactor')}
          placeholder="生产领用换算系数"
        />
        <input
          className={styles.form_input}
          value={form.prodConvNote}
          onChange={set('prodConvNote')}
          placeholder="换算说明 如 200×2400"
        />
      </div>

      {/* 单位示例提示 */}
      <div className={`${styles.form_hint} ${styles['form_hint--blue']}`}>
        示例：1 {form.purchaseUnit || '张'}（采购）= {form.stockConvFactor || '1.00'} {form.stockUnit || '张'}（库存）
        {form.productionUnit && form.productionUnit !== form.stockUnit && form.productionConvFactor
          ? `；1 ${form.productionUnit}（领用）= ${form.productionConvFactor} ${form.stockUnit || '张'}（库存）`
          : ''}
        {form.prodConvNote ? `；说明：${form.prodConvNote}` : ''}
      </div>

      {/* ─ 安全库存 ─ */}
      <div className={styles.form_section_title}>安全库存</div>

      <div className={styles.form_field}>
        <label className={styles.form_label}>安全库存量</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="number"
            min="0"
            step="any"
            className={styles.form_input}
            style={{ flex: 1 }}
            value={form.safetyStock}
            onChange={set('safetyStock')}
            placeholder="0"
          />
          <span style={{ fontSize: 13, color: '#6b7280', whiteSpace: 'nowrap' }}>
            {form.stockUnit || '(单位)'}
          </span>
        </div>
        <span className={styles.form_hint}>低于此数量触发预警</span>
      </div>

      <div className={styles.form_section_title}>管控属性</div>

      <div className={styles.form_grid_two_col}>
        <div className={styles.form_field}>
          <label className={styles.form_label}>
            业务大类 <span className={styles.required}>*</span>
          </label>
          <select className={styles.form_input} value={form.businessClass} onChange={setBusinessClass}>
            <option value="production_material">生产物料</option>
            <option value="finished_goods">成品商品</option>
            <option value="consumable">损耗品</option>
            <option value="fixed_asset">固定资产</option>
          </select>
          <span className={styles.form_hint}>切换业务大类时，会带入推荐的控制模式和默认规则。</span>
        </div>

        <div className={styles.form_field}>
          <label className={styles.form_label}>
            控制模式 <span className={styles.required}>*</span>
          </label>
          {isDerivedControlReadonly ? (
            <div className={styles.form_input_readonly}>{getControlModeLabel(form.controlMode)}</div>
          ) : (
            <select
              className={styles.form_input}
              value={form.controlMode}
              onChange={(e) => onChange((current) => ({ ...current, controlMode: e.target.value as ControlMode }))}
            >
              <option value="mrp">MRP</option>
              <option value="stock_only">仅库存</option>
              <option value="direct_expense">直耗</option>
              <option value="asset">资产</option>
            </select>
          )}
        </div>

        <div className={styles.form_field}>
          <label className={styles.form_label}>默认仓库类型</label>
          {isDerivedControlReadonly ? (
            <div className={styles.form_input_readonly}>{getDefaultWarehouseTypeLabel(form.defaultWarehouseType)}</div>
          ) : (
            <select
              className={styles.form_input}
              value={form.defaultWarehouseType}
              onChange={(e) => onChange((current) => ({ ...current, defaultWarehouseType: e.target.value as DefaultWarehouseType | '' }))}
            >
              <option value="">未指定</option>
              <option value="raw_material">原料仓</option>
              <option value="consumable">损耗品仓</option>
              <option value="asset_pending">资产待验收仓</option>
              <option value="asset">资产仓</option>
              <option value="finished">成品仓</option>
            </select>
          )}
        </div>

        <div className={styles.form_field}>
          <label className={styles.form_label}>审批策略编码</label>
          {isDerivedControlReadonly ? (
            <div className={styles.form_input_readonly}>{form.approvalPolicyCode || '未配置'}</div>
          ) : (
            <input
              className={styles.form_input}
              value={form.approvalPolicyCode}
              onChange={set('approvalPolicyCode')}
              placeholder={isConsumable ? '例如 CONS-NORMAL' : isFixedAsset ? '例如 ASSET-STRICT' : isFinishedGoods ? '例如 FG-STOCK' : '可留空'}
            />
          )}
        </div>

        <div className={styles.form_field}>
          <label className={styles.form_label}>跟踪模式</label>
          {isDerivedControlReadonly ? (
            <div className={styles.form_input_readonly}>{getAssetTrackingModeLabel(form.assetTrackingMode)}</div>
          ) : (
            <select
              className={styles.form_input}
              value={form.assetTrackingMode}
              onChange={(e) => onChange((current) => ({ ...current, assetTrackingMode: e.target.value as AssetTrackingMode | '' }))}
            >
              <option value="none">不跟踪</option>
              <option value="batch">批次</option>
              <option value="serial">序列号</option>
            </select>
          )}
        </div>
      </div>

      <div className={styles.form_hint_box}>
        <div>{isConsumable ? '损耗品默认走库存/领用规则，可维护审批强度和费用科目。' : isFixedAsset ? '固定资产默认要求验收建卡，建议启用序列号跟踪。' : isFinishedGoods ? '成品商品默认进入成品库存，可采购、可销售，但不参与 BOM 子件与生产领用。' : '生产物料默认保留采购、库存和生产领用能力。'}</div>
        {isDerivedControlReadonly && <div>除业务大类外，其余管控规则按系统预设自动带出，只读展示。</div>}
      </div>

      <div className={styles.toggle_grid}>
        <div className={styles.checkbox_field}>
          <input
            type="checkbox"
            id="chk_allow_bom"
            checked={form.allowBomComponent}
            onChange={setCheck('allowBomComponent')}
            disabled={isDerivedControlReadonly}
          />
          <label htmlFor="chk_allow_bom">
            <div>允许作为 BOM 组件</div>
            <div className={styles.checkbox_sub_text}>损耗品通常默认关闭，避免误入生产配方。</div>
          </label>
        </div>

        <div className={styles.checkbox_field}>
          <input
            type="checkbox"
            id="chk_allow_purchase"
            checked={form.allowPurchase}
            onChange={setCheck('allowPurchase')}
            disabled={isDerivedControlReadonly}
          />
          <label htmlFor="chk_allow_purchase">
            <div>允许采购</div>
            <div className={styles.checkbox_sub_text}>决定采购单能否选择该 SKU。</div>
          </label>
        </div>

        <div className={styles.checkbox_field}>
          <input
            type="checkbox"
            id="chk_allow_inventory"
            checked={form.allowInventory}
            onChange={setCheck('allowInventory')}
            disabled={isDerivedControlReadonly}
          />
          <label htmlFor="chk_allow_inventory">
            <div>允许进入库存</div>
            <div className={styles.checkbox_sub_text}>固定资产通常关闭，走资产台账而不是普通库存。</div>
          </label>
        </div>

        <div className={styles.checkbox_field}>
          <input
            type="checkbox"
            id="chk_allow_issue"
            checked={form.allowProductionIssue}
            onChange={setCheck('allowProductionIssue')}
            disabled={isDerivedControlReadonly}
          />
          <label htmlFor="chk_allow_issue">
            <div>允许生产领用</div>
            <div className={styles.checkbox_sub_text}>生产物料默认开启，损耗品与资产默认关闭。</div>
          </label>
        </div>

        <div className={styles.checkbox_field}>
          <input
            type="checkbox"
            id="chk_asset_acceptance"
            checked={form.requiresAssetAcceptance}
            onChange={setCheck('requiresAssetAcceptance')}
            disabled={isDerivedControlReadonly}
          />
          <label htmlFor="chk_asset_acceptance">
            <div>需要资产验收</div>
            <div className={styles.checkbox_sub_text}>收货后是否进入资产验收建卡链路。</div>
          </label>
        </div>
      </div>

      {/* ─ 特殊属性 ─ */}
      <div className={styles.form_section_title}>特殊属性</div>

      <div className={styles.checkbox_field}>
        <input
          type="checkbox"
          id="chk_dye"
          checked={form.hasDyeLot}
          onChange={setCheck('hasDyeLot')}
        />
        <label htmlFor="chk_dye">
          <div>需缸号管理</div>
          <div className={styles.checkbox_sub_text}>面料 / 皮料类物料勾选</div>
        </label>
      </div>

      <div className={styles.checkbox_field}>
        <input
          type="checkbox"
          id="chk_fifo"
          checked={form.useFifo}
          onChange={setCheck('useFifo')}
        />
        <label htmlFor="chk_fifo">
          <div>启用先进先出（FIFO）出库</div>
        </label>
      </div>

      {isConsumable && (
        <>
          <div className={styles.form_section_title}>损耗品档案</div>
          <div className={styles.profile_card}>
            <div className={styles.form_grid_two_col}>
              <div className={styles.form_field}>
                <label className={styles.form_label}>领用方式</label>
                <select
                  className={styles.form_input}
                  value={form.consumableProfile.issueMode}
                  onChange={setConsumableField('issueMode')}
                >
                  <option value="department_issue">部门领用</option>
                  <option value="direct_expense">直接费用化</option>
                </select>
              </div>
              <div className={styles.form_field}>
                <label className={styles.form_label}>审批强度</label>
                <select
                  className={styles.form_input}
                  value={form.consumableProfile.approvalLevel}
                  onChange={setConsumableField('approvalLevel')}
                >
                  <option value="none">免审批</option>
                  <option value="normal">普通</option>
                  <option value="strict">严格</option>
                </select>
              </div>
              <div className={styles.form_field}>
                <label className={styles.form_label}>费用科目</label>
                <input
                  className={styles.form_input}
                  value={form.consumableProfile.expenseSubject}
                  onChange={setConsumableField('expenseSubject')}
                  placeholder="例如 制造费用-低值易耗"
                />
              </div>
              <div className={styles.form_field}>
                <label className={styles.form_label}>采购提前期（天）</label>
                <input
                  type="number"
                  min="0"
                  className={styles.form_input}
                  value={form.consumableProfile.purchaseLeadDays}
                  onChange={setConsumableField('purchaseLeadDays')}
                  placeholder="例如 7"
                />
              </div>
              <div className={styles.form_field}>
                <label className={styles.form_label}>最低库存</label>
                <input
                  className={styles.form_input}
                  value={form.consumableProfile.minStock}
                  onChange={setConsumableField('minStock')}
                  placeholder="用于领用和补货阈值"
                />
              </div>
              <div className={styles.form_field}>
                <label className={styles.form_label}>最高库存</label>
                <input
                  className={styles.form_input}
                  value={form.consumableProfile.maxStock}
                  onChange={setConsumableField('maxStock')}
                  placeholder="用于库存上限提醒"
                />
              </div>
            </div>

            <div className={styles.checkbox_field}>
              <input
                type="checkbox"
                id="chk_issue_dept_required"
                checked={form.consumableProfile.issueDeptRequired}
                onChange={setConsumableCheck('issueDeptRequired')}
              />
              <label htmlFor="chk_issue_dept_required">
                <div>领用时必须填写部门</div>
                <div className={styles.checkbox_sub_text}>启用后，损耗品领用单创建时会强制要求部门字段。</div>
              </label>
            </div>

            <div className={styles.form_field}>
              <label className={styles.form_label}>档案备注</label>
              <textarea
                className={styles.form_textarea}
                value={form.consumableProfile.notes}
                onChange={setConsumableField('notes')}
                rows={3}
                placeholder="例如 默认按部门领用出库"
              />
            </div>
          </div>
        </>
      )}

      {isFixedAsset && (
        <>
          <div className={styles.form_section_title}>固定资产档案</div>
          <div className={styles.profile_card}>
            <div className={styles.form_grid_two_col}>
              <div className={styles.form_field}>
                <label className={styles.form_label}>资产类别</label>
                <input
                  className={styles.form_input}
                  value={form.assetProfile.assetCategory}
                  onChange={setAssetField('assetCategory')}
                  placeholder="例如 equipment"
                />
              </div>
              <div className={styles.form_field}>
                <label className={styles.form_label}>折旧方式</label>
                <select
                  className={styles.form_input}
                  value={form.assetProfile.depreciationMethod}
                  onChange={setAssetField('depreciationMethod')}
                >
                  <option value="straight_line">直线法</option>
                  <option value="manual">手工</option>
                  <option value="none">不折旧</option>
                </select>
              </div>
              <div className={styles.form_field}>
                <label className={styles.form_label}>使用寿命（月）</label>
                <input
                  type="number"
                  min="0"
                  className={styles.form_input}
                  value={form.assetProfile.usefulLifeMonths}
                  onChange={setAssetField('usefulLifeMonths')}
                  placeholder="例如 60"
                />
              </div>
              <div className={styles.form_field}>
                <label className={styles.form_label}>残值率（%）</label>
                <input
                  className={styles.form_input}
                  value={form.assetProfile.residualRate}
                  onChange={setAssetField('residualRate')}
                  placeholder="例如 5"
                />
              </div>
              <div className={styles.form_field}>
                <label className={styles.form_label}>资本化科目</label>
                <input
                  className={styles.form_input}
                  value={form.assetProfile.capexSubject}
                  onChange={setAssetField('capexSubject')}
                  placeholder="例如 固定资产-生产设备"
                />
              </div>
              <div className={styles.form_field}>
                <label className={styles.form_label}>维保周期（天）</label>
                <input
                  type="number"
                  min="0"
                  className={styles.form_input}
                  value={form.assetProfile.maintenanceCycleDays}
                  onChange={setAssetField('maintenanceCycleDays')}
                  placeholder="例如 90"
                />
              </div>
              <div className={styles.form_field}>
                <label className={styles.form_label}>保修期（月）</label>
                <input
                  type="number"
                  min="0"
                  className={styles.form_input}
                  value={form.assetProfile.warrantyMonths}
                  onChange={setAssetField('warrantyMonths')}
                  placeholder="例如 12"
                />
              </div>
            </div>

            <div className={styles.checkbox_field}>
              <input
                type="checkbox"
                id="chk_requires_serial"
                checked={form.assetProfile.requiresSerialNo}
                onChange={setAssetCheck('requiresSerialNo')}
              />
              <label htmlFor="chk_requires_serial">
                <div>要求序列号</div>
                <div className={styles.checkbox_sub_text}>资产验收建卡时，若启用则必须填写 `serialNo`。</div>
              </label>
            </div>

            <div className={styles.form_field}>
              <label className={styles.form_label}>档案备注</label>
              <textarea
                className={styles.form_textarea}
                value={form.assetProfile.notes}
                onChange={setAssetField('notes')}
                rows={3}
                placeholder="例如 需到货验收后生成资产卡片"
              />
            </div>
          </div>
        </>
      )}

      {isFinished && (
        <>
          <div className={styles.form_section_title}>品牌与客户编码</div>

          <div className={styles.form_field}>
            <label className={styles.form_label}>品牌归属</label>
            <select
              className={styles.form_input}
              value={form.brandScope}
              onChange={setBrandScope}
            >
              <option value="factory">工厂自主品牌</option>
              <option value="customer">客户专属</option>
            </select>
            <span className={styles.form_hint}>
              工厂自主品牌 SKU 对全部客户开放；客户专属 SKU 仅允许所属客户下单。
            </span>
          </div>

          {form.brandScope === 'customer' && (
            <div className={styles.form_field}>
              <label className={styles.form_label}>
                所属客户 <span className={styles.required}>*</span>
              </label>
              <select
                className={styles.form_input}
                value={form.brandCustomerId}
                onChange={(e) => onChange((current) => ({
                  ...current,
                  brandCustomerId: e.target.value ? Number(e.target.value) : '',
                  customerRefs: current.customerRefs.filter((ref) => !ref.customerId || Number(ref.customerId) === Number(e.target.value)),
                }))}
              >
                <option value="">请选择客户</option>
                {customerOptions.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}（{customer.code}）
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className={styles.form_field}>
            <label className={styles.form_label}>客户编码映射</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {form.customerRefs.length === 0 && (
                <div className={styles.form_hint}>未维护客户侧编码；销售订单将默认显示工厂内部 SKU 编码。</div>
              )}
              {form.customerRefs.map((ref, index) => (
                <div
                  key={`customer-ref-${index}`}
                  className={styles.customer_ref_row}
                >
                  <select
                    className={styles.form_input}
                    value={ref.customerId}
                    onChange={(e) => updateCustomerRef(index, 'customerId', e.target.value ? Number(e.target.value) : '')}
                  >
                    <option value="">客户</option>
                    {customerOptions.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.name}（{customer.code}）
                      </option>
                    ))}
                  </select>
                  <input
                    className={`${styles.form_input} ${styles.customer_sku_code_input}`}
                    value={ref.customerSkuCode}
                    onChange={(e) => updateCustomerRef(index, 'customerSkuCode', e.target.value)}
                    placeholder="客户SKU编码"
                  />
                  <input
                    className={`${styles.form_input} ${styles.customer_sku_name_input}`}
                    value={ref.customerSkuName}
                    onChange={(e) => updateCustomerRef(index, 'customerSkuName', e.target.value)}
                    placeholder="客户SKU名称"
                  />
                  <select
                    className={styles.form_input}
                    value={ref.status}
                    onChange={(e) => updateCustomerRef(index, 'status', e.target.value as 'active' | 'inactive')}
                  >
                    <option value="active">启用</option>
                    <option value="inactive">停用</option>
                  </select>
                  <Button variant="ghost" size="sm" onClick={() => removeCustomerRef(index)}>
                    删除
                  </Button>
                </div>
              ))}
              <div>
                <Button variant="secondary" size="sm" onClick={addCustomerRefRow}>
                  添加客户编码
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ─ 状态 ─ */}
      {!isNew && (
        <>
          <div className={styles.form_section_title}>状态</div>
          <div className={styles.form_field}>
            <label className={styles.form_label}>启用状态</label>
            <select
              className={styles.form_input}
              value={form.status}
              onChange={set('status')}
            >
              <option value="active">启用</option>
              <option value="inactive">停用</option>
            </select>
          </div>
        </>
      )}

      {/* ─ 备注 ─ */}
      <div className={styles.form_section_title}>备注</div>
      <div className={styles.form_field}>
        <textarea
          className={styles.form_textarea}
          value={form.description}
          onChange={set('description')}
          placeholder="补充说明..."
          rows={3}
        />
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// 子组件：SKU 详情
// ──────────────────────────────────────────────
function SkuDetailContent({
  sku,
  customerLabelById,
  categoryNameById,
}: {
  sku: Sku;
  customerLabelById: Map<number, string>;
  categoryNameById: Map<number, string>;
}) {
  const statusLabel: Record<SkuStatus, string> = {
    [SkuStatus.ACTIVE]: '启用',
    [SkuStatus.INACTIVE]: '停用',
  };
  const brandScopeLabel = sku.brandScope === 'customer' ? '客户专属' : '工厂自主品牌';
  const ownerCustomerLabel = sku.brandCustomerId
    ? (customerLabelById.get(Number(sku.brandCustomerId)) ?? `客户 #${sku.brandCustomerId}`)
    : '全部客户可下单';
  const category1Text = sku.category1Name
    || categoryNameById.get(Number(sku.category1Id))
    || (sku.category1Code ? Category1Label[sku.category1Code as Category1Code] : '')
    || '—';
  const category2Text = sku.category2Name
    || categoryNameById.get(Number(sku.category2Id))
    || (sku.category2Code ? Category2Label[sku.category2Code as Category2Code] : '')
    || '';
  const category2Code = sku.category2Code as Category2Code | undefined;
  const isCategory2None = category2Code === Category2Code.NONE
    || !category2Text
    || category2Text === '未分类';
  const showBrandingSection = isFinishedSkuRecord(sku);
  const hasDyeLot = toBooleanFlag(sku.hasDyeLot);
  const useFifo = toBooleanFlag(sku.useFifo);
  const allowBomComponent = typeof sku.allowBomComponent === 'boolean'
    ? sku.allowBomComponent
    : (sku.allowBomComponent == null ? undefined : toBooleanFlag(sku.allowBomComponent));
  const allowPurchase = typeof sku.allowPurchase === 'boolean'
    ? sku.allowPurchase
    : (sku.allowPurchase == null ? undefined : toBooleanFlag(sku.allowPurchase));
  const requiresAssetAcceptance = typeof sku.requiresAssetAcceptance === 'boolean'
    ? sku.requiresAssetAcceptance
    : (sku.requiresAssetAcceptance == null ? undefined : toBooleanFlag(sku.requiresAssetAcceptance));

  return (
    <div>
      {/* 基本信息 */}
      <div className={styles.detail_section}>
        <div className={styles.detail_section_title}>基本信息</div>
        <div className={styles.detail_grid}>
          <div className={styles.detail_item}>
            <div className={styles.detail_item_label}>SKU编码</div>
            <div className={`${styles.detail_item_value} ${styles['detail_item_value--mono']}`}>{sku.skuCode}</div>
          </div>
          <div className={styles.detail_item}>
            <div className={styles.detail_item_label}>状态</div>
            <div className={styles.detail_item_value}>
              <Tag variant={sku.status === SkuStatus.ACTIVE ? 'success' : 'neutral'}>
                {statusLabel[sku.status]}
              </Tag>
            </div>
          </div>
          <div className={styles.detail_item}>
            <div className={styles.detail_item_label}>物料名称</div>
            <div className={styles.detail_item_value}>{sku.name}</div>
          </div>
          <div className={styles.detail_item}>
            <div className={styles.detail_item_label}>规格</div>
            <div className={styles.detail_item_value}>{sku.spec ?? '—'}</div>
          </div>
          <div className={styles.detail_item}>
            <div className={styles.detail_item_label}>一级分类</div>
            <div className={styles.detail_item_value}>{category1Text}</div>
          </div>
          <div className={styles.detail_item}>
            <div className={styles.detail_item_label}>二级品类</div>
            <div className={styles.detail_item_value}>
              {!isCategory2None && category2Code
                ? <Tag category2Code={category2Code}>{category2Text}</Tag>
                : <Tag variant="warning">{category2Text || '未分类'}</Tag>}
            </div>
          </div>
          {sku.barcode && (
            <div className={styles.detail_item}>
              <div className={styles.detail_item_label}>条形码</div>
              <div className={`${styles.detail_item_value} ${styles['detail_item_value--mono']}`}>{sku.barcode}</div>
            </div>
          )}
        </div>
      </div>

      {/* 单位 & 库存 */}
      <div className={styles.detail_section}>
        <div className={styles.detail_section_title}>单位 & 库存</div>
        <div className={styles.detail_grid}>
          <div className={styles.detail_item}>
            <div className={styles.detail_item_label}>库存单位</div>
            <div className={styles.detail_item_value}>{sku.stockUnit}</div>
          </div>
          <div className={styles.detail_item}>
            <div className={styles.detail_item_label}>采购单位</div>
            <div className={styles.detail_item_value}>{sku.purchaseUnit}</div>
          </div>
          <div className={styles.detail_item}>
            <div className={styles.detail_item_label}>生产领用单位</div>
            <div className={styles.detail_item_value}>{sku.productionUnit}</div>
          </div>
          {sku.stockConvFactor != null && (
            <div className={styles.detail_item}>
              <div className={styles.detail_item_label}>采购换算系数</div>
              <div className={styles.detail_item_value}>{sku.stockConvFactor}</div>
            </div>
          )}
          {sku.productionConvFactor != null && (
            <div className={styles.detail_item}>
              <div className={styles.detail_item_label}>领用换算系数</div>
              <div className={styles.detail_item_value}>{sku.productionConvFactor}</div>
            </div>
          )}
          {sku.prodConvNote && (
            <div className={styles.detail_item}>
              <div className={styles.detail_item_label}>领用换算说明</div>
              <div className={styles.detail_item_value}>{sku.prodConvNote}</div>
            </div>
          )}
          <div className={styles.detail_item}>
            <div className={styles.detail_item_label}>安全库存</div>
            <div className={styles.detail_item_value}>
              {sku.safetyStock
                ? `${sku.safetyStock} ${sku.stockUnit}`
                : <Tag variant="warning">△ 未设置</Tag>}
            </div>
          </div>
          {sku.qtyOnHand != null && (
            <div className={styles.detail_item}>
              <div className={styles.detail_item_label}>当前库存</div>
              <div className={styles.detail_item_value}>{sku.qtyOnHand} {sku.stockUnit}</div>
            </div>
          )}
        </div>
      </div>

      <div className={styles.detail_section}>
        <div className={styles.detail_section_title}>管控属性</div>
        <div className={styles.detail_grid}>
          <div className={styles.detail_item}>
            <div className={styles.detail_item_label}>业务大类</div>
            <div className={styles.detail_item_value}>
              <Tag variant={getBusinessClassTagVariant(sku.businessClass)}>
                {getBusinessClassLabel(sku.businessClass)}
              </Tag>
            </div>
          </div>
          <div className={styles.detail_item}>
            <div className={styles.detail_item_label}>控制模式</div>
            <div className={styles.detail_item_value}>{getControlModeLabel(sku.controlMode)}</div>
          </div>
          <div className={styles.detail_item}>
            <div className={styles.detail_item_label}>默认仓库类型</div>
            <div className={styles.detail_item_value}>{getDefaultWarehouseTypeLabel(sku.defaultWarehouseType)}</div>
          </div>
          <div className={styles.detail_item}>
            <div className={styles.detail_item_label}>BOM准入</div>
            <div className={styles.detail_item_value}>
              {typeof allowBomComponent === 'boolean' ? (allowBomComponent ? '允许' : '禁止') : '未配置'}
            </div>
          </div>
          <div className={styles.detail_item}>
            <div className={styles.detail_item_label}>允许采购</div>
            <div className={styles.detail_item_value}>
              {typeof allowPurchase === 'boolean' ? (allowPurchase ? '是' : '否') : '未配置'}
            </div>
          </div>
          <div className={styles.detail_item}>
            <div className={styles.detail_item_label}>资产验收要求</div>
            <div className={styles.detail_item_value}>
              {typeof requiresAssetAcceptance === 'boolean' ? (requiresAssetAcceptance ? '必需' : '否') : '未配置'}
            </div>
          </div>
        </div>
      </div>

      {/* 特殊属性 */}
      <div className={styles.detail_section}>
        <div className={styles.detail_section_title}>特殊属性</div>
        <div className={styles.detail_tag_list}>
          {hasDyeLot && <Tag variant="dye-lot">需缸号管理</Tag>}
          {useFifo && <Tag variant="info">FIFO先进先出</Tag>}
          {!hasDyeLot && !useFifo && <span style={{ color: '#9ca3af', fontSize: 13 }}>无特殊属性</span>}
        </div>
      </div>

      {sku.businessClass === 'consumable' && sku.consumableProfile && (
        <div className={styles.detail_section}>
          <div className={styles.detail_section_title}>损耗品档案</div>
          <div className={styles.detail_grid}>
            <div className={styles.detail_item}>
              <div className={styles.detail_item_label}>领用方式</div>
              <div className={styles.detail_item_value}>
                {sku.consumableProfile.issueMode === 'direct_expense' ? '直接费用化' : '部门领用'}
              </div>
            </div>
            <div className={styles.detail_item}>
              <div className={styles.detail_item_label}>审批强度</div>
              <div className={styles.detail_item_value}>{sku.consumableProfile.approvalLevel ?? 'normal'}</div>
            </div>
            <div className={styles.detail_item}>
              <div className={styles.detail_item_label}>费用科目</div>
              <div className={styles.detail_item_value}>{sku.consumableProfile.expenseSubject ?? '—'}</div>
            </div>
            <div className={styles.detail_item}>
              <div className={styles.detail_item_label}>最低库存</div>
              <div className={styles.detail_item_value}>{sku.consumableProfile.minStock ?? '—'}</div>
            </div>
          </div>
        </div>
      )}

      {sku.businessClass === 'fixed_asset' && sku.assetProfile && (
        <div className={styles.detail_section}>
          <div className={styles.detail_section_title}>固定资产档案</div>
          <div className={styles.detail_grid}>
            <div className={styles.detail_item}>
              <div className={styles.detail_item_label}>资产类别</div>
              <div className={styles.detail_item_value}>
                {formatAssetCategoryLabel(sku.assetProfile.assetCategory)}
              </div>
            </div>
            <div className={styles.detail_item}>
              <div className={styles.detail_item_label}>折旧方式</div>
              <div className={styles.detail_item_value}>
                {formatDepreciationMethodLabel(sku.assetProfile.depreciationMethod)}
              </div>
            </div>
            <div className={styles.detail_item}>
              <div className={styles.detail_item_label}>使用寿命(月)</div>
              <div className={styles.detail_item_value}>{sku.assetProfile.usefulLifeMonths ?? '—'}</div>
            </div>
            <div className={styles.detail_item}>
              <div className={styles.detail_item_label}>资本化科目</div>
              <div className={styles.detail_item_value}>{sku.assetProfile.capexSubject ?? '—'}</div>
            </div>
          </div>
        </div>
      )}

      {showBrandingSection && (
        <div className={styles.detail_section}>
          <div className={styles.detail_section_title}>品牌与客户编码</div>
          <div className={styles.detail_grid}>
            <div className={styles.detail_item}>
              <div className={styles.detail_item_label}>品牌归属</div>
              <div className={styles.detail_item_value}>{brandScopeLabel}</div>
            </div>
            <div className={styles.detail_item}>
              <div className={styles.detail_item_label}>所属客户</div>
              <div className={styles.detail_item_value}>{ownerCustomerLabel}</div>
            </div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(sku.customerRefs ?? []).length === 0 && (
              <span style={{ color: '#9ca3af', fontSize: 13 }}>未维护客户侧 SKU 编码映射</span>
            )}
            {(sku.customerRefs ?? []).map((ref) => (
              <div
                key={`${ref.customerId}-${ref.customerSkuCode}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1.2fr 1fr 1fr auto',
                  gap: 8,
                  fontSize: 13,
                  color: '#374151',
                }}
              >
                <span>{ref.customerName ?? customerLabelById.get(Number(ref.customerId)) ?? `客户 #${ref.customerId}`}</span>
                <span>{ref.customerSkuCode}</span>
                <span>{ref.customerSkuName ?? '—'}</span>
                <Tag variant={ref.status === 'active' ? 'success' : 'neutral'}>
                  {ref.status === 'active' ? '启用' : '停用'}
                </Tag>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 备注 */}
      {sku.description && (
        <div className={styles.detail_section}>
          <div className={styles.detail_section_title}>备注</div>
          <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.6 }}>{sku.description}</div>
        </div>
      )}

      {/* 时间戳 */}
      {(sku.createdAt || sku.updatedAt) && (
        <div className={styles.detail_section}>
          <div className={styles.detail_section_title}>时间信息</div>
          <div className={styles.detail_grid}>
            {sku.createdAt && (
              <div className={styles.detail_item}>
                <div className={styles.detail_item_label}>创建时间</div>
                <div className={styles.detail_item_value}>{new Date(sku.createdAt).toLocaleString('zh-CN')}</div>
              </div>
            )}
            {sku.updatedAt && (
              <div className={styles.detail_item}>
                <div className={styles.detail_item_label}>最后更新</div>
                <div className={styles.detail_item_value}>{new Date(sku.updatedAt).toLocaleString('zh-CN')}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
// 子组件：批量导入向导 Modal
// ──────────────────────────────────────────────
interface ImportWizardModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (count: number) => void;
}

// ── 文件解析工具函数（支持 .xlsx / .xls / .csv）──────────────
function parseFileData(buffer: ArrayBuffer, fileName?: string): { headers: string[]; rows: string[][] } {
  const isCsv = fileName ? /\.csv$/i.test(fileName) : false;
  const wb = isCsv
    ? XLSX.read(new TextDecoder('utf-8').decode(buffer), { type: 'string' })
    : XLSX.read(buffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' });

  if (data.length === 0) return { headers: [], rows: [] };

  const headers = data[0].map((h) => String(h).trim());
  const rows = data
    .slice(1)
    .filter((row) => row.some((cell) => String(cell).trim() !== ''))
    .map((row) => row.map((cell) => String(cell).trim()));

  return { headers, rows };
}

type MappingStatus = 'ok' | 'warn' | 'none';

interface FieldMappingRow {
  excelCol: string;
  sysField: string;
  status: MappingStatus;
}

const SYSTEM_FIELDS = [
  'SKU编码', '物料名称', '规格型号', '规格描述', '一级分类', '二级分类', '二级品类',
  '基本单位', '库存单位', '采购单位', '计价单位', '生产领用单位',
  '库存换算系数', '领用换算说明', '安全库存', '状态', '品牌归属',
  '所属客户编码', '所属客户名称', '客户SKU编码', '客户SKU名称', '备注',
] as const;

const CANONICAL_FIELD_ALIASES: Record<string, string> = {
  'SKU编码': 'SKU编码',
  '物料名称': '物料名称',
  '规格型号': '规格描述',
  '规格描述': '规格描述',
  '一级分类': '一级分类',
  '二级分类': '二级品类',
  '二级品类': '二级品类',
  '基本单位': '库存单位',
  '库存单位': '库存单位',
  '采购单位': '采购单位',
  '计价单位': '生产领用单位',
  '生产领用单位': '生产领用单位',
  '库存换算系数': '库存换算系数',
  '领用换算说明': '领用换算说明',
  '安全库存': '安全库存',
  '状态': '状态',
  '品牌归属': '品牌归属',
  '所属客户编码': '所属客户编码',
  '所属客户名称': '所属客户名称',
  '客户SKU编码': '客户SKU编码',
  '客户SKU名称': '客户SKU名称',
  '备注': '备注',
};

const IMPORT_PREVIEW_FIELDS = [
  '物料名称',
  '规格描述',
  '一级分类',
  '二级品类',
  '采购单位',
  '库存单位',
] as const;

function autoMatchField(col: string): { sysField: string; status: MappingStatus } {
  const c = col.toLowerCase();

  // Exact match first
  for (const f of SYSTEM_FIELDS) {
    if (col === f) return { sysField: CANONICAL_FIELD_ALIASES[f] ?? f, status: 'ok' };
  }

  // Fuzzy rules
  if (c.includes('所属客户') && c.includes('编码')) return { sysField: '所属客户编码', status: 'warn' };
  if (c.includes('所属客户') && c.includes('名称')) return { sysField: '所属客户名称', status: 'warn' };
  if (c.includes('客户sku') && c.includes('编码')) return { sysField: '客户SKU编码', status: 'warn' };
  if (c.includes('客户sku') && c.includes('名称')) return { sysField: '客户SKU名称', status: 'warn' };
  if (c.includes('物料') && c.includes('编码')) return { sysField: 'SKU编码', status: 'warn' };
  if (c.includes('名称') || c.includes('品名') || c.includes('name')) return { sysField: '物料名称', status: 'warn' };
  if (c.includes('规格') || c.includes('spec')) return { sysField: '规格描述', status: 'warn' };
  if (c.includes('一级') || c.includes('大类')) return { sysField: '一级分类', status: 'warn' };
  if (c.includes('二级') || c.includes('子类') || c.includes('小类')) return { sysField: '二级品类', status: 'warn' };
  if ((c.includes('库存') && c.includes('单位')) || c.includes('uom')) return { sysField: '库存单位', status: 'warn' };
  if (c.includes('采购') && c.includes('单位')) return { sysField: '采购单位', status: 'warn' };
  if (c.includes('生产') && c.includes('单位')) return { sysField: '生产领用单位', status: 'warn' };
  if (c.includes('库存') && c.includes('换算')) return { sysField: '库存换算系数', status: 'warn' };
  if (c.includes('领用') && c.includes('换算')) return { sysField: '领用换算说明', status: 'warn' };
  if (c.includes('安全') || c.includes('safety')) return { sysField: '安全库存', status: 'warn' };
  if (c.includes('品牌')) return { sysField: '品牌归属', status: 'warn' };
  if (c.includes('备注') || c.includes('remark')) return { sysField: '备注', status: 'warn' };

  return { sysField: '', status: 'none' };
}

function buildAutoMapping(headers: string[]): FieldMappingRow[] {
  return headers.map((col) => {
    const { sysField, status } = autoMatchField(col);
    return { excelCol: col, sysField, status };
  });
}

// ── ImportWizardModal ────────────────────────────
function ImportWizardModal({ open, onClose, onSuccess }: ImportWizardModalProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Parsed CSV state
  const [parsedHeaders, setParsedHeaders] = useState<string[]>([]);
  const [parsedRows, setParsedRows] = useState<string[][]>([]);
  const [fieldMapping, setFieldMapping] = useState<FieldMappingRow[]>([]);

  // Import state
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [importing, setImporting] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{
    imported: number;
    failed: number;
    errors: Array<{ row: number; message: string }>;
  } | null>(null);

  // 重置状态
  const handleClose = useCallback(() => {
    setStep(1);
    setSelectedFile(null);
    setParsedHeaders([]);
    setParsedRows([]);
    setFieldMapping([]);
    setParseError(null);
    setImportResult(null);
    setImporting(false);
    setDownloadingTemplate(false);
    onClose();
  }, [onClose]);

  const handleFileChange = useCallback((file: File | null) => {
    if (!file) return;
    if (!file.name.match(/\.(xlsx|xls|csv)$/i)) return;
    setSelectedFile(file);
    setParseError(null);
  }, []);

  const handleNext = useCallback(() => {
    if (step === 1) {
      if (!selectedFile) return;

      // Parse file client-side when moving from step 1 to step 2
      const reader = new FileReader();
      reader.onload = (e) => {
        const buffer = e.target?.result as ArrayBuffer;
        const { headers, rows } = parseFileData(buffer, selectedFile.name);

        if (headers.length === 0) {
          setParseError('文件内容为空或格式不正确，请检查文件后重试。');
          return;
        }
        if (rows.length === 0) {
          setParseError('文件中没有数据行，请至少包含一行数据。');
          return;
        }

        setParsedHeaders(headers);
        setParsedRows(rows);
        setFieldMapping(buildAutoMapping(headers));
        setParseError(null);
        setStep(2);
      };
      reader.onerror = () => {
        setParseError('文件读取失败，请重新选择文件。');
      };
      reader.readAsArrayBuffer(selectedFile);

    } else if (step === 2) {
      setStep(3);

    } else {
      // Step 3 → confirm import
      if (!selectedFile) return;

      setImporting(true);

      // Build mapping record: excelCol → sysField (only matched ones)
      const mappingRecord: Record<string, string> = {};
      for (const row of fieldMapping) {
        if (row.status !== 'none' && row.sysField) {
          mappingRecord[row.excelCol] = row.sysField;
        }
      }

      skuApi
        .importSkus(selectedFile, mappingRecord)
        .then((res) => {
          const result = {
            imported: res.imported,
            failed: res.failed,
            errors: res.errors ?? [],
          };
          setImportResult(result);
          setImporting(false);
          if (result.imported > 0) {
            onSuccess(result.imported);
          }
        })
        .catch(() => {
          setImportResult({ imported: 0, failed: parsedRows.length, errors: [{ row: 0, message: '服务器异常，请稍后重试' }] });
          setImporting(false);
        });
    }
  }, [step, selectedFile, fieldMapping, parsedRows.length, onSuccess]);

  const stepLabels = ['下载模板', '字段映射', '确认导入'];

  const matchStatusIcon = (s: MappingStatus) => {
    if (s === 'ok')   return <span className={styles.import_match_ok}>✓ 已匹配</span>;
    if (s === 'warn') return <span className={styles.import_match_warn}>⚠ 请确认</span>;
    return <span className={styles.import_match_none}>○ 未映射</span>;
  };

  const warnCount = fieldMapping.filter((m) => m.status === 'warn').length;
  const previewRows = parsedRows.slice(0, 10);

  // Determine column indices for preview table
  const colIndex = (sysField: string) => {
    const match = fieldMapping.find((m) => m.sysField === sysField);
    if (!match) return -1;
    return parsedHeaders.indexOf(match.excelCol);
  };

  const getCellValue = (row: string[], sysField: string): string => {
    const idx = colIndex(sysField);
    return idx >= 0 ? (row[idx] ?? '') : '';
  };

  const handleDownloadTemplate = useCallback(async () => {
    try {
      setDownloadingTemplate(true);
      const blob = await skuApi.downloadImportTemplate();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'SKU导入模板.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingTemplate(false);
    }
  }, []);

  return (
    <Modal
      open={open}
      title="批量导入 SKU"
      onClose={handleClose}
      size="lg"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {importResult ? (
            <Button variant="primary" onClick={handleClose}>关闭</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={handleClose}>取消</Button>
              {step > 1 && !importing && (
                <Button variant="secondary" onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)}>
                  上一步
                </Button>
              )}
              <Button
                variant="primary"
                onClick={handleNext}
                disabled={(step === 1 && !selectedFile) || importing}
              >
                {importing ? '导入中...' : step === 3 ? '确认导入' : '下一步'}
              </Button>
            </>
          )}
        </div>
      }
    >
      {/* 步骤指示器 */}
      <div className={styles.import_stepper}>
        {stepLabels.map((label, i) => {
          const n = (i + 1) as 1 | 2 | 3;
          const isActive = step === n;
          const isDone   = step > n;
          return (
            <div key={n} className={styles.import_step}>
              <div className={`${styles.import_step_circle} ${isDone ? styles['import_step_circle--done'] : isActive ? styles['import_step_circle--active'] : ''}`}>
                {isDone ? '✓' : n}
              </div>
              <span className={`${styles.import_step_label} ${isActive ? styles['import_step_label--active'] : ''}`}>
                {label}
              </span>
              {i < stepLabels.length - 1 && (
                <div className={`${styles.import_step_line} ${isDone ? styles['import_step_line--done'] : ''}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* ── 步骤 1 ── */}
      {step === 1 && (
        <div className={styles.import_step1}>
          <button
            className={styles.import_download_btn}
            type="button"
            onClick={() => void handleDownloadTemplate()}
          >
            <span>⬇</span>
            <span>{downloadingTemplate ? '模板下载中...' : '下载 Excel 导入模板'}</span>
          </button>

          <div className={styles.import_upload_sub}>
            模板已对齐最新 SKU 新增页通用字段；系统编码、业务大类和控制规则会自动生成，无需在导入文件中填写。
          </div>

          <div
            className={`${styles.import_upload_area} ${isDragOver ? styles['import_upload_area--dragover'] : ''}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragOver(false);
              const file = e.dataTransfer.files[0];
              if (file) handleFileChange(file);
            }}
          >
            <div className={styles.import_upload_icon}>📂</div>
            <div className={styles.import_upload_text}>
              <strong>点击选择文件</strong> 或拖拽到此处上传
            </div>
            <div className={styles.import_upload_sub}>支持 .xlsx / .xls / .csv 格式，最大 10MB</div>
            <input
              ref={fileInputRef}
              type="file"
              className={styles.import_upload_input}
              accept=".xlsx,.xls,.csv"
              onChange={(e) => {
                handleFileChange(e.target.files?.[0] ?? null);
                e.target.value = '';
              }}
            />
          </div>

          {selectedFile && (
            <div className={styles.import_file_selected}>
              <span>✓</span>
              <span>已选择：{selectedFile.name}（{(selectedFile.size / 1024).toFixed(1)} KB）</span>
            </div>
          )}

          {parseError && (
            <div style={{ marginTop: 8, color: '#ef4444', fontSize: 13 }}>⚠ {parseError}</div>
          )}
        </div>
      )}

      {/* ── 步骤 2 ── */}
      {step === 2 && (
        <div className={styles.import_step2}>
          <div className={styles.import_mapping_title}>
            已自动识别您的文件字段，请确认映射关系：
          </div>
          <table className={styles.import_mapping_table}>
            <thead>
              <tr>
                <th>您的Excel列名</th>
                <th>系统字段</th>
                <th>匹配状态</th>
              </tr>
            </thead>
            <tbody>
              {fieldMapping.map((row, i) => (
                <tr key={i}>
                  <td>{row.excelCol}</td>
                  <td>{row.sysField || <span style={{ color: '#9ca3af' }}>— 未匹配 —</span>}</td>
                  <td>{matchStatusIcon(row.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={styles.import_summary_bar}>
            <span>共检测到 <strong>{parsedRows.length}</strong> 行数据</span>
            {warnCount === 0 ? (
              <span className={styles.import_summary_ok}>✓ 全部精确匹配</span>
            ) : (
              <span className={styles.import_summary_warn}>⚠ {warnCount} 列为模糊匹配，请确认</span>
            )}
            <button className={styles.import_preview_link} type="button" onClick={() => setStep(3)}>
              查看详细预览 →
            </button>
          </div>
        </div>
      )}

      {/* ── 步骤 3 ── */}
      {step === 3 && (
        <div className={styles.import_step3}>
          {importResult ? (
            // Show result after import
            <div>
              <div className={styles.import_confirm_summary} style={{ marginBottom: 16 }}>
                导入完成：成功 <strong style={{ color: '#16a34a' }}>{importResult.imported}</strong> 条，
                失败 <strong style={{ color: importResult.failed > 0 ? '#ef4444' : 'inherit' }}>{importResult.failed}</strong> 条
              </div>
              {importResult.errors.length > 0 && (
                <table className={styles.import_preview_table}>
                  <thead>
                    <tr>
                      <th>行号</th>
                      <th>错误信息</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importResult.errors.map((err, i) => (
                      <tr key={i}>
                        <td style={{ fontFamily: 'monospace' }}>{err.row === 0 ? '—' : err.row}</td>
                        <td style={{ color: '#ef4444' }}>{err.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : (
            // Show preview before import
            <>
              <div className={styles.import_confirm_summary}>
                即将导入 <strong>{parsedRows.length}</strong> 条 SKU 数据
                {previewRows.length < parsedRows.length && `（预览前 ${previewRows.length} 条）`}
                ，请确认无误后点击「确认导入」。
              </div>
              {importing && (
                <div style={{ textAlign: 'center', padding: '24px 0', color: '#6b7280', fontSize: 14 }}>
                  <div style={{ marginBottom: 8 }}>正在导入，请稍候...</div>
                </div>
              )}
              {!importing && (
                <table className={styles.import_preview_table}>
                  <thead>
                    <tr>
                      {IMPORT_PREVIEW_FIELDS.map((field) => (
                        <th key={field}>{field}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i}>
                        {IMPORT_PREVIEW_FIELDS.map((field) => (
                          <td key={`${field}-${i}`}>{getCellValue(row, field)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
