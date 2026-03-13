import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  UpdateDateColumn, Index,
} from 'typeorm';

@Entity('process_templates')
@Index(['tenantId', 'skuId'])
export class ProcessTemplateEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', unsigned: true })
  tenantId: number;

  @Column({ name: 'sku_id', type: 'bigint', unsigned: true })
  skuId: number;

  @Column({ length: 200 })
  name: string;

  @Column({ type: 'enum', enum: ['active', 'inactive'], default: 'active' })
  status: 'active' | 'inactive';

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt: Date;

  @Column({ name: 'created_by', type: 'bigint', unsigned: true, default: 0 })
  createdBy: number;

  @Column({ name: 'updated_by', type: 'bigint', unsigned: true, default: 0 })
  updatedBy: number;
}

@Entity('process_steps')
@Index(['tenantId', 'templateId'])
export class ProcessStepEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', unsigned: true })
  tenantId: number;

  @Column({ name: 'template_id', type: 'bigint', unsigned: true })
  templateId: number;

  @Column({ name: 'step_no', type: 'smallint' })
  stepNo: number;

  @Column({ name: 'step_name', length: 100 })
  stepName: string;

  @Column({ name: 'standard_hours', type: 'decimal', precision: 8, scale: 4, nullable: true })
  standardHours: string | null;

  /**
   * R-05: 极限工时（小时/件）。NULL 表示不设上限；超出则触发预警。
   * 对应 DDL: ALTER TABLE process_steps ADD COLUMN max_hours DECIMAL(6,2) NULL
   */
  @Column({ name: 'max_hours', type: 'decimal', precision: 6, scale: 2, nullable: true })
  maxHours: string | null;

  @Column({ name: 'workstation_type', type: 'varchar', length: 50, nullable: true })
  workstationType: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt: Date;
}
