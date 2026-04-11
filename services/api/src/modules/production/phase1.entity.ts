import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('production_order_components')
@Index('idx_tenant_order', ['tenantId', 'productionOrderId'])
@Index('idx_tenant_resolved_sku', ['tenantId', 'resolvedSkuId'])
export class ProductionOrderComponentEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', unsigned: true })
  tenantId: number;

  @Column({ name: 'production_order_id', type: 'bigint', unsigned: true })
  productionOrderId: number;

  @Column({ name: 'parent_component_id', type: 'bigint', unsigned: true, nullable: true })
  parentComponentId: number | null;

  @Column({ name: 'sku_id', type: 'bigint', unsigned: true })
  skuId: number;

  @Column({ name: 'resolved_sku_id', type: 'bigint', unsigned: true, nullable: true })
  resolvedSkuId: number | null;

  @Column({ name: 'component_type', type: 'enum', enum: ['fg', 'wip', 'rm'] })
  componentType: 'fg' | 'wip' | 'rm';

  @Column({ name: 'qty_required', type: 'decimal', precision: 16, scale: 4, default: 0 })
  qtyRequired: string;

  @Column({ name: 'bom_level', type: 'smallint', default: 0 })
  bomLevel: number;

  @Column({ name: 'bom_path', type: 'varchar', length: 255, nullable: true })
  bomPath: string | null;

  @Column({ name: 'wildcard_rule_id', type: 'bigint', unsigned: true, nullable: true })
  wildcardRuleId: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt: Date;

  @Column({ name: 'created_by', type: 'bigint', unsigned: true, default: 0 })
  createdBy: number;

  @Column({ name: 'updated_by', type: 'bigint', unsigned: true, default: 0 })
  updatedBy: number;
}

@Entity('production_operations')
@Index('idx_tenant_order_status', ['tenantId', 'productionOrderId', 'status'])
@Index('idx_tenant_output_sku', ['tenantId', 'outputSkuId'])
export class ProductionOperationEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', unsigned: true })
  tenantId: number;

  @Column({ name: 'production_order_id', type: 'bigint', unsigned: true })
  productionOrderId: number;

  @Column({ name: 'component_id', type: 'bigint', unsigned: true })
  componentId: number;

  @Column({ name: 'process_step_id', type: 'bigint', unsigned: true })
  processStepId: number;

  @Column({ name: 'output_sku_id', type: 'bigint', unsigned: true, nullable: true })
  outputSkuId: number | null;

  @Column({ name: 'planned_qty', type: 'decimal', precision: 16, scale: 4, default: 0 })
  plannedQty: string;

  @Column({ name: 'completed_qty', type: 'decimal', precision: 16, scale: 4, default: 0 })
  completedQty: string;

  @Column({
    type: 'enum',
    enum: ['pending', 'released', 'scheduled', 'in_progress', 'completed', 'blocked', 'cancelled'],
    default: 'pending',
  })
  status: 'pending' | 'released' | 'scheduled' | 'in_progress' | 'completed' | 'blocked' | 'cancelled';

  @Column({
    name: 'execution_mode',
    type: 'enum',
    enum: ['internal', 'outsource'],
    default: 'internal',
  })
  executionMode: 'internal' | 'outsource';

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt: Date;

  @Column({ name: 'created_by', type: 'bigint', unsigned: true, default: 0 })
  createdBy: number;

  @Column({ name: 'updated_by', type: 'bigint', unsigned: true, default: 0 })
  updatedBy: number;
}

@Entity('production_operation_dependencies')
@Index('uk_tenant_operation_pred', ['tenantId', 'operationId', 'predecessorOperationId'], { unique: true })
export class ProductionOperationDependencyEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', unsigned: true })
  tenantId: number;

  @Column({ name: 'operation_id', type: 'bigint', unsigned: true })
  operationId: number;

  @Column({ name: 'predecessor_operation_id', type: 'bigint', unsigned: true })
  predecessorOperationId: number;

  @Column({ name: 'required_qty', type: 'decimal', precision: 16, scale: 4, default: 0 })
  requiredQty: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt: Date;
}

@Entity('production_order_sku_resolutions')
@Index('uk_tenant_order_component', ['tenantId', 'productionOrderId', 'componentId'], { unique: true })
export class ProductionOrderSkuResolutionEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', unsigned: true })
  tenantId: number;

  @Column({ name: 'production_order_id', type: 'bigint', unsigned: true })
  productionOrderId: number;

  @Column({ name: 'component_id', type: 'bigint', unsigned: true })
  componentId: number;

  @Column({ name: 'base_sku_id', type: 'bigint', unsigned: true })
  baseSkuId: number;

  @Column({ name: 'resolved_sku_id', type: 'bigint', unsigned: true })
  resolvedSkuId: number;

  @Column({ name: 'rule_id', type: 'bigint', unsigned: true, nullable: true })
  ruleId: number | null;

  @CreateDateColumn({ name: 'resolved_at', type: 'datetime', precision: 3 })
  resolvedAt: Date;

  @Column({ name: 'created_by', type: 'bigint', unsigned: true, default: 0 })
  createdBy: number;
}

@Entity('sku_substitution_rules')
@Index('uk_tenant_base_candidate_priority', ['tenantId', 'baseSkuId', 'candidateSkuId', 'priority'], { unique: true })
@Index('idx_tenant_base_status_window', ['tenantId', 'baseSkuId', 'status', 'effectiveFrom', 'effectiveTo'])
export class SkuSubstitutionRuleEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', unsigned: true })
  tenantId: number;

  @Column({ name: 'base_sku_id', type: 'bigint', unsigned: true })
  baseSkuId: number;

  @Column({ name: 'candidate_sku_id', type: 'bigint', unsigned: true })
  candidateSkuId: number;

  @Column({ type: 'int', default: 100 })
  priority: number;

  @Column({ name: 'match_attrs', type: 'json', nullable: true })
  matchAttrs: Record<string, unknown> | null;

  @Column({ name: 'effective_from', type: 'datetime', precision: 3, nullable: true })
  effectiveFrom: Date | null;

  @Column({ name: 'effective_to', type: 'datetime', precision: 3, nullable: true })
  effectiveTo: Date | null;

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

@Entity('task_material_transactions')
@Index('idx_tenant_task', ['tenantId', 'taskId'])
@Index('idx_tenant_task_io', ['tenantId', 'taskId', 'ioType'])
export class TaskMaterialTransactionEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', unsigned: true })
  tenantId: number;

  @Column({ name: 'task_id', type: 'bigint', unsigned: true })
  taskId: number;

  @Column({ name: 'operation_id', type: 'bigint', unsigned: true, nullable: true })
  operationId: number | null;

  @Column({ name: 'sku_id', type: 'bigint', unsigned: true })
  skuId: number;

  @Column({ name: 'io_type', type: 'enum', enum: ['input', 'output'] })
  ioType: 'input' | 'output';

  @Column({ name: 'planned_qty', type: 'decimal', precision: 16, scale: 4, default: 0 })
  plannedQty: string;

  @Column({ name: 'actual_qty', type: 'decimal', precision: 16, scale: 4, default: 0 })
  actualQty: string;

  @Column({ name: 'inventory_tx_id', type: 'bigint', unsigned: true, nullable: true })
  inventoryTxId: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt: Date;

  @Column({ name: 'created_by', type: 'bigint', unsigned: true, default: 0 })
  createdBy: number;
}

@Entity('task_inventory_movements')
@Index('idx_tenant_task_movement', ['tenantId', 'taskId', 'movementType'])
@Index('idx_tenant_task_material', ['tenantId', 'taskMaterialTxId'])
@Index('idx_tenant_task_sku', ['tenantId', 'taskId', 'skuId'])
@Index('uk_tenant_inventory_tx', ['tenantId', 'inventoryTxId'], { unique: true })
export class TaskInventoryMovementEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', unsigned: true })
  tenantId: number;

  @Column({ name: 'task_id', type: 'bigint', unsigned: true })
  taskId: number;

  @Column({ name: 'task_material_tx_id', type: 'bigint', unsigned: true, nullable: true })
  taskMaterialTxId: number | null;

  @Column({ name: 'sku_id', type: 'bigint', unsigned: true })
  skuId: number;

  @Column({ name: 'movement_type', type: 'enum', enum: ['issue', 'return', 'consume', 'scrap', 'output'] })
  movementType: 'issue' | 'return' | 'consume' | 'scrap' | 'output';

  @Column({ name: 'inventory_tx_id', type: 'bigint', unsigned: true })
  inventoryTxId: number;

  @Column({ type: 'decimal', precision: 16, scale: 4, default: 0 })
  qty: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt: Date;

  @Column({ name: 'created_by', type: 'bigint', unsigned: true, default: 0 })
  createdBy: number;
}

@Entity('inventory_daily_snapshots')
@Index('uk_tenant_date_wh_sku', ['tenantId', 'snapshotDate', 'warehouseId', 'skuId'], { unique: true })
@Index('idx_tenant_date_wh', ['tenantId', 'snapshotDate', 'warehouseId'])
export class InventoryDailySnapshotEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', unsigned: true })
  tenantId: number;

  @Column({ name: 'snapshot_date', type: 'date' })
  snapshotDate: string;

  @Column({ name: 'warehouse_id', type: 'bigint', unsigned: true, default: 0 })
  warehouseId: number;

  @Column({ name: 'sku_id', type: 'bigint', unsigned: true })
  skuId: number;

  @Column({ name: 'qty_on_hand', type: 'decimal', precision: 16, scale: 4, default: 0 })
  qtyOnHand: string;

  @Column({ name: 'qty_reserved', type: 'decimal', precision: 16, scale: 4, default: 0 })
  qtyReserved: string;

  @Column({ name: 'qty_available', type: 'decimal', precision: 16, scale: 4, default: 0 })
  qtyAvailable: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt: Date;
}
