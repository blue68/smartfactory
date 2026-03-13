import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  UpdateDateColumn, Index,
} from 'typeorm';

export type SalesOrderStatus =
  | 'draft'
  | 'pending_approval'
  | 'confirmed'
  | 'in_production'
  | 'shipped'
  | 'completed'
  | 'closed';

/**
 * 销售订单主表实体（R-08）
 * 对应数据库表 sales_orders
 */
@Entity('sales_orders')
@Index(['tenantId', 'orderNo'], { unique: true })
@Index(['tenantId', 'status'])
@Index(['tenantId', 'customerId'])
@Index(['tenantId', 'isUrgent', 'status'])
@Index(['deliveryDate'])
export class SalesOrderEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', unsigned: true })
  tenantId: number;

  @Column({ name: 'order_no', length: 30 })
  orderNo: string;

  @Column({ name: 'customer_id', type: 'bigint', unsigned: true })
  customerId: number;

  @Column({ name: 'order_date', type: 'date' })
  orderDate: string;

  @Column({ name: 'delivery_date', type: 'date' })
  deliveryDate: string;

  @Column({ name: 'is_urgent', type: 'tinyint', width: 1, default: 0 })
  isUrgent: boolean;

  @Column({
    type: 'enum',
    enum: ['draft', 'pending_approval', 'confirmed', 'in_production', 'shipped', 'completed', 'closed'],
    default: 'draft',
  })
  status: SalesOrderStatus;

  @Column({ name: 'total_amount', type: 'decimal', precision: 14, scale: 2, default: '0.00' })
  totalAmount: string;

  @Column({ name: 'approved_by', type: 'bigint', unsigned: true, nullable: true })
  approvedBy: number | null;

  @Column({ name: 'approved_at', type: 'datetime', precision: 3, nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'submit_count', type: 'tinyint', unsigned: true, default: 0 })
  submitCount: number;

  @Column({ name: 'reject_reason', type: 'varchar', length: 500, nullable: true })
  rejectReason: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'created_by', type: 'bigint', unsigned: true, default: 0 })
  createdBy: number;

  @Column({ name: 'updated_by', type: 'bigint', unsigned: true, default: 0 })
  updatedBy: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt: Date;
}
