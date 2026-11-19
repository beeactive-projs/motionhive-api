import { col } from 'sequelize';

import { buildFilterOptions } from './filter.utils';
import { FilterSettingsDto } from '../dto/filter-settings.dto';

function settings(sortField: string | undefined): FilterSettingsDto {
  return { first: 0, rows: 20, sortField, sortOrder: 1 } as FilterSettingsDto;
}

const allowedFields = ['status', 'startedAt', 'client.firstName'];

describe('buildFilterOptions, sorting', () => {
  it('sorts by an allowed field, nested ones included', () => {
    expect(
      buildFilterOptions(settings('startedAt'), { allowedFields }).order,
    ).toEqual([['startedAt', 'ASC']]);
    expect(
      buildFilterOptions(settings('client.firstName'), { allowedFields }).order,
    ).toEqual([[col('client.first_name'), 'ASC']]);
  });

  it('falls back to the default for a field outside the list, hidden columns included', () => {
    for (const field of ['client.passwordHash', 'client.phone', 'nonsense']) {
      expect(
        buildFilterOptions(settings(field), { allowedFields }).order,
      ).toEqual([['createdAt', 'ASC']]);
    }
  });
});
