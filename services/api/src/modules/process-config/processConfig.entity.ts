import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  UpdateDateColumn, Index,
} from 'typeorm';

@Entity('process_templates')
@Index(['tenantId', 'skuId'])
@Index(['tenantId', 'baseTemplateId'])
export class ProcessTemplateEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', unsigned: true })
  tenantId: number;

  @Column({ name: 'sku_id', type: 'bigint', unsigned: true, nullable: true })
  skuId: number | null;

  @Column({ name: 'base_template_id', type: 'bigint', unsigned: true, nullable: true })
  baseTemplateId!: number | null;

  @Column({ length: 200 })
  name: string;

  @Column({ type: 'enum', enum: ['active', 'inactive'], default: 'active' })
  status: 'active' | 'inactive';

  @Column({ name: 'is_default', type: 'tinyint', width: 1, default: 0 })
  isDefault!: boolean;

  @Column({ name: 'template_type', type: 'enum', enum: ['standard', 'custom', 'trial'], default: 'standard' })
  templateType!: 'standard' | 'custom' | 'trial';

  @Column({ name: 'version', type: 'varchar', length: 20, default: '1.0' })
  version!: string;

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

  @Column({ name: 'guide_text', type: 'text', nullable: true })
  guideText: string | null;

  @Column({ name: 'guide_attachment_url', type: 'varchar', length: 500, nullable: true })
  guideAttachmentUrl: string | null;

  @Column({ name: 'guide_attachment_name', type: 'varchar', length: 255, nullable: true })
  guideAttachmentName: string | null;

  @Column({ name: 'workstation_type', type: 'varchar', length: 50, nullable: true })
  workstationType: string | null;

  @Column({ name: 'workstation_id', type: 'bigint', unsigned: true, nullable: true })
  workstationId: number | null;

  @Column({
    name: 'execution_mode',
    type: 'enum',
    enum: ['internal', 'outsource'],
    default: 'internal',
  })
  executionMode: 'internal' | 'outsource';

  @Column({
    name: 'output_type',
    type: 'enum',
    enum: ['semi_finished', 'final_product', 'none'],
    default: 'none',
  })
  outputType: 'semi_finished' | 'final_product' | 'none';

  @Column({ name: 'output_sku_id', type: 'bigint', unsigned: true, nullable: true })
  outputSkuId: number | null;

  @Column({ name: 'predecessor_step_nos_json', type: 'json', nullable: true })
  predecessorStepNosJson: number[] | null;

  @Column({ name: 'route_group_key', type: 'varchar', length: 120, nullable: true })
  routeGroupKey: string | null;

  @Column({ name: 'route_level', type: 'smallint', nullable: true })
  routeLevel: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt: Date;
}
