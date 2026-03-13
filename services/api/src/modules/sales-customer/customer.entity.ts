import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  UpdateDateColumn, Index,
} from 'typeorm';

export type CustomerGrade = 'VIP' | 'A' | 'B' | 'C';
export type CustomerStatus = 'active' | 'inactive';

/**
 * 销售客户主数据实体（R-07）
 * 对应数据库表 customers
 */
@Entity('customers')
@Index(['tenantId', 'code'], { unique: true })
@Index(['tenantId', 'status'])
@Index(['tenantId', 'grade'])
export class CustomerEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', unsigned: true })
  tenantId: number;

  @Column({ length: 50 })
  code: string;

  @Column({ length: 200 })
  name: string;

  @Column({ type: 'enum', enum: ['VIP', 'A', 'B', 'C'], default: 'B' })
  grade: CustomerGrade;

  @Column({ type: 'varchar', length: 100, nullable: true })
  contact: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  address: string | null;

  @Column({ name: 'credit_limit', type: 'decimal', precision: 14, scale: 2, nullable: true })
  creditLimit: string | null;

  @Column({ name: 'payment_days', type: 'int', nullable: true })
  paymentDays: number | null;

  @Column({ type: 'enum', enum: ['active', 'inactive'], default: 'active' })
  status: CustomerStatus;

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
