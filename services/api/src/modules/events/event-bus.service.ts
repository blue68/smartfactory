import { EventEmitter } from 'events';
import { BusinessEvent, BusinessEventPayload } from './business-events.enum';

/**
 * 进程内同步事件总线
 * Sprint 3 阶段不引入消息队列，使用 EventEmitter 实现
 * 所有事件在同一进程内同步处理
 */
class EventBusService extends EventEmitter {
  private static instance: EventBusService;

  private constructor() {
    super();
    this.setMaxListeners(50);
  }

  static getInstance(): EventBusService {
    if (!EventBusService.instance) {
      EventBusService.instance = new EventBusService();
    }
    return EventBusService.instance;
  }

  /**
   * 发布业务事件
   * 注意：事件消费函数需要接收 queryRunner 以在同一事务中执行
   */
  publish(event: BusinessEvent, payload: BusinessEventPayload): void {
    this.emit(event, payload);
  }

  /**
   * 订阅业务事件
   */
  subscribe(event: BusinessEvent, handler: (payload: BusinessEventPayload) => void | Promise<void>): void {
    this.on(event, handler);
  }
}

export const eventBus = EventBusService.getInstance();
