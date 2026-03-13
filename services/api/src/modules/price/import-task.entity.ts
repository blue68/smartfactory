import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm';

export type ImportTaskType   = 'price' | 'sku';
export type ImportTaskStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface ImportErrorDetail {
  /** 1-based 数据行号（不含表头） */
  row: number;
  column?: string;
  message: string;
  /** 'error' = 阻断行; 'warning' = 不阻断 */
  type?: 'error' | 'warning';
}

/**
 * import_tasks 表实体
 * 对应 Sprint 1 P0-R03-01：5000 行异步导入任务跟踪
 */
@Entity('import_tasks')
@Index(['tenantId', 'status'])
@Index(['tenantId', 'type'])
export class ImportTaskEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', unsigned: true })
  tenantId: number;

  @Column({ type: 'enum', enum: ['price', 'sku'] })
  type: ImportTaskType;

  @Column({
    type: 'enum',
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending',
  })
  status: ImportTaskStatus;

  @Column({ name: 'total_rows', type: 'int', unsigned: true, default: 0 })
  totalRows: number;

  @Column({ name: 'success_count', type: 'int', unsigned: true, default: 0 })
  successCount: number;

  @Column({ name: 'fail_count', type: 'int', unsigned: true, default: 0 })
  failCount: number;

  @Column({ name: 'skip_count', type: 'int', unsigned: true, default: 0 })
  skipCount: number;

  @Column({ name: 'warning_count', type: 'int', unsigned: true, default: 0 })
  warningCount: number;

  @Column({ name: 'error_details', type: 'json', nullable: true })
  errorDetails: ImportErrorDetail[] | null;

  @Column({ name: 'warning_details', type: 'json', nullable: true })
  warningDetails: ImportErrorDetail[] | null;

  @Column({ name: 'file_path', type: 'varchar', length: 500, nullable: true })
  filePath: string | null;

  @Column({ name: 'file_name', type: 'varchar', length: 255, nullable: true })
  fileName: string | null;

  @Column({ name: 'created_by', type: 'bigint', unsigned: true, default: 0 })
  createdBy: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt: Date;
}
