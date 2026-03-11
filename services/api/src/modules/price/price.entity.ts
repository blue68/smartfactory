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

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt: Date;

  @Column({ name: 'created_by', type: 'bigint', unsigned: true, default: 0 })
  createdBy: number;

  @Column({ name: 'updated_by', type: 'bigint', unsigned: true, default: 0 })
  updatedBy: number;
}
