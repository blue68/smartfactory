import request from './request'

export interface PageResult<T> {
  list: T[]
  total?: number
  page?: number
  pageSize?: number
}

export interface WarehouseOption {
  id: number
  name: string
  code?: string
}

export interface LocationOption {
  id: number
  name: string
  code?: string
  warehouseId?: number
}

export interface SkuOption {
  id?: number
  skuId?: number
  skuCode: string
  code?: string
  name: string
  stockUnit?: string
  purchaseUnit?: string
  unit?: string
}

export interface ProductionTask {
  id: number
  taskNo?: string
  workOrderNo?: string
  productionOrderNo?: string
  stepName?: string
  processName?: string
  skuName?: string
  skuCode?: string
  plannedQty?: number
  completedQty?: number
  unit?: string
  status: string
  standardHours?: number
  inputMaterials?: TaskMaterial[]
  outputMaterials?: TaskMaterial[]
}

export interface TaskMaterial {
  id?: number
  skuId?: number
  skuCode?: string
  name?: string
  skuName?: string
  qty?: number
  requiredQty?: number
  unit?: string
}

export interface IncomingInspection {
  id: number
  inspectionNo?: string
  purchaseOrderNo?: string
  supplierName?: string
  status: string
  overallResult?: string
  items?: IncomingInspectionItem[]
}

export interface IncomingInspectionItem {
  id?: number
  sourceItemIds?: number[]
  skuId?: number
  skuCode?: string
  skuName?: string
  name?: string
  qtyDelivered?: number
  qtySampled?: number
  qtyPassed?: number
  qtyFailed?: number
  acceptedStockQty?: number
  dyeLotNo?: string
  unit?: string
  result?: string
  defectTypes?: string[]
  defectImages?: string[]
  disposition?: string
  notes?: string
}

export function getSkuId(sku: SkuOption): number | undefined {
  return sku.id ?? sku.skuId
}

export const productionTaskApi = {
  list(params?: Record<string, unknown>) {
    return request.get<PageResult<ProductionTask>>('/api/production/tasks', params)
  },
  detail(id: number) {
    return request.get<ProductionTask>(`/api/production/tasks/${id}`)
  },
  start(id: number) {
    return request.post<void>(`/api/production/tasks/${id}/start`)
  },
  issueMaterials(id: number, items: unknown[]) {
    return request.post<void>(`/api/production/tasks/${id}/issue-materials`, { items })
  },
  complete(id: number, payload: unknown) {
    return request.post<void>(`/api/production/tasks/${id}/complete-v2`, payload)
  },
  reportException(id: number, payload: unknown) {
    return request.post<void>(`/api/production/tasks/${id}/exception`, payload)
  },
}

export const incomingInspectionApi = {
  list(params?: Record<string, unknown>) {
    return request.get<PageResult<IncomingInspection>>('/api/incoming-inspections', params)
  },
  detail(id: number) {
    return request.get<IncomingInspection>(`/api/incoming-inspections/${id}`)
  },
  updateItems(id: number, items: unknown[]) {
    return request.put<void>(`/api/incoming-inspections/${id}/items`, { items })
  },
  submit(id: number, payload: unknown) {
    return request.post<void>(`/api/incoming-inspections/${id}/submit`, payload)
  },
}

export const inventoryApi = {
  warehouses() {
    return request.get<WarehouseOption[]>('/api/inventory/warehouses', { onlyActive: true })
  },
  locations(warehouseId: number) {
    return request.get<LocationOption[]>('/api/inventory/locations', { warehouseId, onlyActive: true })
  },
  inbound(payload: unknown) {
    return request.postWithLockRetry<void>('/api/inventory/inbound', payload)
  },
}

export const skuApi = {
  search(keyword: string) {
    return request.get<PageResult<SkuOption>>('/api/skus', { page: 1, pageSize: 20, keyword })
  },
}
