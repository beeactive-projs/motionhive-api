import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePostDto } from './create-post.dto';

const GROUP = '7f1c1f9e-4b5a-4c1e-9a7b-2a8d3c4e5f60';
const WORKOUT = '3b2a1c0d-9e8f-4a7b-8c6d-5e4f3a2b1c0d';

function errorsFor(body: Record<string, unknown>) {
  return validate(plainToInstance(CreatePostDto, body));
}

describe('CreatePostDto — content', () => {
  it('needs words when there is no workout', async () => {
    expect(await errorsFor({ groupIds: [GROUP] })).not.toEqual([]);
    expect(await errorsFor({ groupIds: [GROUP], content: '' })).not.toEqual([]);
  });

  // The card says enough: the field can be sent empty or left out.
  it('lets a shared workout go without words', async () => {
    expect(
      await errorsFor({ groupIds: [GROUP], workoutLogId: WORKOUT }),
    ).toEqual([]);
    expect(
      await errorsFor({
        groupIds: [GROUP],
        workoutLogId: WORKOUT,
        content: '',
      }),
    ).toEqual([]);
  });

  it('still checks words that come with a workout', async () => {
    expect(
      await errorsFor({
        groupIds: [GROUP],
        workoutLogId: WORKOUT,
        content: 'x'.repeat(5001),
      }),
    ).not.toEqual([]);
  });
});
