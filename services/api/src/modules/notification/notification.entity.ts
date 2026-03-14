/**
 * 站内通知实体接口
 *
 * 对应数据库表 notifications。
 * 本模块不使用 TypeORM Entity 装饰器，与其他模块保持一致，
 * 直接通过 AppDataSource.query 进行参数化查询。
 */
export interface NotificationEntity {
  id: number;
  tenant_id: number;
  user_id: number;
  type: 'approval_request' | 'approval_result' | 'order_update' | 'system';
  title: string;
  content: string;
  is_read: boolean;
  related_type?: string;
  related_id?: number;
  created_at: Date;
}
