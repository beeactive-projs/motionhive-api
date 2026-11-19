import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { RecurrenceRuleDto } from './recurrence-rule.dto';

async function errorsFor(body: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(plainToInstance(RecurrenceRuleDto, body));
  return errors.map((error) => error.property);
}

describe('RecurrenceRuleDto', () => {
  it('needs at least one weekday, each once, for a weekly rule', async () => {
    expect(
      await errorsFor({ frequency: 'WEEKLY', interval: 1, daysOfWeek: [] }),
    ).toEqual(['daysOfWeek']);
    expect(
      await errorsFor({ frequency: 'WEEKLY', interval: 1, daysOfWeek: [1, 1] }),
    ).toEqual(['daysOfWeek']);
    expect(
      await errorsFor({ frequency: 'WEEKLY', interval: 1, daysOfWeek: [1.5] }),
    ).toEqual(['daysOfWeek']);
  });

  it('takes the weekdays the apps send', async () => {
    expect(
      await errorsFor({
        frequency: 'WEEKLY',
        interval: 1,
        daysOfWeek: [1, 3, 5],
      }),
    ).toEqual([]);
    expect(await errorsFor({ frequency: 'DAILY', interval: 1 })).toEqual([]);
  });
});
