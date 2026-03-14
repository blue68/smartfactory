import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  UpdateDateColumn, Index,
} from 'typeorm';

/**
 * SKU 类目实体
 *
 * 多租户隔离规则：
 *   - tenant_id = 0  系统预置（只读，不允许删除/修改）
 *   - tenant_id = N  租户自定义（允许增删改）
 *
 * 层级：
 *   - level = 1  一级类目（parent_id = null）
 *   - level = 2  二级类目（parent_id 指向一级类目 id）
 */
@Entity('sku_categories')
@Index('uk_tenant_level_code', ['tenantId', 'level', 'code'], { unique: true })
@Index('idx_tenant_parent', ['tenantId', 'parentId'])
export class SkuCategoryEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', unsigned: true })
  tenantId: number;

  @Column({ type: 'tinyint', unsigned: true, default: 1 })
  level: 1 | 2;

  @Column({ name: 'parent_id', type: 'bigint', unsigned: true, nullable: true })
  parentId: number | null;

  @Column({ length: 50 })
  code: string;

  @Column({ length: 100 })
  name: string;

  @Column({ name: 'sort_order', type: 'smallint', unsigned: true, default: 0 })
  sortOrder: number;

  @Column({ name: 'is_active', type: 'tinyint', unsigned: true, default: 1 })
  isActive: boolean;

  @Column({ type: 'varchar', length: 200, nullable: true })
  remark: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt: Date;

  @Column({ name: 'created_by', type: 'bigint', unsigned: true, default: 0 })
  createdBy: number;

  @Column({ name: 'updated_by', type: 'bigint', unsigned: true, default: 0 })
  updatedBy: number;
}

/**
 * 类目树节点（API 响应 DTO）
 */
export interface CategoryTreeNode {
  id: number;
  tenantId: number;
  level: 1 | 2;
  parentId: number | null;
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  isSystem: boolean;
  remark: string | null;
  /** R01-BE-01: 该类目关联的 SKU 数量（category1_id 或 category2_id 匹配） */
  skuCount: number;
  /** R01-BE-01: 类目创建时间 */
  createdAt: Date | string;
  children?: CategoryTreeNode[];
}
