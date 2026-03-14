import { EventEmitter } from 'events';
import { BusinessEvent, BusinessEventPayload, PurchaseReceiptConfirmedPayload, MaterialShortagePayload } from './business-events.enum';
import { queueService, ShortageRecheckJobData, NotificationJobData } from '../../shared/queue-service';
import { QUEUE_SHORTAGE_RECHECK, QUEUE_NOTIFICATION_SEND } from '../../shared/queue.config';

/**
 * 进程内事件总线（Sprint 4 改造版）
 *
 * 改造说明：
 *   - publish() 对已迁移事件类型内部路由到 QueueService（BullMQ）
 *   - subscribe() 方法签名和行为完全不变，调用方代码无需修改
 *   - 未迁移的事件类型仍走 EventEmitter 同步处理
 *
 * 已迁移到 BullMQ 的事件：
 *   PURCHASE_RECEIPT_CONFIRMED  → erp.inventory.shortage-recheck
 *   MATERIAL_SHORTAGE_DETECTED  → erp.notification.send
 *
 * 降级策略：
 *   当 QueueService.addJob() 因 Redis 不可用而失败时，
 *   QueueService 内部会通过 fallbackEmitter 同步 emit，
 *   由此处注册的 fallback handler 接管，行为与 Sprint 3 一致。
 */
class EventBusService extends EventEmitter {
  private static instance: EventBusService;

  private constructor() {
    super();
    this.setMaxListeners(50);
    this.registerFallbackHandlers();
  }

  static getInstance(): EventBusService {
    if (!EventBusService.instance) {
      EventBusService.instance = new EventBusService();
    }
    return EventBusService.instance;
  }

  /**
   * 注册 QueueService 降级 fallback 处理器
   *
   * 当 Redis 不可用时，QueueService.addJob() 会回退到 fallbackEmitter，
   * 此处将 BullMQ 路由的事件重新 emit 到 EventEmitter，
   * 使 subscribe() 注册的 handler 仍能被触发，行为与 Sprint 3 完全一致。
   */
  private registerFallbackHandlers(): void {
    // shortage-recheck 降级：将 ShortageRecheckJobData 转换回 BusinessEventPayload 格式并 emit
    queueService.onFallback(QUEUE_SHORTAGE_RECHECK, (data) => {
      const jobData = data as ShortageRecheckJobData;
      const payload: PurchaseReceiptConfirmedPayload = {
        tenantId: jobData.tenantId,
        userId: jobData.userId,
        receiptId: jobData.receiptId,
        poId: jobData.poId,
        skuId: jobData.skuId,
        qty: '0',  // 降级场景不传递 qty，Worker 会从 DB 重新查询
      };
      this.emit(BusinessEvent.PURCHASE_RECEIPT_CONFIRMED, payload);
    });

    // notification 降级：将 NotificationJobData 转换回 BusinessEventPayload 并 emit
    queueService.onFallback(QUEUE_NOTIFICATION_SEND, (data) => {
      const jobData = data as NotificationJobData;
      const payload: MaterialShortagePayload = {
        tenantId: jobData.tenantId,
        userId: jobData.userId,
        productionOrderId: jobData.targetId,
        shortageItems: [],
      };
      this.emit(BusinessEvent.MATERIAL_SHORTAGE_DETECTED, payload);
    });
  }

  /**
   * 发布业务事件
   *
   * 已迁移事件：异步投递到 BullMQ 队列（持久化、可重试）
   * 未迁移事件：保持原有同步 EventEmitter.emit() 行为
   */
  publish(event: BusinessEvent, payload: BusinessEventPayload): void {
    switch (event) {
      case BusinessEvent.PURCHASE_RECEIPT_CONFIRMED: {
        // 迁移到 BullMQ：入库后触发缺料重检
        const p = payload as PurchaseReceiptConfirmedPayload;
        const jobData: ShortageRecheckJobData = {
          tenantId: p.tenantId,
          userId: p.userId,
          skuId: p.skuId,
          receiptId: p.receiptId,
          poId: p.poId,
        };
        // addJob 返回 Promise，此处不 await，事件发布是 fire-and-forget 语义
        // 失败时 QueueService 内部会降级到 fallbackEmitter
        queueService.addJob(QUEUE_SHORTAGE_RECHECK, jobData, {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 10_000,
          },
        }).catch((err) => {
          console.error('[EventBus] PURCHASE_RECEIPT_CONFIRMED 入队异常:', (err as Error).message);
        });
        break;
      }

      case BusinessEvent.MATERIAL_SHORTAGE_DETECTED: {
        // 迁移到 BullMQ：缺料事件触发通知发送
        const p = payload as MaterialShortagePayload;
        const jobData: NotificationJobData = {
          tenantId: p.tenantId,
          userId: p.userId,
          type: 'material_shortage',
          targetId: p.productionOrderId,
          message: `生产工单 #${p.productionOrderId} 检测到缺料，共 ${p.shortageItems.length} 种物料不足`,
        };
        queueService.addJob(QUEUE_NOTIFICATION_SEND, jobData, {
          attempts: 3,
          backoff: {
            type: 'fixed',
            delay: 10_000,  // 固定 10s 重试间隔
          },
        }).catch((err) => {
          console.error('[EventBus] MATERIAL_SHORTAGE_DETECTED 入队异常:', (err as Error).message);
        });
        break;
      }

      default:
        // 未迁移事件：保持同步 EventEmitter 行为
        this.emit(event, payload);
        break;
    }
  }

  /**
   * 订阅业务事件
   *
   * 方法签名与 Sprint 3 完全一致，调用方无需修改。
   */
  subscribe(event: BusinessEvent, handler: (payload: BusinessEventPayload) => void | Promise<void>): void {
    this.on(event, handler);
  }
}

export const eventBus = EventBusService.getInstance();
