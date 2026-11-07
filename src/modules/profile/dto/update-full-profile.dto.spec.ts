import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateFullProfileDto } from './update-full-profile.dto';
import { UpdateInstructorProfileDto } from './update-instructor-profile.dto';

// The same options as the global ValidationPipe (main.ts): a field the DTO
// does not declare is refused, not silently dropped.
const OPTIONS = { whitelist: true, forbidNonWhitelisted: true };

describe('UpdateFullProfileDto — allowClientMentions', () => {
  it('takes the switch on the instructor section', async () => {
    for (const allowClientMentions of [true, false]) {
      const dto = plainToInstance(UpdateFullProfileDto, {
        instructor: { allowClientMentions },
      });
      expect(await validate(dto, OPTIONS)).toEqual([]);
    }
  });

  it('refuses anything but a boolean', async () => {
    const dto = plainToInstance(UpdateFullProfileDto, {
      instructor: { allowClientMentions: 'yes' },
    });
    expect(await validate(dto, OPTIONS)).not.toEqual([]);
  });

  it('is the same field on PATCH /profile/instructor', async () => {
    const dto = plainToInstance(UpdateInstructorProfileDto, {
      allowClientMentions: true,
    });
    expect(await validate(dto, OPTIONS)).toEqual([]);
  });
});
