import type { Request, Response } from 'express';

jest.mock('../../src/modules/notification/notification.service');

import { NotificationService } from '../../src/modules/notification/notification.service';
import { notificationController } from '../../src/modules/notification/notification.controller';

const MockNotificationService = NotificationService as jest.MockedClass<typeof NotificationService>;

function createResponse(): Response {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

describe('notification.controller list query parsing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('parses isRead=false as unread filter instead of truthy string', async () => {
    MockNotificationService.prototype.listForUser = jest.fn().mockResolvedValue({
      list: [],
      total: 0,
    });

    const req = {
      query: { page: '1', pageSize: '20', isRead: 'false' },
      tenantId: 1,
      userId: 2,
    } as unknown as Request;
    const res = createResponse();

    await notificationController.list(req, res);

    expect(MockNotificationService.prototype.listForUser).toHaveBeenCalledWith(1, 20, false);
    expect((res.json as jest.Mock).mock.calls[0][0].data).toMatchObject({
      list: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
  });

  it('parses isRead=true as read filter', async () => {
    MockNotificationService.prototype.listForUser = jest.fn().mockResolvedValue({
      list: [],
      total: 0,
    });

    const req = {
      query: { page: '2', pageSize: '10', isRead: 'true' },
      tenantId: 1,
      userId: 2,
    } as unknown as Request;
    const res = createResponse();

    await notificationController.list(req, res);

    expect(MockNotificationService.prototype.listForUser).toHaveBeenCalledWith(2, 10, true);
  });
});
