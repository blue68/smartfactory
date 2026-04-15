import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  UpdateDateColumn, Index,
} from 'typeorm';

@Entity('supplier_prices')
@Index(['tenantId', 'skuId', 'isCurrent'])
@Index(['supplierId', 'skuId'])
export class PriceEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', unsigned: true })
  tenantId: number;

  @Column({ name: 'supplier_id', type: 'bigint', unsigned: true })
  supplierId: number;

  @Column({ name: 'sku_id', type: 'bigint', unsigned: true })
  skuId: number;

  @Column({ type: 'decimal', precision: 14, scale: 4 })
  price: string;

  @Column({ length: 20 })
  unit: string;

  @Column({ name: 'is_current', type: 'tinyint', default: 1 })
  isCurrent: boolean;

  @Column({ name: 'effective_at', type: 'date', nullable: true })
  effectiveAt: string | null;

  @Column({ name: 'expired_at', type: 'date', nullable: true })
  expiredAt: string | null;

  @Column({ type: 'int', unsigned: true, nullable: true })
  moq: number | null;

  @Column({ name: 'purchase_cycle_days', type: 'int', unsigned: true, nullable: true })
  purchaseCycleDays: number | null;

  @Column({ name: 'transport_cycle_days', type: 'int', unsigned: true, nullable: true })
  transportCycleDays: number | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'tax_rate', type: 'decimal', precision: 5, scale: 2, nullable: true })
  taxRate: string | null;

  @Column({ name: 'batch_pricing', type: 'tinyint', default: 0 })
  batchPricing: boolean;

  @Column({ name: 'batch_rule', type: 'varchar', length: 500, nullable: true })
  batchRule: string | null;

  @Column({ name: 'attachment_url', type: 'varchar', length: 500, nullable: true })
  attachmentUrl: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt: Date;

  @Column({ name: 'created_by', type: 'bigint', unsigned: true, default: 0 })
  createdBy: number;

  @Column({ name: 'updated_by', type: 'bigint', unsigned: true, default: 0 })
  updatedBy: number;
}
