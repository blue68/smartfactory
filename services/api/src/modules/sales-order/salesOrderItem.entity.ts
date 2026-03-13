import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  UpdateDateColumn, Index,
} from 'typeorm';

/**
 * 销售订单明细行实体（R-08）
 * 对应数据库表 sales_order_items
 */
@Entity('sales_order_items')
@Index(['tenantId', 'orderId'])
@Index(['tenantId', 'skuId'])
export class SalesOrderItemEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', unsigned: true })
  tenantId: number;

  @Column({ name: 'order_id', type: 'bigint', unsigned: true })
  orderId: number;

  @Column({ name: 'sku_id', type: 'bigint', unsigned: true })
  skuId: number;

  /**
   * 数量：使用 DECIMAL(14,3) 支持小数，与 SQL DDL 保持一致
   * 存储为字符串防止浮点精度丢失
   */
  @Column({ type: 'decimal', precision: 14, scale: 3 })
  quantity: string;

  @Column({ name: 'unit_price', type: 'decimal', precision: 14, scale: 2 })
  unitPrice: string;

  /** 行金额 = quantity * unit_price，由 Service 层计算写入 */
  @Column({ type: 'decimal', precision: 14, scale: 2 })
  amount: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  notes: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt: Date;
}
