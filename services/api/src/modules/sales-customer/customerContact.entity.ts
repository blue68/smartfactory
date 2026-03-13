import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

/**
 * 客户联系人实体（R-07）
 * 对应数据库表 customer_contacts
 */
@Entity('customer_contacts')
@Index(['tenantId', 'customerId'])
@Index(['customerId', 'isPrimary'])
export class CustomerContactEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', unsigned: true })
  tenantId: number;

  @Column({ name: 'customer_id', type: 'bigint', unsigned: true })
  customerId: number;

  @Column({ length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  title: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  email: string | null;

  /** 是否主要联系人，同一客户下应仅一条 is_primary=true */
  @Column({ name: 'is_primary', type: 'tinyint', width: 1, default: 0 })
  isPrimary: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt: Date;
}
