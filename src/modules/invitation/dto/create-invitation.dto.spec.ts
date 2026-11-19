import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateInvitationDto } from './create-invitation.dto';

async function errorsFor(body: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(plainToInstance(CreateInvitationDto, body));
  return errors.map((error) => error.property);
}

describe('CreateInvitationDto', () => {
  const base = { email: 'invitee@x.com', groupId: 'g-1' };

  it('refuses any role but USER', async () => {
    expect(await errorsFor({ ...base, roleName: 'SUPER_ADMIN' })).toEqual([
      'roleName',
    ]);
    expect(await errorsFor({ ...base, roleName: 'ADMIN' })).toEqual([
      'roleName',
    ]);
  });

  it('still takes USER, or no role at all, as the apps send it', async () => {
    expect(await errorsFor({ ...base, roleName: 'USER' })).toEqual([]);
    expect(await errorsFor(base)).toEqual([]);
  });
});
