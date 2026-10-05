import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { NotificationCategory } from '../notification-categories';
import { ListNotificationsDto } from './list-notifications.dto';

/**
 * Mirrors the global ValidationPipe — implicit conversion on — so the
 * DTO sees query values the way Express hands them over: a string for
 * one occurrence, an array for a repeated param.
 */
function toDto(query: Record<string, unknown>) {
  return plainToInstance(ListNotificationsDto, query, {
    enableImplicitConversion: true,
  });
}

describe('ListNotificationsDto — category', () => {
  it('accepts a single category as a one-item list', async () => {
    const dto = toDto({ category: 'SESSIONS' });
    expect(dto.category).toEqual([NotificationCategory.Sessions]);
    expect(await validate(dto)).toEqual([]);
  });

  it('accepts a repeated param', async () => {
    const dto = toDto({ category: ['SESSIONS', 'PAYMENTS'] });
    expect(dto.category).toEqual([
      NotificationCategory.Sessions,
      NotificationCategory.Payments,
    ]);
    expect(await validate(dto)).toEqual([]);
  });

  it('accepts a comma-separated list', async () => {
    const dto = toDto({ category: 'SESSIONS, PAYMENTS' });
    expect(dto.category).toEqual([
      NotificationCategory.Sessions,
      NotificationCategory.Payments,
    ]);
    expect(await validate(dto)).toEqual([]);
  });

  it('leaves the filter off when the param is absent or empty', async () => {
    expect(toDto({}).category).toBeUndefined();
    const empty = toDto({ category: '' });
    expect(empty.category).toBeUndefined();
    expect(await validate(empty)).toEqual([]);
  });

  it('rejects an unknown category anywhere in the list', async () => {
    const errors = await validate(toDto({ category: 'SESSIONS,BANANAS' }));
    expect(errors.map((e) => e.property)).toEqual(['category']);
  });
});
