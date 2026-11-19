import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SetLogSupersetsDto } from './set-log-supersets.dto';

const A = 'b1c2d3e4-0000-4111-8222-3333abcd6666';
const B = 'c1d2e3f4-0000-4111-8222-3333abcd7777';

function errorsFor(body: Record<string, unknown>) {
  return validate(plainToInstance(SetLogSupersetsDto, body));
}

describe('SetLogSupersetsDto', () => {
  it('takes a group, or null to take an exercise out of its superset', async () => {
    expect(
      await errorsFor({
        exercises: [
          { id: A, supersetGroupId: 1 },
          { id: B, supersetGroupId: null },
        ],
      }),
    ).toEqual([]);
  });

  // Null is a choice; a missing group is a mistake.
  it('needs the group on every exercise', async () => {
    expect(await errorsFor({ exercises: [{ id: A }] })).not.toEqual([]);
    expect(
      await errorsFor({ exercises: [{ id: A, supersetGroupId: 'one' }] }),
    ).not.toEqual([]);
    expect(
      await errorsFor({ exercises: [{ id: A, supersetGroupId: -1 }] }),
    ).not.toEqual([]);
  });

  it('refuses nothing to change, a bad id and the same exercise twice', async () => {
    expect(await errorsFor({ exercises: [] })).not.toEqual([]);
    expect(
      await errorsFor({ exercises: [{ id: 'nope', supersetGroupId: 1 }] }),
    ).not.toEqual([]);
    expect(
      await errorsFor({
        exercises: [
          { id: A, supersetGroupId: 1 },
          { id: A, supersetGroupId: null },
        ],
      }),
    ).not.toEqual([]);
  });
});
