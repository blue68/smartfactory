import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  UpdateDateColumn, Index,
} from 'typeorm';

export type SkuBrandScope = 'factory' | 'customer';

@Entity('skus')
@Index(['tenantId', 'skuCode'], { unique: true })
@Index(['tenantId', 'category1Id'])
@Index(['tenantId', 'category2Id'])
export class SkuEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', unsigned: true })
  tenantId: number;

  @Column({ name: 'sku_code', length: 50 })
  skuCode: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  barcode: string | null;

  @Column({ length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  spec: string | null;

  @Column({ name: 'category1_id', type: 'bigint', unsigned: true })
  category1Id: number;

  @Column({ name: 'category2_id', type: 'bigint', unsigned: true })
  category2Id: number;

  @Column({ name: 'stock_unit', length: 20 })
  stockUnit: string;

  @Column({ name: 'purchase_unit', length: 20 })
  purchaseUnit: string;

  @Column({ name: 'production_unit', length: 20 })
  productionUnit: string;

  @Column({ name: 'brand_scope', type: 'enum', enum: ['factory', 'customer'], default: 'factory' })
  brandScope: SkuBrandScope;

  @Column({ name: 'brand_customer_id', type: 'bigint', unsigned: true, nullable: true })
  brandCustomerId: number | null;

  @Column({ name: 'stock_conv_factor', type: 'decimal', precision: 10, scale: 4, default: 1 })
  stockConvFactor: number;

  @Column({ name: 'prod_conv_note', type: 'varchar', length: 200, nullable: true })
  prodConvNote: string | null;

  @Column({ name: 'has_dye_lot', type: 'tinyint', default: 0 })
  hasDyeLot: boolean;

  @Column({ name: 'use_fifo', type: 'tinyint', default: 1 })
  useFifo: boolean;

  @Column({ name: 'safety_stock', type: 'decimal', precision: 12, scale: 4, default: 0 })
  safetyStock: string;

  @Column({ type: 'enum', enum: ['active', 'inactive'], default: 'active' })
  status: 'active' | 'inactive';

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt: Date;

  @Column({ name: 'created_by', type: 'bigint', unsigned: true, default: 0 })
  createdBy: number;

  @Column({ name: 'updated_by', type: 'bigint', unsigned: true, default: 0 })
  updatedBy: number;
}
