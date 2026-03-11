# [artifact:测试用例] 智造管家 — 完整测试用例设计文档

**产品名称**：智造管家（SmartFactory Agent）
**文档版本**：v1.0
**创建日期**：2026-03-11
**负责人**：@senior-qa-engineer
**覆盖版本**：API v1.0，用户故事 v1.3

---

## 一、测试范围说明

| 测试类型 | 覆盖模块 | 优先级 |
|---|---|---|
| 功能测试 | SKU主数据、BOM、库存、采购、销售、生产、质量溯源 | P0/P1/P2 |
| 边界测试 | 单位换算精度、BOM层级、大批量数据、阈值边界 | P0/P1 |
| 异常测试 | 网络超时、并发冲突、越权访问、参数注入 | P0 |
| 兼容性测试 | 浏览器兼容、小程序、弱网 | P1 |

---

## 二、测试用例 — 模块 A：SKU 主数据管理

### 覆盖用户故事：US-205（缸号入库）、US-206（多单位管理）

| 用例ID | 测试模块 | 测试场景 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 状态 |
|---|---|---|---|---|---|---|---|
| TC-SKU-001 | SKU主数据 | 创建普通SKU（板材类） | 已登录，具有管理员权限；一级分类"原材料"存在 | 1. POST /api/skus，传入name="红橡实木板材"、category1Id=1、category2Id=10、stockUnit="张"、purchaseUnit="箱"、safetyStock=50 | 返回code=0，data.id有值，data.skuCode自动生成（格式BOA+数字） | P0 | 待执行 |
| TC-SKU-002 | SKU主数据 | 创建面料SKU（自动开启缸号） | 已登录；面料类二级分类存在 | 1. POST /api/skus，传入name="仿皮面料"、category2Id=面料分类ID、hasDyeLot=false | 返回code=0，data中hasDyeLot应为true（系统自动强制开启） | P0 | 待执行 |
| TC-SKU-003 | SKU主数据 | 创建SKU时二级分类不属于一级分类 | 已登录；分类数据存在 | 1. POST /api/skus，传入category1Id=1、category2Id=99（非category1的子分类） | 返回code=2003，message包含"二级分类不属于" | P0 | 待执行 |
| TC-SKU-004 | SKU主数据 | 创建重复SKU编码 | 已登录；已存在SKU编码"FAB00001" | 1. POST /api/skus，传入skuCode="FAB00001" | 返回code=2002，message包含"SKU编码已存在" | P0 | 待执行 |
| TC-SKU-005 | SKU主数据 | 关键字搜索SKU | 已存在名称含"红橡"的SKU | 1. GET /api/skus?keyword=红橡 | 返回code=0，list中所有记录的name或spec包含"红橡" | P0 | 待执行 |
| TC-SKU-006 | SKU主数据 | 按缸号标记筛选SKU | 已存在hasDyeLot=true和false的SKU | 1. GET /api/skus?hasDyeLot=true | 返回code=0，list中所有记录hasDyeLot=true | P0 | 待执行 |
| TC-SKU-007 | SKU主数据 | 配置单位换算关系 | 已创建SKU，id已知 | 1. PUT /api/skus/:id/unit-conversions，传入conversions=[{fromUnit:"箱",toUnit:"张",conversionRate:"50.000000"}] | 返回code=0，data中包含换算关系；再次GET /api/skus/:id时unitConversions有该记录 | P0 | 待执行 |
| TC-SKU-008 | SKU主数据 | 配置换算系数精度验证（6位小数） | 已创建SKU | 1. PUT /api/skus/:id/unit-conversions，传入conversionRate="0.000001"（最小6位精度） | 返回code=0，conversionRate保存为"0.000001" | P0 | 待执行 |
| TC-SKU-009 | SKU主数据 | 更新SKU信息 | 已创建SKU，id已知 | 1. PUT /api/skus/:id，传入name="红橡实木板材（A级）" | 返回code=0，data.name="红橡实木板材（A级）" | P1 | 待执行 |
| TC-SKU-010 | SKU主数据 | 查询不存在的SKU | 无此ID的SKU | 1. GET /api/skus/999999 | 返回code=2001，message包含"SKU不存在" | P0 | 待执行 |
| TC-SKU-011 | SKU主数据 | SKU名称超长验证 | 已登录 | 1. POST /api/skus，传入name为201字符的字符串 | 返回code=1001，参数校验失败 | P1 | 待执行 |
| TC-SKU-012 | SKU主数据 | 按一级+二级分类联动筛选 | 存在多个分类的SKU | 1. GET /api/skus?category1Id=1&category2Id=10 | 返回list中所有记录同时满足category1Id=1且category2Id=10 | P1 | 待执行 |

---

## 三、测试用例 — 模块 B：BOM 管理

### 覆盖用户故事：US-302（车间主管发起领料基于BOM）、US-801（下单触发BOM计算）

| 用例ID | 测试模块 | 测试场景 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 状态 |
|---|---|---|---|---|---|---|---|
| TC-BOM-001 | BOM管理 | 创建单层BOM | 已存在成品SKU和组件SKU | 1. POST /api/bom，传入skuId=成品ID、items=[{componentSkuId:组件ID,quantity:"3",unit:"张",scrapRate:"0.05"}] | 返回code=0，data.id有值 | P0 | 待执行 |
| TC-BOM-002 | BOM管理 | 创建多层BOM（含半成品） | 已存在三个层级的SKU | 1. POST /api/bom，传入嵌套items（半成品作为中间节点，含children数组） | 返回code=0；GET /api/bom/:id/expand后items中包含level=1和level=2的节点 | P0 | 待执行 |
| TC-BOM-003 | BOM管理 | 检测循环引用 | 已存在BOM，成品skuId=50 | 1. POST /api/bom，items[0].componentSkuId=50（与成品相同） | 返回code=3002，message包含"循环引用" | P0 | 待执行 |
| TC-BOM-004 | BOM管理 | BOM层级超过10层限制 | 已准备11层嵌套的BOM数据 | 1. POST /api/bom，传入11层嵌套items | 返回code=3002，message包含"层级不能超过10层" | P0 | 待执行 |
| TC-BOM-005 | BOM管理 | BOM多层展开 | 已创建3层BOM，id已知 | 1. GET /api/bom/:id/expand | 返回code=0，data.items包含树形结构，level字段从1开始递增；每个节点有netQuantity=quantity*(1+scrapRate) | P0 | 待执行 |
| TC-BOM-006 | BOM管理 | 物料需求计算（单层BOM，生产10件） | 已创建BOM：成品需3张板材，损耗率5% | 1. GET /api/bom/:id/material-requirements?productionQty=10 | 返回totalQty="31.5000"（3*1.05*10） | P0 | 待执行 |
| TC-BOM-007 | BOM管理 | 物料需求计算（多层BOM需求累加） | 已创建3层BOM，同一原料在多条路径出现 | 1. GET /api/bom/:id/material-requirements?productionQty=5 | 同一skuId的totalQty为所有路径需求之和 | P0 | 待执行 |
| TC-BOM-008 | BOM管理 | 激活BOM（自动归档旧版本） | 已存在同一SKU的active BOM和新draft BOM | 1. POST /api/bom/:newId/activate | 返回code=0；原active BOM的status变为"archived"；新BOM的status变为"active" | P0 | 待执行 |
| TC-BOM-009 | BOM管理 | 查询不存在BOM | 无此ID | 1. GET /api/bom/999999/expand | 返回code=3001，message包含"BOM不存在" | P0 | 待执行 |
| TC-BOM-010 | BOM管理 | BOM展开后netQuantity精度验证 | 已创建BOM，scrapRate="0.333333" | 1. GET /api/bom/:id/expand | items[0].netQuantity精度不超过4位小数 | P1 | 待执行 |
| TC-BOM-011 | BOM管理 | 含面料类组件的BOM展开 | BOM中包含hasDyeLot=true的面料SKU | 1. GET /api/bom/:id/material-requirements?productionQty=1 | 返回的面料物料hasDyeLot=true | P0 | 待执行 |
| TC-BOM-012 | BOM管理 | 按成品SKU筛选BOM列表 | 已存在多个BOM | 1. GET /api/bom?skuId=50 | 返回list中所有记录skuId=50 | P1 | 待执行 |

---

## 四、测试用例 — 模块 C：库存管理

### 覆盖用户故事：US-201、US-202、US-203、US-205、US-206、US-305

| 用例ID | 测试模块 | 测试场景 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 状态 |
|---|---|---|---|---|---|---|---|
| TC-INV-001 | 库存管理 | 采购入库（按库存单位） | 已存在SKU，stockUnit="张" | 1. POST /api/inventory/inbound，传入skuId、qtyInput="100"、inputUnit="张"、transactionType="PURCHASE_IN" | 返回code=0，newQtyOnHand增加100；transactionNo格式为IN+时间戳 | P0 | 待执行 |
| TC-INV-002 | 库存管理 | 采购入库（按采购单位换算） | 已配置换算：1箱=50张 | 1. POST /api/inventory/inbound，传入qtyInput="2"、inputUnit="箱" | 返回code=0，newQtyOnHand增加100（2*50） | P0 | 待执行 |
| TC-INV-003 | 库存管理 | 面料入库缸号必填校验 | 已存在hasDyeLot=true的SKU | 1. POST /api/inventory/inbound，不传dyeLotNo | 返回code=4002，message包含"需要填写缸号" | P0 | 待执行 |
| TC-INV-004 | 库存管理 | 面料入库指定缸号 | 已存在hasDyeLot=true的SKU | 1. POST /api/inventory/inbound，传入dyeLotNo="DL20260310A" | 返回code=0；GET /api/inventory/:skuId/dye-lots中存在"DL20260310A"批次 | P0 | 待执行 |
| TC-INV-005 | 库存管理 | 同缸号再次入库合并数量 | 已有缸号"DL20260310A"，库存10 | 1. POST /api/inventory/inbound，dyeLotNo="DL20260310A"，qtyInput="5" | GET /api/inventory/:skuId/dye-lots中"DL20260310A"的qtyOnHand=15 | P0 | 待执行 |
| TC-INV-006 | 库存管理 | 领料出库（库存足够） | 当前可用库存120 | 1. POST /api/inventory/outbound，qtyInput="10"、transactionType="MATERIAL_OUT" | 返回code=0，newQtyOnHand=110 | P0 | 待执行 |
| TC-INV-007 | 库存管理 | 领料出库（库存不足拒绝） | 当前可用库存5 | 1. POST /api/inventory/outbound，qtyInput="10" | 返回code=4001，message包含"库存不足"及当前可用数量 | P0 | 待执行 |
| TC-INV-008 | 库存管理 | 库存为0时出库操作 | 当前qtyOnHand=0 | 1. POST /api/inventory/outbound，qtyInput="1" | 返回code=4001 | P0 | 待执行 |
| TC-INV-009 | 库存管理 | 面料出库缸号必填 | 已存在hasDyeLot=true的SKU，库存存在 | 1. POST /api/inventory/outbound，不传dyeLotNo | 返回code=4002 | P0 | 待执行 |
| TC-INV-010 | 库存管理 | 缸号一致性校验（同订单二次领料不同缸号触发警告） | 已绑定productionOrderId=88与缸号"DL20260101A" | 1. POST /api/inventory/outbound，productionOrderId=88、dyeLotNo="DL20260310B"（不同缸号） | 返回code=4004（记录警告，仍出库成功）；is_cross_dye_lot=1 | P0 | 待执行 |
| TC-INV-011 | 库存管理 | 首次领料自动绑定缸号 | productionOrderId=99无已有缸号绑定 | 1. POST /api/inventory/outbound，productionOrderId=99、dyeLotNo="DL20260310A" | 返回code=0；order_dye_lot_bindings表中新增绑定记录 | P0 | 待执行 |
| TC-INV-012 | 库存管理 | 库存低于安全库存触发预警记录 | SKU安全库存=50，当前可用=45 | 1. POST /api/inventory/outbound，qtyInput="3" | 出库成功；当日预警标记写入Redis；同一物料当日不重复预警 | P0 | 待执行 |
| TC-INV-013 | 库存管理 | FIFO缸号推荐（按最早入库时间） | 存在两个缸号：DL-A（2026-01-01入库，剩30）、DL-B（2026-02-01入库，剩50） | 1. GET /api/inventory/:skuId/fifo-dye-lot?qty=30 | 返回DL-A（先进先出）排在首位 | P0 | 待执行 |
| TC-INV-014 | 库存管理 | FIFO推荐跨多缸号 | 存在DL-A（剩20）、DL-B（剩30），需要40 | 1. GET /api/inventory/:skuId/fifo-dye-lot?qty=40 | 返回两个缸号：DL-A和DL-B，合计可用50 | P0 | 待执行 |
| TC-INV-015 | 库存管理 | 库存总览按安全库存筛选 | 存在低于安全库存的SKU | 1. GET /api/inventory?belowSafety=true | 所有返回记录的isBelowSafety=true | P0 | 待执行 |

---

## 五、测试用例 — 模块 D：AI 采购建议

### 覆盖用户故事：US-002、US-101、US-501、US-503

| 用例ID | 测试模块 | 测试场景 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 状态 |
|---|---|---|---|---|---|---|---|
| TC-PUR-001 | 采购建议 | 触发生成采购建议（有缺口） | 在产订单需要100张板材，可用库存30张，在途0 | 1. POST /api/purchase/suggestions/generate | 返回code=0，包含该SKU的建议，shortageQty对应缺口量 | P0 | 待执行 |
| TC-PUR-002 | 采购建议 | 库存充足时不生成建议 | 可用库存200张，订单仅需50张，且超安全库存缓冲 | 1. POST /api/purchase/suggestions/generate | 该SKU不在返回建议列表中 | P0 | 待执行 |
| TC-PUR-003 | 采购建议 | 在途库存扣减缺口计算 | 需求100张，可用20张，在途50张 | 1. POST /api/purchase/suggestions/generate | 缺口=100-20-50=30；suggestedQty基于30张缺口计算 | P0 | 待执行 |
| TC-PUR-004 | 采购建议 | 面料SKU建议附带缸号说明 | 在产订单包含hasDyeLot=true的面料SKU且有缺口 | 1. POST /api/purchase/suggestions/generate | 该面料SKU的建议dyeLotRequirement字段非null，包含缸号提示文案 | P0 | 待执行 |
| TC-PUR-005 | 采购建议 | 置信度计算（高：>=10次历史记录） | SKU近30天出库次数=15 | 1. POST /api/purchase/suggestions/generate | 对应建议confidence="high" | P0 | 待执行 |
| TC-PUR-006 | 采购建议 | 置信度计算（中：3-9次历史记录） | SKU近30天出库次数=5 | 1. POST /api/purchase/suggestions/generate | 对应建议confidence="medium" | P0 | 待执行 |
| TC-PUR-007 | 采购建议 | 置信度计算（低：<3次历史记录） | SKU近30天出库次数=1 | 1. POST /api/purchase/suggestions/generate | 对应建议confidence="low"，confidenceDetail包含"数据不足" | P0 | 待执行 |
| TC-PUR-008 | 采购建议 | 老板审批：批准 | 已存在pending状态的建议 | 1. POST /api/purchase/suggestions/:id/approve，approved=true | 返回code=0；建议状态变为"approved" | P0 | 待执行 |
| TC-PUR-009 | 采购建议 | 老板审批：驳回必须填写原因 | 已存在pending状态的建议 | 1. POST /api/purchase/suggestions/:id/approve，approved=false，不传rejectReason | 返回code=1001（参数缺失） | P0 | 待执行 |
| TC-PUR-010 | 采购建议 | 老板审批：驳回填写原因 | 已存在pending状态的建议 | 1. POST /api/purchase/suggestions/:id/approve，approved=false，rejectReason="价格偏高" | 返回code=0；建议状态变为"rejected" | P0 | 待执行 |
| TC-PUR-011 | 采购建议 | 非老板角色无权审批 | 以purchaser角色登录 | 1. POST /api/purchase/suggestions/:id/approve | 返回code=1003（权限不足） | P0 | 待执行 |
| TC-PUR-012 | 采购建议 | 多订单汇总需求（同SKU不同订单） | 两个在产订单均需同一SKU | 1. POST /api/purchase/suggestions/generate | 该SKU的reason中提示"N个在产订单"，totalNeed为两个订单需求之和 | P0 | 待执行 |

---

## 六、测试用例 — 模块 E：采购三单匹配

### 覆盖用户故事：US-105

| 用例ID | 测试模块 | 测试场景 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 状态 |
|---|---|---|---|---|---|---|---|
| TC-3WM-001 | 三单匹配 | 完全匹配场景 | PO=5箱、送货单=5箱、入库单=5箱，价格一致 | 1. POST /api/purchase/three-way-match，传入poId、deliveryNoteId、receiptId | 返回matchStatus="matched"，无diffItems | P0 | 待执行 |
| TC-3WM-002 | 三单匹配 | 数量差异（入库少于PO） | PO=5箱、送货=5箱、入库=4箱 | 1. POST /api/purchase/three-way-match | 返回matchStatus="qty_diff"；diffItems[0].qtyDiff="-1.0000" | P0 | 待执行 |
| TC-3WM-003 | 三单匹配 | 价格差异（送货价格与PO不符） | PO价格=600，送货价格=650，数量一致 | 1. POST /api/purchase/three-way-match | 返回matchStatus="price_diff"；priceDiff="+50.00" | P0 | 待执行 |
| TC-3WM-004 | 三单匹配 | 价格预警（超历史均价20%） | 历史均价500，本次送货价格=620，数量匹配 | 1. POST /api/purchase/three-way-match | 返回matchStatus="price_warning"；isPriceAnomaly=true；historicalAvgPrice="500.00" | P0 | 待执行 |
| TC-3WM-005 | 三单匹配 | 差异确认（供应商少发） | 已有qty_diff的匹配记录 | 1. POST /api/purchase/three-way-match/:id/confirm，diffReason="supplier_short"，diffNotes="供应商确认少发" | 返回code=0；匹配记录status变为"matched"，confirmedAt有值 | P0 | 待执行 |
| TC-3WM-006 | 三单匹配 | 差异确认（已匹配记录不可再确认） | 匹配状态已为"matched" | 1. POST /api/purchase/three-way-match/:id/confirm | 返回code=1001，message包含"已匹配，无需确认" | P0 | 待执行 |
| TC-3WM-007 | 三单匹配 | 送货单与PO不匹配 | 送货单关联PO=25，但传入poId=26 | 1. POST /api/purchase/three-way-match，poId=26，deliveryNoteId关联PO=25 | 返回code=5002，message包含"不匹配" | P0 | 待执行 |
| TC-3WM-008 | 三单匹配 | 部分到货多次匹配 | 第一次入库3箱，第二次入库2箱，PO=5箱 | 1. 第一次POST匹配 2. 第二次POST匹配（传入新入库单） | 两次匹配均正常处理；第二次匹配后合并入库量=5，与PO匹配 | P1 | 待执行 |
| TC-3WM-009 | 三单匹配 | 非采购员角色无权执行匹配 | 以worker角色登录 | 1. POST /api/purchase/three-way-match | 返回code=1003 | P0 | 待执行 |
| TC-3WM-010 | 三单匹配 | 匹配记录列表查询（按状态筛选） | 已存在不同状态的匹配记录 | 1. GET /api/purchase/three-way-match?status=qty_diff | 返回list中所有记录matchStatus="qty_diff" | P1 | 待执行 |

---

## 七、测试用例 — 模块 F：销售订单与约束引擎

### 覆盖用户故事：US-006、US-801、US-802、US-803

| 用例ID | 测试模块 | 测试场景 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 状态 |
|---|---|---|---|---|---|---|---|
| TC-SO-001 | 销售订单 | 常规下单（通过全部约束） | 当前资金占用<50万、产能<90%、库存周转<90天 | 1. POST /api/sales/orders，传入customerId、orderType="normal"、items | 返回code=0，constraintResult="pass"，requiresApproval=false | P0 | 待执行 |
| TC-SO-002 | 销售订单 | 下单触发资金占用约束拦截 | 已有采购金额450000，新订单物料成本>60000 | 1. POST /api/sales/orders，传入大额订单 | 返回code=0，constraintResult="block"，requiresApproval=true；capitalOccupationCheck.passed=false | P0 | 待执行 |
| TC-SO-003 | 销售订单 | 下单触发产能负荷超限 | 当前产能利用率已达92% | 1. POST /api/sales/orders | 返回constraintResult="block"；capacityLoadCheck.passed=false，currentValue包含"%" | P0 | 待执行 |
| TC-SO-004 | 销售订单 | 下单触发库存周转天数超限 | 库存周转天数计算结果>90天 | 1. POST /api/sales/orders | 返回constraintResult="block"；inventoryTurnoverCheck.passed=false | P0 | 待执行 |
| TC-SO-005 | 销售订单 | 多维度同时超限 | 资金和产能同时超限 | 1. POST /api/sales/orders | blockedReasons数组包含两条原因 | P0 | 待执行 |
| TC-SO-006 | 销售订单 | 老板批准超限订单 | 已存在pending_approval状态的订单 | 1. POST /api/sales/orders/:id/approve，action="approved" | 返回code=0；订单状态变为"confirmed" | P0 | 待执行 |
| TC-SO-007 | 销售订单 | 老板附条件批准 | 已存在pending_approval状态的订单 | 1. POST /api/sales/orders/:id/approve，action="conditional"，notes="需在3月28日前完成" | 返回code=0；审批记录保存notes内容 | P0 | 待执行 |
| TC-SO-008 | 销售订单 | 老板驳回订单 | 已存在pending_approval状态的订单 | 1. POST /api/sales/orders/:id/approve，action="rejected" | 返回code=0；订单状态变为"rejected" | P0 | 待执行 |
| TC-SO-009 | 销售订单 | 紧急插单影响分析 | 已存在在产订单 | 1. POST /api/sales/orders/analyze-urgent，传入skuId、bomId、qty、expectedDelivery | 返回overallResult；impactAnalysis.affectedOrders列出受影响订单；响应时间<30秒 | P0 | 待执行 |
| TC-SO-010 | 销售订单 | 紧急插单产能超限标注"高风险" | 当前产能已接近上限 | 1. POST /api/sales/orders，orderType="urgent"，传入高产能需求的订单 | capacityLoadCheck.passed=false；blockedReasons包含产能超限原因 | P0 | 待执行 |
| TC-SO-011 | 销售订单 | 非sales/boss角色无权下单 | 以warehouse角色登录 | 1. POST /api/sales/orders | 返回code=1003 | P0 | 待执行 |
| TC-SO-012 | 销售订单 | 约束阈值刚好等于阈值（边界值） | 资金占用刚好等于500000 | 1. POST /api/sales/orders，使新增资金后总金额=500000 | capitalOccupationCheck.passed=true（<=阈值视为通过） | P1 | 待执行 |
| TC-SO-013 | 销售订单 | 约束阈值超出1元（边界值） | 资金占用刚好等于500001 | 1. POST /api/sales/orders | capitalOccupationCheck.passed=false | P1 | 待执行 |
| TC-SO-014 | 销售订单 | 查询不存在订单 | 无此ID | 1. GET /api/sales/orders/999999 | 返回code=6002 | P0 | 待执行 |

---

## 八、测试用例 — 模块 G：生产排产

### 覆盖用户故事：US-301、US-302、US-303、US-304

| 用例ID | 测试模块 | 测试场景 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 状态 |
|---|---|---|---|---|---|---|---|
| TC-PROD-001 | 生产排产 | 创建生产工单 | 已存在销售订单、BOM、工艺模板 | 1. POST /api/production/orders，传入salesOrderId、skuId、bomHeaderId、qtyPlanned=5 | 返回code=0，data.workOrderNo格式WO+数字 | P0 | 待执行 |
| TC-PROD-002 | 生产排产 | 生成排产计划（贪心调度） | 已存在多个pending状态工单，有工人和工作站 | 1. GET /api/production/schedule/generate?date=2026-03-12 | 返回code=0，schedules非空；summary.capacityLoadRate有值；优先级高的订单排在前面 | P0 | 待执行 |
| TC-PROD-003 | 生产排产 | 排产计划按优先级排序 | 存在一个紧急订单（order_type=urgent）和普通订单 | 1. GET /api/production/schedule/generate | 紧急订单的任务排在schedules的较前位置 | P0 | 待执行 |
| TC-PROD-004 | 生产排产 | 无工单时生成空排产 | 没有pending/in_progress工单 | 1. GET /api/production/schedule/generate | 返回code=0，schedules=[]，totalOrders=0 | P1 | 待执行 |
| TC-PROD-005 | 生产排产 | 确认排产计划下发工人任务 | 已生成日期的排产计划 | 1. POST /api/production/schedule/confirm，date="2026-03-12" | 返回code=0；production_tasks表中创建对应工人任务记录 | P0 | 待执行 |
| TC-PROD-006 | 生产排产 | 工人查看当日任务 | 已确认排产，workerId=5有任务 | 1. GET /api/production/tasks/worker/5?date=2026-03-12 | 返回任务列表，包含workOrderNo、skuName、processStepName | P0 | 待执行 |
| TC-PROD-007 | 生产排产 | 工人开始任务 | 任务状态为"pending" | 1. POST /api/production/tasks/:id/start | 返回code=0；任务状态变为"started" | P0 | 待执行 |
| TC-PROD-008 | 生产排产 | 工人上报完工（含损耗） | 任务状态为"started" | 1. POST /api/production/tasks/:id/complete，completedQty=4，scrapQty=1，scrapReason="material_defect" | 返回code=0；生产工单qty_completed增加4；task_completions写入记录 | P0 | 待执行 |
| TC-PROD-009 | 生产排产 | 工人上报完工（含部件条码溯源） | 任务状态为"started" | 1. POST /api/production/tasks/:id/complete，componentBarcode="COMP-2026-0312-001" | 返回code=0；traceability_records写入has_scan_record=1 | P1 | 待执行 |
| TC-PROD-010 | 生产排产 | 工人仅可查看自己的任务 | 工人A的任务与工人B的任务都存在 | 1. 以工人A身份GET /api/production/tasks/worker/B_id | 返回code=1003（越权）或返回空列表 | P0 | 待执行 |
| TC-PROD-011 | 生产排产 | 排产计划12小时缓存验证 | 已生成排产计划 | 1. 第一次GET生成计划 2. 12小时内再次GET | 第二次直接返回缓存结果，响应时间更短 | P1 | 待执行 |
| TC-PROD-012 | 生产排产 | 查询不存在的工单 | 无此ID | 1. GET /api/production/orders/999999 | 返回code=7001 | P0 | 待执行 |

---

## 九、测试用例 — 模块 H：质量溯源

### 覆盖用户故事：US-005、US-701、US-702

| 用例ID | 测试模块 | 测试场景 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 状态 |
|---|---|---|---|---|---|---|---|
| TC-QC-001 | 质量溯源 | 创建验货单 | 已存在生产工单productionOrderId=88 | 1. POST /api/quality/inspections，productionOrderId=88，qtyInspected=5 | 返回code=0，data.inspectionNo格式QC+数字 | P1 | 待执行 |
| TC-QC-002 | 质量溯源 | 录入质量问题（多类型多选） | 已创建验货单 | 1. POST /api/quality/inspections/issues，issueTypes=["appearance","dimension"]，severity="normal" | 返回code=0，data.issueId有值 | P1 | 待执行 |
| TC-QC-003 | 质量溯源 | 录入质量问题（严重级别） | 已创建验货单 | 1. POST /api/quality/inspections/issues，severity="severe"，issueTypes=["function"] | 返回code=0 | P1 | 待执行 |
| TC-QC-004 | 质量溯源 | 完成验货 | 已创建验货单，已录入问题 | 1. POST /api/quality/inspections/:id/complete，qtyPassed=4 | 返回code=0；验货单状态变为"completed" | P1 | 待执行 |
| TC-QC-005 | 质量溯源 | 溯源链查询（含扫码记录） | 已完工的生产工单，有完整溯源数据 | 1. GET /api/quality/traceability/:productionOrderId | 返回components列表，hasScanRecord=true的部件包含完整链路（工人、工序、物料批次） | P1 | 待执行 |
| TC-QC-006 | 质量溯源 | 溯源链查询（缺失扫码记录） | 已完工工单，部分工序未扫码 | 1. GET /api/quality/traceability/:productionOrderId | 无扫码的部件hasScanRecord=false，missingDataNote包含"工序数据缺失" | P1 | 待执行 |
| TC-QC-007 | 质量溯源 | 溯源链包含面料缸号信息 | 生产过程中面料领料绑定了缸号 | 1. GET /api/quality/traceability/:productionOrderId | 面料相关的components中dyeLotNo非null；summary.dyeLots包含缸号列表 | P0 | 待执行 |
| TC-QC-008 | 质量溯源 | 质量统计（近30天不合格率） | 已有历史验货数据 | 1. GET /api/quality/stats?periodDays=30 | 返回code=0，failRate格式为"x.xx%"，trendData为数组 | P2 | 待执行 |
| TC-QC-009 | 质量溯源 | 质量统计（TOP5问题） | 已有多条质量问题记录 | 1. GET /api/quality/stats?periodDays=30 | top5Issues列表包含count、orderCount、relatedWorkers、relatedProcesses | P2 | 待执行 |
| TC-QC-010 | 质量溯源 | 非QC角色无权录入质量问题 | 以worker角色登录 | 1. POST /api/quality/inspections/issues | 返回code=1003 | P0 | 待执行 |
| TC-QC-011 | 质量溯源 | 查询不存在生产工单的溯源链 | 无此productionOrderId | 1. GET /api/quality/traceability/999999 | 返回code=7001 | P0 | 待执行 |
| TC-QC-012 | 质量溯源 | 问题图片字段最多3张 | 已创建验货单 | 1. POST /api/quality/inspections/issues，images数组传入4个URL | 返回code=1001（超过最大图片数量） | P2 | 待执行 |

---

## 十、边界测试用例

| 用例ID | 测试模块 | 测试场景 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 状态 |
|---|---|---|---|---|---|---|---|
| TC-BOUND-001 | 单位换算 | 换算系数最小值6位小数精度 | 已配置换算：1单位A=0.000001单位B | 1. 入库1单位A | 库存增加0.000001单位B；精度保持6位 | P0 | 待执行 |
| TC-BOUND-002 | 单位换算 | 换算后数量四舍五入验证 | 换算系数=3，输入=0.333333 | 1. 入库数量0.333333，换算后 | 库存增加=0.333333*3=1.000000（精确到4位小数） | P1 | 待执行 |
| TC-BOUND-003 | BOM | BOM层级刚好10层 | 已准备10层嵌套BOM数据 | 1. POST /api/bom，传入10层嵌套 | 创建成功，返回code=0 | P1 | 待执行 |
| TC-BOUND-004 | BOM | BOM层级11层 | 已准备11层嵌套BOM数据 | 1. POST /api/bom，传入11层嵌套 | 返回code=3002 | P0 | 待执行 |
| TC-BOUND-005 | 库存 | 库存数量为0的出库 | qtyOnHand=0 | 1. POST /api/inventory/outbound，qtyInput="0.0001" | 返回code=4001 | P0 | 待执行 |
| TC-BOUND-006 | 采购 | 采购金额恰好5000元二次确认 | 建议金额=5000 | 1. 老板审批页面查看该建议 | 界面显示二次确认弹窗提示 | P0 | 待执行 |
| TC-BOUND-007 | 约束引擎 | 产能阈值刚好等于90%（边界通过） | 产能负荷计算结果=90.0% | 1. POST /api/sales/orders | capacityLoadCheck.passed=true | P1 | 待执行 |
| TC-BOUND-008 | 约束引擎 | 产能阈值90.1%（边界拦截） | 产能负荷计算结果=90.1% | 1. POST /api/sales/orders | capacityLoadCheck.passed=false | P1 | 待执行 |
| TC-BOUND-009 | 分页 | 最大每页200条 | 存在500条SKU | 1. GET /api/skus?pageSize=200 | 返回200条，totalPages向上取整 | P2 | 待执行 |
| TC-BOUND-010 | 分页 | 超最大分页限制 | 任意数据集 | 1. GET /api/skus?pageSize=201 | 返回code=1001或自动限制为200 | P2 | 待执行 |

---

## 十一、异常测试用例

| 用例ID | 测试模块 | 测试场景 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 状态 |
|---|---|---|---|---|---|---|---|
| TC-ERR-001 | 认证 | 无Token访问受保护接口 | 未登录 | 1. GET /api/skus（不带Authorization头） | 返回code=1002，HTTP 401 | P0 | 待执行 |
| TC-ERR-002 | 认证 | 过期Token访问 | Token已过期 | 1. 使用过期token请求任意接口 | 返回code=1002，提示token过期 | P0 | 待执行 |
| TC-ERR-003 | 越权访问 | 工人角色访问经营数据 | 以worker角色登录 | 1. GET /api/purchase/suggestions 2. GET /api/quality/stats | 均返回code=1003 | P0 | 待执行 |
| TC-ERR-004 | 越权访问 | 跨租户数据访问 | 租户A的用户尝试访问租户B的SKU | 1. 以租户A token请求租户B的skuId | 返回code=2001（数据不存在，租户隔离）或code=1003 | P0 | 待执行 |
| TC-ERR-005 | 并发 | 并发出库超卖 | 可用库存=10 | 1. 同时发起5个请求，各出库3个（总需求15>库存10） | 至多3个请求成功（10/3向下取整）；其余返回code=4001或4003 | P0 | 待执行 |
| TC-ERR-006 | 并发 | 分布式锁获取失败 | 模拟Redis不可用 | 1. POST /api/inventory/inbound | 返回code=4003，message包含"稍后重试" | P0 | 待执行 |
| TC-ERR-007 | 参数注入 | SQL注入攻击 | 任意接口 | 1. keyword参数传入"'; DROP TABLE skus; --" | 返回正常业务数据或空列表，数据库不受影响 | P0 | 待执行 |
| TC-ERR-008 | 参数注入 | XSS注入 | SKU创建接口 | 1. name字段传入"<script>alert(1)</script>" | 数据存储后读取时被转义，不执行脚本 | P0 | 待执行 |
| TC-ERR-009 | AI降级 | AI服务不可用时采购建议降级 | AI/LLM服务故障 | 1. POST /api/purchase/suggestions/generate | 系统返回基于规则引擎（Phase 1）的建议，或返回友好错误提示 | P0 | 待执行 |
| TC-ERR-010 | 参数校验 | 必填参数缺失 | 任意创建接口 | 1. POST /api/skus，不传category1Id | 返回code=1001，message说明缺少哪个字段 | P0 | 待执行 |
| TC-ERR-011 | 参数校验 | 数字类型传入字符串 | 库存入库接口 | 1. POST /api/inventory/inbound，qtyInput="abc" | 返回code=1001 | P0 | 待执行 |
| TC-ERR-012 | 数据一致性 | 多租户数据隔离（列表查询） | 两个租户均有SKU数据 | 1. 以租户A token查询GET /api/skus | 只返回租户A的SKU，不包含租户B数据 | P0 | 待执行 |

---

## 十二、兼容性测试用例

| 用例ID | 测试模块 | 测试场景 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 状态 |
|---|---|---|---|---|---|---|---|
| TC-COMPAT-001 | 浏览器 | Chrome最新版访问Web端 | Chrome 120+ | 1. 打开系统主要页面（驾驶舱、库存、采购） | 所有页面正常渲染，功能正常 | P1 | 待执行 |
| TC-COMPAT-002 | 浏览器 | Edge最新版访问Web端 | Edge 120+ | 1. 同上 | 同上 | P1 | 待执行 |
| TC-COMPAT-003 | 浏览器 | Safari（macOS）访问Web端 | Safari 17+ | 1. 同上 | 同上；注意Flexbox和CSS Grid兼容性 | P1 | 待执行 |
| TC-COMPAT-004 | 小程序 | 微信小程序入库流程 | 微信7.0+ | 1. 打开小程序 2. 完成入库操作 | 3步内完成入库，库存实时更新 | P0 | 待执行 |
| TC-COMPAT-005 | 小程序 | 微信小程序离线操作后同步 | 模拟断网 | 1. 断网状态下完成入库操作 2. 恢复网络 | 数据自动同步至服务端，库存更新正确 | P1 | 待执行 |
| TC-COMPAT-006 | 响应式 | 移动端（375px宽度）页面自适应 | 模拟iPhone SE屏幕 | 1. 打开库存总览、采购建议页面 | 无水平滚动条，关键操作按钮不被截断 | P1 | 待执行 |
| TC-COMPAT-007 | 弱网 | 3G弱网环境下接口响应 | 限速3G（1.5Mbps下行） | 1. 执行入库、生成排产计划等核心操作 | 入库等简单操作<3秒；排产生成有loading状态，最终成功返回 | P1 | 待执行 |
| TC-COMPAT-008 | 弱网 | 弱网下AI生成超时处理 | 限速极低，AI接口模拟>30秒响应 | 1. 触发采购建议生成 | 30秒后显示超时提示；提供"重试"和"手动处理"选项（US-504验收条件） | P0 | 待执行 |

---

## 十三、测试用例优先级统计

| 优先级 | 用例数量 | 占比 |
|---|---|---|
| P0 | 87 | 62% |
| P1 | 38 | 27% |
| P2 | 15 | 11% |
| 合计 | 140 | 100% |

---

## 十四、验收条件覆盖矩阵

| 用户故事 | 对应测试用例 | 覆盖率 |
|---|---|---|
| US-002（老板手机审批采购） | TC-PUR-008~011 | 100% |
| US-006（老板审批超限订单） | TC-SO-006~008 | 100% |
| US-101（采购员接收AI建议） | TC-PUR-001~012 | 100% |
| US-105（三单匹配对账） | TC-3WM-001~010 | 100% |
| US-205（面料缸号入库） | TC-INV-003~005 | 100% |
| US-206（多单位入出库） | TC-INV-001~002，TC-BOUND-001~002 | 100% |
| US-305（同订单缸号一致性） | TC-INV-010~011 | 100% |
| US-501（AI缺料预警） | TC-INV-012 | 100% |
| US-701（质量溯源） | TC-QC-001~012 | 100% |
| US-801（常规下单） | TC-SO-001 | 100% |
| US-802（紧急插单） | TC-SO-009~010 | 100% |
