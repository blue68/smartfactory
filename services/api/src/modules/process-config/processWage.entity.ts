import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  UpdateDateColumn, Index,
} from 'typeorm';

/**
 * 工序工价实体
 *
 * 唯一约束 uk_tenant_step_grade 保证：
 *   同一租户 + 同一工序步骤 + 同一工人等级 只允许一条有效记录
 *   写入时使用 UPSERT（INSERT ... ON DUPLICATE KEY UPDATE）
 */
@Entity('process_wages')
@Index('uk_tenant_step_grade', ['tenantId', 'stepId', 'workerGrade'], { unique: true })
@Index('idx_tenant_step', ['tenantId', 'stepId'])
export class ProcessWageEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', unsigned: true })
  tenantId: number;

  @Column({ name: 'step_id', type: 'bigint', unsigned: true })
  stepId: number;

  @Column({
    name: 'worker_grade',
    type: 'enum',
    enum: ['skilled', 'apprentice'],
  })
  workerGrade: 'skilled' | 'apprentice';

  @Column({ name: 'unit_price', type: 'decimal', precision: 10, scale: 2, default: 0 })
  unitPrice: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt: Date;

  @Column({ name: 'created_by', type: 'bigint', unsigned: true, default: 0 })
  createdBy: number;

  @Column({ name: 'updated_by', type: 'bigint', unsigned: true, default: 0 })
  updatedBy: number;
}
