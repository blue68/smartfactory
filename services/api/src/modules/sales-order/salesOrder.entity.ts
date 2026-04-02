import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  UpdateDateColumn, Index,
} from 'typeorm';

export type SalesOrderStatus =
  | 'draft'
  | 'pending_approval'
  | 'confirmed'
  | 'in_production'
  | 'produced'
  | 'partial_shipped'
  | 'shipped'
  | 'completed'
  | 'closed'
  | 'cancelled';

/**
 * 销售订单主表实体（R-08）
 * 对应数据库表 sales_orders
 */
@Entity('sales_orders')
@Index(['tenantId', 'orderNo'], { unique: true })
@Index(['tenantId', 'status'])
@Index(['tenantId', 'customerId'])
export class SalesOrderEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', unsigned: true })
  tenantId: number;

  @Column({ name: 'order_no', length: 50 })
  orderNo: string;

  @Column({ name: 'customer_id', type: 'bigint', unsigned: true })
  customerId: number;

  @Column({ name: 'order_type', type: 'enum', enum: ['normal', 'urgent'], default: 'normal' })
  orderType: 'normal' | 'urgent';

  @Column({
    type: 'enum',
    enum: [
      'draft',
      'pending_approval',
      'confirmed',
      'in_production',
      'produced',
      'partial_shipped',
      'shipped',
      'completed',
      'closed',
      'cancelled',
    ],
    default: 'draft',
  })
  status: SalesOrderStatus;

  @Column({ type: 'smallint', default: 50 })
  priority: number;

  @Column({ name: 'expected_delivery', type: 'date' })
  deliveryDate: string;

  @Column({ name: 'estimated_delivery', type: 'date', nullable: true })
  estimatedDelivery: string | null;

  @Column({ name: 'total_amount', type: 'decimal', precision: 16, scale: 2, default: '0.00' })
  totalAmount: string;

  @Column({ name: 'constraint_passed', type: 'tinyint', width: 1, default: 0 })
  constraintPassed: boolean;

  @Column({ name: 'approval_status', type: 'enum', enum: ['not_required', 'pending', 'approved', 'rejected', 'conditional'], default: 'not_required' })
  approvalStatus: string;

  @Column({ name: 'approved_by', type: 'bigint', unsigned: true, nullable: true })
  approvedBy: number | null;

  @Column({ name: 'approved_at', type: 'datetime', precision: 3, nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'approval_notes', type: 'text', nullable: true })
  approvalNotes: string | null;

  @Column({ name: 'sales_person_id', type: 'bigint', unsigned: true })
  salesPersonId: number;

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
