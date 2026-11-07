import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { apiError, validationErrorBody } from '../i18n';
import { HttpExceptionFilter } from './http-exception.filter';
import { makeSilentLogger } from '../../../test/helpers/sequelize-mocks';

function run(
  exception: unknown,
  request: { headers?: Record<string, string>; user?: { language: string } },
) {
  const json = jest.fn<void, [Record<string, unknown>]>();
  const status = jest.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({
        method: 'GET',
        url: '/x',
        requestId: 'req-1',
        headers: {},
        ...request,
      }),
    }),
  } as unknown as ArgumentsHost;
  new HttpExceptionFilter(makeSilentLogger()).catch(exception, host);
  return json.mock.calls[0][0];
}

describe('HttpExceptionFilter', () => {
  it('answers a catalog error in the language the app sends', () => {
    const exception = new NotFoundException(apiError('venue.notFound'));
    expect(
      run(exception, { headers: { 'accept-language': 'ro' } }),
    ).toMatchObject({
      statusCode: 404,
      message: 'Nu am găsit locația.',
    });
    expect(
      run(exception, { headers: { 'accept-language': 'en' } }),
    ).toMatchObject({
      message: 'Venue not found.',
    });
  });

  it("falls back to the signed-in user's language", () => {
    const exception = new NotFoundException(apiError('venue.notFound'));
    expect(run(exception, { user: { language: 'ro' } }).message).toBe(
      'Nu am găsit locația.',
    );
  });

  it('never leaks the key or params to the client', () => {
    const body = run(new NotFoundException(apiError('venue.notFound')), {});
    expect(body).not.toHaveProperty('messageKey');
    expect(body).not.toHaveProperty('messageParams');
  });

  it("words a bare exception's status text in the caller's language", () => {
    expect(
      run(new ForbiddenException(), { headers: { 'accept-language': 'ro' } })
        .message,
    ).toBe('Nu ai permisiunea să faci asta.');
  });

  it("words multer's oversized-upload error in the caller's language", () => {
    // What @nestjs/platform-express throws when `limits.fileSize` trips.
    const body = run(new PayloadTooLargeException('File too large'), {
      headers: { 'accept-language': 'ro' },
    });
    expect(body.statusCode).toBe(413);
    expect(body.message).toBe('Fișierul este prea mare.');
  });

  it("answers an unknown route in the reader's language, never with the path", () => {
    // Nest's router throws this for a path no controller serves — what an
    // app newer than its API asks for.
    const body = run(
      new NotFoundException('Cannot GET /coach/clients/c-1/progress'),
      {
        headers: { 'accept-language': 'ro' },
      },
    );
    expect(body.statusCode).toBe(404);
    expect(body.message).not.toContain('Cannot GET');
    expect(body.message).toBe(
      run(new NotFoundException(), { headers: { 'accept-language': 'ro' } })
        .message,
    );
  });

  it('keeps an uncatalogued message as it was thrown', () => {
    expect(
      run(new BadRequestException('Stripe said no'), {
        headers: { 'accept-language': 'ro' },
      }).message,
    ).toBe('Stripe said no');
  });

  it('passes machine-readable fields through, never the key', () => {
    const body = run(
      new ConflictException({
        ...apiError('venue.notFound'),
        code: 'ALREADY_BOOKED',
        retryAfter: 42,
      }),
      { headers: { 'accept-language': 'ro' } },
    );
    expect(body).toMatchObject({
      message: 'Nu am găsit locația.',
      code: 'ALREADY_BOOKED',
      retryAfter: 42,
    });
    expect(body).not.toHaveProperty('messageKey');
  });

  it('translates a validation failure and keeps the raw details', () => {
    const exception = new BadRequestException(
      validationErrorBody([
        { constraints: { isEmail: 'email must be an email' } },
      ]),
    );
    expect(
      run(exception, { headers: { 'accept-language': 'ro' } }),
    ).toMatchObject({
      message:
        'Unele câmpuri nu sunt completate corect. Verifică-le și încearcă din nou.',
      details: ['email must be an email'],
    });
  });
});
