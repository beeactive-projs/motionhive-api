import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CoachDirectorySort } from '../entities/coach-directory.enums';
import { CoachDirectoryDto } from './coach-directory.dto';

/**
 * Mirrors the global ValidationPipe, implicit conversion on, so the DTO
 * sees query values the way Express hands them over: a string for one
 * occurrence, an array for a repeated param.
 */
function toDto(query: Record<string, unknown>) {
  return plainToInstance(CoachDirectoryDto, query, {
    enableImplicitConversion: true,
  });
}

describe('CoachDirectoryDto', () => {
  // Implicit conversion runs Boolean('false'), which is true; the flag must
  // still read the raw string.
  it('reads accepting, online and requested as the words they were sent as', () => {
    expect(
      toDto({ online: 'true', accepting: 'true', requested: 'true' }),
    ).toMatchObject({
      online: true,
      accepting: true,
      requested: true,
    });
    expect(
      toDto({ online: 'false', accepting: 'false', requested: 'false' }),
    ).toMatchObject({
      online: false,
      accepting: false,
      requested: false,
    });
  });

  it('takes one specialization or several, and never splits on a comma', () => {
    expect(toDto({ specializations: 'Yoga' }).specializations).toEqual([
      'Yoga',
    ]);
    expect(
      toDto({ specializations: ['Yoga', ' Strength, conditioning '] })
        .specializations,
    ).toEqual(['Yoga', 'Strength, conditioning']);
    expect(toDto({ specializations: '' }).specializations).toBeUndefined();
  });

  it('defaults to the first page of 20, recommended first', () => {
    expect(toDto({})).toMatchObject({
      page: 1,
      limit: 20,
      sort: CoachDirectorySort.RECOMMENDED,
    });
  });

  it('rejects a sort it does not know and a page over 50', async () => {
    expect(await validate(toDto({ sort: 'rating' }))).not.toHaveLength(0);
    expect(await validate(toDto({ limit: '51' }))).not.toHaveLength(0);
    expect(await validate(toDto({ minYears: '5', limit: '50' }))).toHaveLength(
      0,
    );
  });
});
