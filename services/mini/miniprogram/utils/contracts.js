var TASK_EXCEPTION_TYPE_MAP = {
  material_shortage: '物料缺失',
  quality_issue: '质量异常',
  equipment_failure: '设备故障',
  process_issue: '其他',
  other: '其他',
  物料短缺: '物料缺失',
  物料缺失: '物料缺失',
  质量异常: '质量异常',
  设备异常: '设备故障',
  设备故障: '设备故障',
  工艺异常: '其他',
  其他: '其他'
}

var INBOUND_TRANSACTION_TYPE_MAP = {
  purchase_in: 'PURCHASE_IN',
  production_in: 'PRODUCTION_IN',
  adjustment_in: 'ADJUSTMENT_IN',
  PURCHASE_IN: 'PURCHASE_IN',
  PRODUCTION_IN: 'PRODUCTION_IN',
  ADJUSTMENT_IN: 'ADJUSTMENT_IN'
}

function decimalString(value) {
  if (value === undefined || value === null || value === '') return ''
  var text = String(value).trim().replace(/[^\d.]/g, '')
  var firstDot = text.indexOf('.')
  if (firstDot < 0) return text
  var integerPart = text.slice(0, firstDot) || '0'
  var fractionPart = text.slice(firstDot + 1).replace(/\./g, '').slice(0, 4)
  return fractionPart ? integerPart + '.' + fractionPart : integerPart
}

function optionalDecimalString(value) {
  var text = decimalString(value)
  return text ? text : undefined
}

function optionalText(value) {
  if (value === undefined || value === null) return undefined
  var text = String(value).trim()
  return text ? text : undefined
}

function normalizeTaskIssuePayload(items) {
  return {
    items: (items || []).map(function (item) {
      return {
        skuId: Number(item.skuId),
        qty: decimalString(item.qty),
        unit: optionalText(item.unit),
        warehouseId: item.warehouseId ? Number(item.warehouseId) : undefined,
        locationId: item.locationId ? Number(item.locationId) : undefined,
        dyeLotNo: optionalText(item.dyeLotNo),
        notes: optionalText(item.notes)
      }
    })
  }
}

function normalizeTaskCompletePayload(payload) {
  payload = payload || {}
  return {
    completedQty: decimalString(payload.completedQty),
    actualHours: Number(payload.actualHours),
    scrapQty: optionalDecimalString(payload.scrapQty),
    scrapReason: payload.scrapReason || undefined,
    componentBarcode: optionalText(payload.componentBarcode),
    notes: optionalText(payload.notes),
    images: Array.isArray(payload.images) ? payload.images.filter(Boolean) : undefined
  }
}

function normalizeExceptionPayload(payload) {
  payload = payload || {}
  return {
    type: TASK_EXCEPTION_TYPE_MAP[payload.type] || '其他',
    description: optionalText(payload.description) || '现场异常待补充',
    severity: payload.severity || 'medium',
    affectsProgress: payload.affectsProgress !== false
  }
}

function normalizeInboundPayload(payload) {
  payload = payload || {}
  return {
    skuId: payload.skuId ? Number(payload.skuId) : undefined,
    skuCode: optionalText(payload.skuCode),
    warehouseId: payload.warehouseId ? Number(payload.warehouseId) : undefined,
    locationId: payload.locationId ? Number(payload.locationId) : undefined,
    qtyInput: decimalString(payload.qtyInput),
    inputUnit: optionalText(payload.inputUnit) || '件',
    transactionType: INBOUND_TRANSACTION_TYPE_MAP[payload.transactionType] || 'PURCHASE_IN',
    dyeLotNo: optionalText(payload.dyeLotNo),
    referenceType: optionalText(payload.referenceType),
    referenceId: payload.referenceId ? Number(payload.referenceId) : undefined,
    referenceNo: optionalText(payload.referenceNo),
    batchCost: optionalDecimalString(payload.batchCost),
    notes: optionalText(payload.notes)
  }
}

function normalizeInspectionItems(items) {
  return (items || []).map(function (item) {
    var qtySampled = item.qtySampled !== undefined ? item.qtySampled : item.qtysampled
    return {
      id: item.id ? Number(item.id) : undefined,
      sourceItemIds: Array.isArray(item.sourceItemIds) ? item.sourceItemIds : undefined,
      qtyDelivered: optionalDecimalString(item.qtyDelivered),
      qtysampled: decimalString(qtySampled),
      qtyPassed: decimalString(item.qtyPassed),
      qtyFailed: decimalString(item.qtyFailed),
      acceptedStockQty: optionalDecimalString(item.acceptedStockQty),
      dyeLotNo: optionalText(item.dyeLotNo),
      result: item.result,
      defectImages: Array.isArray(item.defectImages) ? item.defectImages.filter(Boolean) : [],
      disposition: item.disposition,
      notes: optionalText(item.notes)
    }
  })
}

function normalizeStocktakingItems(items) {
  return (items || []).map(function (item) {
    return {
      skuId: Number(item.skuId),
      actualQty: decimalString(item.actualQty),
      notes: optionalText(item.notes)
    }
  })
}

function parseKeyValuePayload(raw) {
  var payload = String(raw || '').trim()
  var result = {}
  if (!payload) return result
  payload.split(/[|&\n;,]/).forEach(function (segment, index) {
    var pair = segment.split('=')
    if (pair.length >= 2) {
      result[String(pair[0]).trim().toUpperCase()] = pair.slice(1).join('=').trim()
    } else if (index === 0) {
      result.RAW = segment.trim()
    }
  })
  return result
}

function parseLocationScanPayload(raw) {
  var payload = String(raw || '').trim()
  var segments = payload.split('|')
  var prefix = String(segments[0] || '').trim().toUpperCase()
  if ((prefix === 'LOC' || prefix === 'LOCATION') && segments.length >= 3) {
    return {
      raw: payload,
      warehouseId: '',
      warehouseCode: String(segments[1] || '').trim(),
      locationId: '',
      locationCode: String(segments[2] || '').trim()
    }
  }
  var kv = parseKeyValuePayload(payload)
  var first = kv.RAW || payload.split(/[|&\n;,]/)[0] || ''
  return {
    raw: payload,
    warehouseId: kv.WAREHOUSE_ID || kv.WH_ID || '',
    warehouseCode: kv.WAREHOUSE_CODE || kv.WH_CODE || kv.WAREHOUSE || kv.WH || '',
    locationId: kv.LOCATION_ID || kv.LOC_ID || kv.SHELF_ID || '',
    locationCode: kv.LOCATION_CODE || kv.LOC_CODE || kv.LOCATION || kv.LOC || kv.SHELF || (first.indexOf('SMART_FACTORY') === 0 ? '' : first)
  }
}

function parseSkuScanPayload(raw) {
  var payload = String(raw || '').trim()
  var kv = parseKeyValuePayload(payload)
  var first = kv.RAW || payload.split(/[|&\n;,]/)[0] || ''
  return {
    raw: payload,
    skuId: kv.SKU_ID || '',
    skuCode: kv.SKU_CODE || kv.SKU || (first.indexOf('SMART_FACTORY') === 0 ? '' : first),
    dyeLotNo: kv.DYE_LOT || kv.BATCH || '',
    deliveryNo: kv.DELIVERY_NO || ''
  }
}

module.exports = {
  decimalString: decimalString,
  normalizeTaskIssuePayload: normalizeTaskIssuePayload,
  normalizeTaskCompletePayload: normalizeTaskCompletePayload,
  normalizeExceptionPayload: normalizeExceptionPayload,
  normalizeInboundPayload: normalizeInboundPayload,
  normalizeInspectionItems: normalizeInspectionItems,
  normalizeStocktakingItems: normalizeStocktakingItems,
  parseLocationScanPayload: parseLocationScanPayload,
  parseSkuScanPayload: parseSkuScanPayload
}
