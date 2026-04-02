import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('process_step_materials')
@Index('uk_tenant_template_step_input', ['tenantId', 'templateId', 'stepNo', 'inputSkuId'], { unique: true })
export class ProcessStepMaterialEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', unsigned: true })
  tenantId: number;

  @Column({ name: 'template_id', type: 'bigint', unsigned: true })
  templateId: number;

  @Column({ name: 'step_no', type: 'smallint' })
  stepNo: number;

  @Column({ name: 'input_sku_id', type: 'bigint', unsigned: true })
  inputSkuId: number;

  @Column({ name: 'usage_per_unit', type: 'decimal', precision: 16, scale: 4, default: 0 })
  usagePerUnit: string;

  @Column({ name: 'loss_rate', type: 'decimal', precision: 8, scale: 4, default: 0 })
  lossRate: string;

  @Column({ name: 'consume_timing', type: 'enum', enum: ['start', 'complete'], default: 'start' })
  consumeTiming: 'start' | 'complete';

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt: Date;

  @Column({ name: 'created_by', type: 'bigint', unsigned: true, default: 0 })
  createdBy: number;

  @Column({ name: 'updated_by', type: 'bigint', unsigned: true, default: 0 })
  updatedBy: number;
}
