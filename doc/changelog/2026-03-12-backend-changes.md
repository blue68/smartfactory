# 后端变更技术总结 — 2026-03-12

作者：senior-backend-engineer
日期：2026-03-12
范围：services/api、Dockerfile、docker-compose.yml

---

## 一、新增模块：文件上传 (upload)

### 1.1 `upload.routes.ts` — 新增

**变更类型：** 新增

**API 端点：**

```
POST /api/upload
Content-Type: multipart/form-data
字段名: file
```

**实现要点：**

- 使用 `multer` + `diskStorage` 将文件存储到磁盘，存储路径通过环境变量 `UPLOAD_DIR` 配置，默认为 `/app/uploads`；路由模块启动时若目录不存在则自动创建（`fs.mkdirSync({ recursive: true })`）。
- 文件命名规则：`{timestamp}-{16字节随机hex}{原始扩展名}`，防止文件名冲突和路径遍历攻击。
- 文件大小上限：10 MB（`limits: { fileSize: 10 * 1024 * 1024 }`）。
- 文件类型白名单（扩展名校验）：`.pdf`、`.jpg`、`.jpeg`、`.png`、`.doc`、`.docx`、`.xls`、`.xlsx`。
- 路由整体挂载 `authMiddleware`，上传接口必须登录后才能调用。
- 成功响应返回 `{ url, originalName, size }`，`url` 格式为 `/uploads/{filename}`，客户端可直接拼接宿主地址访问。

**注意事项：**

- 文件类型白名单仅校验扩展名，不做 MIME 类型或魔数二次校验。如需更严格的安全控制，应叠加 `file.mimetype` 校验或服务端 magic-bytes 检测。
- 上传目录在容器内为 `/app/uploads`，需通过持久化卷挂载（见基础设施章节），否则容器重启后文件丢失。

---

### 1.2 `app.ts` — 修改

**变更类型：** 修改

**变更点：**

1. 新增 `import uploadRoutes from './modules/upload/upload.routes'`。
2. 在 API 路由块末尾注册：`app.use('/api/upload', uploadRoutes)`。
3. 新增静态文件服务，**优先于所有 API 路由注册**：
   ```
   app.use('/uploads', express.static(path.resolve(process.env.UPLOAD_DIR || '/app/uploads')));
   ```

**注意事项：**

- 静态服务不经过 `authMiddleware`，意味着知道完整文件名（含随机 hex 段）即可直接通过 URL 访问文件。当前设计依赖"安全 URL 不可猜测性"做隐式访问控制，适合附件场景；若需要严格鉴权，后续需将静态服务替换为经过认证的文件下载接口。

---

## 二、价格模块 (price)

### 2.1 `price.entity.ts` — 修改

**变更类型：** 修改（新增 6 个字段）

**数据库变更（`supplier_prices` 表新增列）：**

| 字段名         | 列名             | 类型                        | 可空 | 默认值 | 说明               |
|--------------|----------------|---------------------------|------|--------|------------------|
| moq          | moq            | INT UNSIGNED              | 是   | NULL   | 最小起订量           |
| notes        | notes          | TEXT                      | 是   | NULL   | 备注               |
| taxRate      | tax_rate       | DECIMAL(5, 2)             | 是   | NULL   | 税率（%）            |
| batchPricing | batch_pricing  | TINYINT(1)                | 否   | 0      | 是否阶梯定价           |
| batchRule    | batch_rule     | VARCHAR(500)              | 是   | NULL   | 阶梯定价规则（JSON 字符串） |
| attachmentUrl| attachment_url | VARCHAR(500)              | 是   | NULL   | 附件 URL           |

**对应 ALTER TABLE 语句（需手动执行或迁移脚本执行）：**

```sql
ALTER TABLE supplier_prices
  ADD COLUMN moq            INT UNSIGNED     NULL,
  ADD COLUMN notes          TEXT             NULL,
  ADD COLUMN tax_rate       DECIMAL(5,2)     NULL,
  ADD COLUMN batch_pricing  TINYINT(1)       NOT NULL DEFAULT 0,
  ADD COLUMN batch_rule     VARCHAR(500)     NULL,
  ADD COLUMN attachment_url VARCHAR(500)     NULL;
```

---

### 2.2 `price.service.ts` — 修改

**变更类型：** 修改

**变更点：**

1. `CreatePriceParams` 接口新增 6 个可选字段：`moq`、`notes`、`taxRate`、`batchPricing`、`batchRule`、`attachmentUrl`。
2. `list()` 的 `SELECT` 语句补充新增列，保证列表接口返回完整字段。
3. `create()` 和 `update()` 方法均处理新增字段的映射赋值。
4. **moq 0 转 null 处理**：`moq: params.moq || null`——当前端传入 `moq: 0` 时，`0 || null` 结果为 `null`，即"未设置起订量"与"起订量为 0"被视为等价存储为 NULL。这是有意设计，但需要与前端约定好语义（0 和不填均代表无限制）。

**注意事项：**

- `price.entity.ts` 中 `price` 和 `taxRate` 字段类型均声明为 `string`（非 `number`），这是为了规避 **MySQL DECIMAL 字段经 TypeORM 查询后返回 JavaScript `string` 类型** 的行为。务必在所有使用处通过 `parseFloat()` 或 `Number()` 转换后再做数值计算，禁止直接参与算术运算。

---

### 2.3 `price.controller.ts` — 修改

**变更类型：** 修改

**变更点：**

1. `CreateSchema` 新增 6 个字段的 Zod 校验规则：
   - `moq`：`z.number().int().nonnegative().optional()`（**由 `positive()` 改为 `nonnegative()`**，允许传 0）
   - `notes`：`z.string().max(2000).optional()`
   - `taxRate`：`z.string().regex(/^\d{1,3}(\.\d{1,2})?$/).optional()`（字符串格式，匹配 `xx.xx`）
   - `batchPricing`：`z.boolean().optional()`
   - `batchRule`：`z.string().max(500).optional()`
   - `attachmentUrl`：`z.string().max(500).optional()`

**注意事项：**

- `moq` 从 `positive()`（>0）改为 `nonnegative()`（>=0），允许前端传 `0` 表示无起订量限制，需与 `price.service.ts` 中的 `0 || null` 转换保持语义一致。
- `taxRate` 用字符串正则而非 `number`，避免浮点精度问题，与数据库 DECIMAL 存储对应。

---

## 三、供应商模块 (supplier)

### 3.1 `supplier.service.ts` — 修复 + 新增

**变更类型：** 修复（SQL 列名）+ 新增（两个方法）

#### 3.1.1 `getRelatedSkus()` — 新增

**API 端点：** `GET /api/suppliers/:id/skus`

从 `supplier_prices` JOIN `skus` 查询该供应商下所有当前有效价格对应的 SKU 列表。

返回字段：`id`、`skuCode`、`name`、`spec`、`stockUnit`、`purchaseUnit`、`currentPrice`、`priceUnit`、`isMainSupplier`。

**注意事项：**

- MySQL BIGINT 主键经 `AppDataSource.query()` 原生 SQL 返回后为 JavaScript `string` 类型，需通过 `Number(r.id)` 显式转换，否则前端拿到的 id 为字符串，与其他接口返回的数字 id 类型不一致，会导致精确比对失败。

#### 3.1.2 `getPriceAgreements()` — 新增 + 关键修复

**API 端点：** `GET /api/suppliers/:id/price-agreements`

查询该供应商所有价格协议，并计算每条协议的状态（有效 / 即将到期 / 已过期）。

**关键 SQL 列名修复（踩坑记录）：**

原始错误代码中曾使用旧列名，修复后对应关系如下：

| 错误列名（旧）       | 正确列名（现）    | 说明                 |
|-----------------|--------------|----------------------|
| `unit_price`    | `price`      | 单价列                |
| `purchase_unit` | `unit`       | 采购单位列              |
| `valid_from`    | `effective_at` | 生效日期列             |
| `valid_to`      | `expired_at`   | 到期日期列             |

**Date 对象格式化修复（踩坑记录）：**

MySQL `date` 类型字段经 TypeORM / mysql2 驱动返回后，在不同版本/配置下可能为 `Date` 对象或 `string`。

- 错误做法：`String(date)` — 对 `Date` 对象调用会输出类似 `"Thu Jan 01 2026 00:00:00 GMT+0800"` 的本地化字符串，前端无法解析。
- 正确做法：
  ```typescript
  r.validFrom instanceof Date
    ? r.validFrom.toISOString().slice(0, 10)
    : String(r.validFrom).slice(0, 10)
  ```
  始终输出 `YYYY-MM-DD` 格式，兼容两种返回类型。

**状态计算逻辑：**

- `isCurrent = true` 且 `validTo` 为 null 或未来 → `有效`
- `isCurrent = true` 且 `validTo` 在 30 天以内 → `即将到期`
- 其他情况 → `已过期`

---

### 3.2 `supplier.routes.ts` — 修改

**变更类型：** 修改（新增两条路由）

```typescript
router.get('/:id/skus',             asyncHandler(supplierController.getRelatedSkus.bind(...)));
router.get('/:id/price-agreements', asyncHandler(supplierController.getPriceAgreements.bind(...)));
```

**注意事项：**

- 这两条路由必须注册在 `router.get('/:id', ...)` 之后，否则 Express 会将 `skus` / `price-agreements` 路径段误匹配为 `:id` 参数，返回 404 或错误数据。当前文件中的注册顺序已正确。

---

### 3.3 `supplier.controller.ts` — 修改

**变更类型：** 修改（新增两个 Controller 方法）

- `getRelatedSkus()`：取 `req.params.id`，委托 `SupplierService.getRelatedSkus()`。
- `getPriceAgreements()`：取 `req.params.id`，委托 `SupplierService.getPriceAgreements()`。
- 两个方法均通过 `success(res, data)` 统一响应格式返回。

---

## 四、SKU 模块 (sku)

### 4.1 `sku.service.ts` — 修改

**变更类型：** 修改

**变更点：**

`updateSku()` 方法的参数类型从 `Partial<CreateSkuParams>` 扩展为 `Partial<CreateSkuParams> & { status?: 'active' | 'inactive' }`，并在构造 `updateData` 对象时增加 `status` 字段的映射：

```typescript
if (params.status !== undefined) updateData.status = params.status;
```

此前 `updateSku` 不支持通过 PATCH/PUT 接口直接修改 SKU 状态，需要通过批量接口（`batchUpdateStatus`）绕行，本次修复补全了单条 SKU 状态变更能力。

---

### 4.2 `sku.controller.ts` — 修改

**变更类型：** 修改

**变更点：**

`update()` 方法的 `body` Schema 由 `CreateSkuSchema.partial()` 扩展为：

```typescript
CreateSkuSchema.partial().extend({
  status: z.enum(['active', 'inactive']).optional(),
})
```

允许 `PUT /api/skus/:id` 接口携带 `status` 字段，Zod 校验确保值只能为 `active` 或 `inactive`。

---

## 五、基础设施

### 5.1 `Dockerfile` — 修改

**变更类型：** 修改

**变更点（Stage 3 production 镜像）：**

```dockerfile
RUN mkdir -p /app/uploads && chown appuser:appgroup /app/uploads
```

- 在切换到非 root 用户（`USER appuser`）之前，以 root 身份创建 `/app/uploads` 目录并将所有权赋给 `appuser:appgroup`。
- 若缺少此步骤，`appuser` 在运行时将无法写入上传目录，multer 存储文件时会抛出 `EACCES: permission denied` 错误。

---

### 5.2 `docker-compose.yml` — 修改

**变更类型：** 修改

**变更点：**

1. 在 `api` 服务的 `volumes` 列表中新增：
   ```yaml
   - api_uploads:/app/uploads
   ```
2. 在顶层 `volumes` 声明块中新增：
   ```yaml
   api_uploads:
     driver: local
   ```

**说明：**

- `api_uploads` 为具名卷，由 Docker Engine 管理，生命周期独立于容器，容器重建后文件不丢失。
- 若改用 bind mount（`./uploads:/app/uploads`），需确保宿主机目录权限与容器内 UID 1001 对应，部署复杂度更高；具名卷方案更适合 CI/CD 和云环境。

---

## 六、跨模块共性踩坑

### 6.1 MySQL BIGINT 返回 JavaScript string

TypeORM `AppDataSource.query()` 原生 SQL 返回的 BIGINT/BIGINT UNSIGNED 列，mysql2 驱动默认将其序列化为 JavaScript `string`（防止超出 `Number.MAX_SAFE_INTEGER` 精度丢失）。

**影响范围：** 所有使用 `getRawMany()` 或 `query()` 的查询，包括价格模块的 `list()`、供应商的 `getRelatedSkus()`、`getPriceAgreements()` 等。

**处理规范：**

- id 类字段：`Number(r.id)` 转换后返回。
- 当 id 超过 `2^53 - 1`（约 9 千万亿）时，`Number()` 会精度丢失；如需支持超大 id，应将响应字段改为 `string` 类型并与前端约定。

### 6.2 MySQL date 列返回类型不稳定

MySQL `date`/`datetime` 列经 mysql2 返回时，根据驱动版本和 `dateStrings` 配置，可能为 `Date` 对象（默认）或 `string`。

**处理规范（统一模式）：**

```typescript
const formatted = value instanceof Date
  ? value.toISOString().slice(0, 10)
  : String(value).slice(0, 10);
```

不能使用 `String(date)`，因为 Date 对象的 `.toString()` 输出受运行时 locale 影响，格式不可控。

### 6.3 DECIMAL 列的精度与类型

TypeORM 将 MySQL `DECIMAL` 列映射为 TypeScript `string`（非 `number`），以保留精度。

**处理规范：**

- 存储：接受字符串并直接写库，如 `"99.9500"`。
- 计算：先 `parseFloat()` 转换，计算后通过 `.toFixed(N)` 重新格式化为字符串。
- 禁止直接对 DECIMAL 字符串做 `+`、`*` 等算术运算。

---

## 七、变更影响的 API 端点汇总

| 方法   | 路径                                     | 变更类型 | 说明                         |
|------|----------------------------------------|--------|----------------------------|
| POST | /api/upload                            | 新增     | 文件上传，返回文件 URL            |
| GET  | /uploads/{filename}                    | 新增     | 静态文件访问（无需认证）             |
| GET  | /api/prices                            | 修改     | 列表新增 6 个字段               |
| GET  | /api/prices/:id                        | 修改     | 详情新增 6 个字段               |
| POST | /api/prices                            | 修改     | 请求体新增 6 个可选字段             |
| PUT  | /api/prices/:id                        | 修改     | 请求体新增 6 个可选字段             |
| GET  | /api/suppliers/:id/skus                | 新增     | 供应商关联 SKU 列表              |
| GET  | /api/suppliers/:id/price-agreements    | 新增     | 供应商价格协议列表（含状态计算）         |
| PUT  | /api/skus/:id                          | 修改     | 请求体新增 `status` 字段          |

---

## 八、待跟进事项

1. **数据库迁移脚本**：`supplier_prices` 表新增 6 列的 ALTER TABLE 语句需要集成到迁移工具（如 TypeORM Migration 或 Flyway），当前为手动执行，存在生产环境遗漏风险。
2. **上传文件鉴权**：`/uploads/` 静态路径当前无认证，后续如涉及敏感附件，需改为经 JWT 校验的文件下载接口。
3. **上传文件清理**：当前无过期文件清理机制，长期运行后 `api_uploads` 卷容量将持续增长，建议增加定时清理任务或对象存储迁移方案。
4. **BIGINT 前端兼容**：如 id 字段未来可能超过 `Number.MAX_SAFE_INTEGER`，需在响应序列化层统一转为字符串，并通知前端工程师调整类型处理。
