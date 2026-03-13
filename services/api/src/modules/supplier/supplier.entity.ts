import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  UpdateDateColumn, Index,
} from 'typeorm';

@Entity('suppliers')
@Index(['tenantId', 'code'], { unique: true })
@Index(['tenantId', 'status'])
export class SupplierEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', unsigned: true })
  tenantId: number;

  @Column({ length: 50 })
  code: string;

  @Column({ length: 200 })
  name: string;

  @Column({ type: 'enum', enum: ['A', 'B', 'C', 'D'], default: 'B' })
  grade: 'A' | 'B' | 'C' | 'D';

  @Column({ type: 'enum', enum: ['active', 'inactive'], default: 'active' })
  status: 'active' | 'inactive';

  @Column({ type: 'varchar', length: 100, nullable: true })
  contact: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone: string | null;

  @Column({ name: 'contact_email', type: 'varchar', length: 200, nullable: true })
  contactEmail: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  address: string | null;

  @Column({ name: 'payment_days', type: 'int', nullable: true })
  paymentDays: number | null;

  @Column({ name: 'lead_days', type: 'int', nullable: true })
  leadDays: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  category: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'main_skus', type: 'json', nullable: true })
  mainSkus: number[] | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt: Date;

  @Column({ name: 'created_by', type: 'bigint', unsigned: true, default: 0 })
  createdBy: number;

  @Column({ name: 'updated_by', type: 'bigint', unsigned: true, default: 0 })
  updatedBy: number;
}
