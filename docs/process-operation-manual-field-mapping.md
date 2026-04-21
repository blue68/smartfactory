[artifact:ImplementationPlan]
status: READY
owner: senior-backend-engineer
scope:
- 作业工序说明书字段映射
- 规范化解析脚本落地说明
inputs:
- `/Users/kongwen/Desktop/04-技术与设计/技术资料/作业工序带定尺木材尺寸-12.26-1.xlsm`
- `/Users/kongwen/Desktop/数据初始化/工序数据/standard_procedures_enabled_summary_with_pricing.xlsx`
deliverables:
- 说明书列到系统字段的映射口径
- 规范化解析脚本运行方式
risks:
- 说明书中的“工艺”列同时承担路线、产出和加工动作语义，后续真正自动导入时仍需按模板分组再做一次业务确认
handoff_to:
- senior-backend-engineer
- senior-frontend-engineer
exit_criteria:
- 说明书数据可被稳定解析成“步骤 + 步骤投料 + 工艺参数”的中间结构

goal:
- 把打样师傅输出的作业工序说明书，映射到当前系统已支持的 `工序模板 / 工序步骤 / 步骤投料 / 工单快照 / 生产任务展示` 结构。

changed_areas:
- `services/api/scripts/normalize-process-manual.js`
- 本文档

steps:
- 读取工序说明书主文件，识别 1-7 级物料结构块。
- 读取启用工序汇总表，建立工序编码、工价、标准工时、极限工时 lookup。
- 将说明书行规范化为：
  - 产品
  - 步骤
  - 步骤投料
  - 规格说明
  - 工艺参数 JSON
- 输出 JSON 中间件，为下一步自动导入做准备。

validation:
- 用真实说明书和启用工序汇总表跑一遍解析脚本，确认能输出产品、步骤、投料统计摘要。

## 1. 当前系统建议承载位

### 1.1 工序模板 / 工序步骤
- `process_templates`
- `process_steps`

建议映射：
- 说明书中的“工艺”列 -> `process_steps.step_name`
- 启用工序汇总中的：
  - `工序名称` -> `process_steps.step_name` 标准名
  - `单价(元/件)` -> `process_wages.unit_price`
  - `标准工时(秒)` -> `process_steps.standard_hours`
  - `极限工时(秒)` -> `process_steps.max_hours`

### 1.2 步骤投料
- `process_step_materials`

建议映射：
- `名称` -> `input_sku_id` 对应的 SKU 名称
- `用量` -> `usage_per_unit`
- `尺寸` -> `spec_text`
- `材料属性` -> `process_params_json.materialAttr`
- 其他尺寸、门幅、面积、公式类信息 -> `process_params_json`

### 1.3 工单快照 / 生产任务
- `production_orders.process_snapshot`
- `production_tasks` 详情页

当前已支持把以下内容冻结并展示：
- 步骤名称
- 作业说明
- 操作附件
- 步骤投料
- 规格说明
- 工艺参数 JSON

## 2. 说明书列映射

### 2.1 说明书主文件
文件：
- `作业工序带定尺木材尺寸-12.26-1.xlsm`

表头结构：
- A/B：产品上下文
- 第 1~7 级物料块：每级包含 `工艺 / 物料编码 / 名称 / 尺寸 / 用量`
- 第 3 级物料块额外含 `材料属性`

规范化脚本当前按以下列位解析：

| 层级 | 工艺列 | 编码列 | 名称列 | 尺寸列 | 用量列 | 材料属性列 |
| --- | --- | --- | --- | --- | --- | --- |
| 1级 | C | D | E | F | G | - |
| 2级 | H | I | J | L | K | - |
| 3级 | T | N | P | S | Q | R |
| 4级 | Y | U | V | W | X | - |
| 5级 | AD | Z | AA | AB | AC | - |
| 6级 | AI | AE | AF | AG | AH | - |
| 7级 | AN | AJ | AK | AM | AL | - |

说明：
- 这里的 Excel 列名只是为了人工核对，脚本内部实际按列序号解析。
- 同一行可能同时携带多级信息，脚本会转成树状节点，并按首次出现顺序生成步骤集合。

### 2.2 启用工序汇总表
文件：
- `standard_procedures_enabled_summary_with_pricing.xlsx`

字段映射：

| 源列 | 系统用途 |
| --- | --- |
| 工序编码 | 规范化输出中的 `catalogMatch.procedureCode` |
| 工序名称 | 标准步骤名 lookup |
| 工序描述 | 可补充进 `guide_text` |
| 单价(元/件) | `process_wages.unit_price` |
| 标准工时(秒) | `process_steps.standard_hours` |
| 极限工时(秒) | `process_steps.max_hours` |

## 3. 规范化脚本

脚本：
- [normalize-process-manual.js](/Users/kongwen/claude_wk/ai-software-company/services/api/scripts/normalize-process-manual.js:1)

运行方式：

```bash
cd /Users/kongwen/claude_wk/ai-software-company
node services/api/scripts/normalize-process-manual.js \
  --manual "/Users/kongwen/Desktop/04-技术与设计/技术资料/作业工序带定尺木材尺寸-12.26-1.xlsm" \
  --catalog "/Users/kongwen/Desktop/数据初始化/工序数据/standard_procedures_enabled_summary_with_pricing.xlsx" \
  --out /tmp/process-manual-normalized.json
```

输出 JSON 结构：

```json
{
  "summary": {
    "productCount": 0,
    "totalSteps": 0,
    "totalMaterials": 0,
    "catalogProcedureCount": 0,
    "unmatchedStepNames": []
  },
  "products": [
    {
      "skuCode": "BF001-01-WH01-Q",
      "skuName": "有护翼密竖条纹QK款床头带软包（WH,BE,BL)",
      "section": "床头",
      "steps": [
        {
          "stepOrder": 1,
          "stepName": "扪制",
          "catalogMatch": {
            "procedureCode": "OPxxxxxx"
          },
          "materials": [
            {
              "level": 1,
              "code": null,
              "name": "床头木架（已贴棉）",
              "specText": "1530*580*72",
              "usageQty": 1,
              "processParams": null
            }
          ]
        }
      ]
    }
  ]
}
```

## 4. 当前建议推进顺序

1. 先跑规范化脚本，形成中间 JSON。
2. 抽样核对：
   - 步骤顺序
   - 步骤匹配到的工价/工时
   - 步骤投料的规格说明和工艺参数
3. 再做自动导入：
   - `process_steps`
   - `process_step_materials`
   - `process_wages`
4. 最后在工单快照和生产任务页验证冻结/展示效果。

## 5. 自动导入脚本

脚本：
- [import-process-manual.js](/Users/kongwen/claude_wk/ai-software-company/services/api/scripts/import-process-manual.js:1)

dry-run：

```bash
node services/api/scripts/import-process-manual.js \
  --tenant-code FACTORY002 \
  --manual "/Users/kongwen/Desktop/04-技术与设计/技术资料/作业工序带定尺木材尺寸-12.26-1.xlsm" \
  --catalog "/Users/kongwen/Desktop/数据初始化/工序数据/standard_procedures_enabled_summary_with_pricing.xlsx" \
  --out /tmp/process-manual-import-report.json
```

apply：

```bash
node services/api/scripts/import-process-manual.js \
  --tenant-code FACTORY002 \
  --target-sku-code Z450000010 \
  --manual "/Users/kongwen/Desktop/04-技术与设计/技术资料/作业工序带定尺木材尺寸-12.26-1.xlsm" \
  --catalog "/Users/kongwen/Desktop/数据初始化/工序数据/standard_procedures_enabled_summary_with_pricing.xlsx" \
  --apply \
  --out /tmp/process-manual-import-report.json
```

如果说明书源编码和系统正式 `sku_code` 不一致，可提供映射 JSON：

```json
{
  "BF001-01-WH01-Q": "Z450000010",
  "有护翼密竖条纹QK款床头带软包（WH,BE,BL)": "Z450000010"
}
```

然后执行：

```bash
node services/api/scripts/import-process-manual.js \
  --tenant-code FACTORY002 \
  --sku-map /tmp/sku-map.json \
  --manual "/Users/kongwen/Desktop/04-技术与设计/技术资料/作业工序带定尺木材尺寸-12.26-1.xlsm" \
  --catalog "/Users/kongwen/Desktop/数据初始化/工序数据/standard_procedures_enabled_summary_with_pricing.xlsx" \
  --apply
```

## 6. 边界说明

- 当前脚本只做“规范化解析”，不直接写库。
- 自动导入时，若根 SKU 无法命中，导入器会中止该产品写入并在报告中列出 `unresolvedRoots`。
- 说明书里的工艺字段存在以下混合语义：
  - 工艺动作
  - 工序产出
  - 中间半成品状态
- 所以后续自动导入到模板前，仍建议先对关键 SKU 抽样校对一次，尤其是：
  - `床头 / 床侧 / 床尾 / 护翼`
  - 面料和海绵裁剪
  - 开料 / 打孔 / 钉打 / 扪制 / 车缝
