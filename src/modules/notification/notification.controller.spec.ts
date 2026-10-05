import { Test } from '@nestjs/testing';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { NotificationController } from './notification.controller';
import { NotificationCategory } from './notification-categories';
import { NotificationReceiptService } from './services/notification-receipt.service';

const mockReq = (userId: string) =>
  ({ user: { id: userId } }) as unknown as AuthenticatedRequest;

// Plain-object mock instead of `jest.Mocked<NotificationReceiptService>`
// because the latter preserves the original method types and triggers
// `@typescript-eslint/unbound-method` on every `expect(svc.method)` call.
interface ReceiptsMock {
  listForUser: jest.Mock;
  unreadCount: jest.Mock;
  markAsRead: jest.Mock;
  markAsUnread: jest.Mock;
  markAllAsRead: jest.Mock;
  markAsViewed: jest.Mock;
  markAsClicked: jest.Mock;
  dismiss: jest.Mock;
  remove: jest.Mock;
}

describe('NotificationController', () => {
  let controller: NotificationController;
  let receipts: ReceiptsMock;

  beforeEach(async () => {
    receipts = {
      listForUser: jest.fn(),
      unreadCount: jest.fn(),
      markAsRead: jest.fn(),
      markAsUnread: jest.fn(),
      markAllAsRead: jest.fn(),
      markAsViewed: jest.fn(),
      markAsClicked: jest.fn(),
      dismiss: jest.fn(),
      remove: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [NotificationController],
      providers: [{ provide: NotificationReceiptService, useValue: receipts }],
    }).compile();

    controller = moduleRef.get(NotificationController);
  });

  it('list forwards page/limit/unreadOnly to the service', async () => {
    receipts.listForUser.mockResolvedValue({
      items: [],
      total: 0,
      page: 2,
      pageSize: 50,
    });
    await controller.list(mockReq('user-1'), {
      page: 2,
      limit: 50,
      unreadOnly: true,
    });
    expect(receipts.listForUser).toHaveBeenCalledWith('user-1', {
      page: 2,
      limit: 50,
      unreadOnly: true,
      locale: 'en',
    });
  });

  it('list forwards the category list to the service', async () => {
    receipts.listForUser.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
    await controller.list(mockReq('user-1'), {
      page: 1,
      limit: 20,
      unreadOnly: false,
      category: [NotificationCategory.Sessions, NotificationCategory.Payments],
    });
    expect(receipts.listForUser).toHaveBeenCalledWith('user-1', {
      page: 1,
      limit: 20,
      unreadOnly: false,
      categories: [
        NotificationCategory.Sessions,
        NotificationCategory.Payments,
      ],
      locale: 'en',
    });
  });

  it('unreadCount wraps the count in { count }', async () => {
    receipts.unreadCount.mockResolvedValue(7);
    const result = await controller.unreadCount(mockReq('user-1'));
    expect(result).toEqual({ count: 7 });
  });

  it('markRead delegates with the user id and receipt id', async () => {
    await controller.markRead(mockReq('user-1'), 'r-1');
    expect(receipts.markAsRead).toHaveBeenCalledWith('user-1', 'r-1');
  });

  it('markUnread delegates with the user id and receipt id', async () => {
    await controller.markUnread(mockReq('user-1'), 'r-1');
    expect(receipts.markAsUnread).toHaveBeenCalledWith('user-1', 'r-1');
  });

  it('markViewed unwraps the ids array from the DTO', async () => {
    receipts.markAsViewed.mockResolvedValue({ updated: 2 });
    const result = await controller.markViewed(mockReq('user-1'), {
      ids: ['r-1', 'r-2'],
    });
    expect(receipts.markAsViewed).toHaveBeenCalledWith('user-1', [
      'r-1',
      'r-2',
    ]);
    expect(result.updated).toBe(2);
  });

  it('markClicked, dismiss, remove all delegate with (userId, id)', async () => {
    await controller.markClicked(mockReq('user-1'), 'r-1');
    await controller.dismiss(mockReq('user-1'), 'r-1');
    await controller.remove(mockReq('user-1'), 'r-1');
    expect(receipts.markAsClicked).toHaveBeenCalledWith('user-1', 'r-1');
    expect(receipts.dismiss).toHaveBeenCalledWith('user-1', 'r-1');
    expect(receipts.remove).toHaveBeenCalledWith('user-1', 'r-1');
  });
});
