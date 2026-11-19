import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { validationErrorBody } from '../../../common/i18n';
import { FacebookAuthDto } from './facebook-auth.dto';

const RAW_NONCE = 'n'.repeat(64);

function errorsFor(body: Record<string, unknown>) {
  return validate(plainToInstance(FacebookAuthDto, body));
}

/** The catalog key the global ValidationPipe would answer with. */
async function answeredKey(body: Record<string, unknown>): Promise<string> {
  const errors = await errorsFor(body);
  return validationErrorBody(errors).messageKey;
}

describe('FacebookAuthDto', () => {
  it('takes an access token alone (web, Android)', async () => {
    expect(await errorsFor({ accessToken: 'EAAG-token' })).toEqual([]);
    expect(
      await errorsFor({ accessToken: 'EAAG-token', language: 'ro' }),
    ).toEqual([]);
  });

  it('takes an ID token with its raw nonce (iPhone)', async () => {
    expect(
      await errorsFor({ idToken: 'limited.id.token', rawNonce: RAW_NONCE }),
    ).toEqual([]);
  });

  it.each([
    ['no token at all', {}],
    ['a nonce alone', { rawNonce: RAW_NONCE }],
    [
      'both tokens',
      { accessToken: 'EAAG-token', idToken: 'id', rawNonce: RAW_NONCE },
    ],
    [
      'both tokens without a nonce',
      { accessToken: 'EAAG-token', idToken: 'id' },
    ],
    ['an ID token without its nonce', { idToken: 'limited.id.token' }],
    [
      'an access token with a nonce',
      { accessToken: 'EAAG-token', rawNonce: RAW_NONCE },
    ],
    ['an empty access token', { accessToken: '' }],
    ['an empty ID token', { idToken: '', rawNonce: RAW_NONCE }],
  ])('answers %s with auth.facebookTokenChoice', async (_label, body) => {
    expect(await answeredKey(body)).toBe('auth.facebookTokenChoice');
  });

  it('refuses a nonce too short to be random', async () => {
    expect(
      await errorsFor({ idToken: 'limited.id.token', rawNonce: 'short' }),
    ).not.toEqual([]);
  });
});
