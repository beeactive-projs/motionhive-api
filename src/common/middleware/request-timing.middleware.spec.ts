import { EventEmitter } from 'events';
import type { LoggerService } from '@nestjs/common';

import { RequestTimingMiddleware } from './request-timing.middleware';

type FakeRes = EventEmitter & {
  headersSent: boolean;
  statusCode: number;
  headers: Record<string, string>;
  setHeader: jest.Mock;
  writeHead: jest.Mock;
};

function fakeRes(): FakeRes {
  const res = new EventEmitter() as FakeRes;
  res.headersSent = false;
  res.statusCode = 200;
  res.headers = {};
  res.setHeader = jest.fn((key: string, value: string) => {
    res.headers[key] = value;
  });
  res.writeHead = jest.fn(() => res);
  return res;
}

function fakeReq(overrides: Record<string, unknown> = {}) {
  return {
    method: 'GET',
    path: '/groups/g-1',
    originalUrl: '/groups/g-1?tab=members',
    baseUrl: '',
    route: { path: '/groups/:id' },
    requestId: 'rid-1',
    user: { id: 'u-1' },
    ...overrides,
  };
}

describe('RequestTimingMiddleware', () => {
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const middleware = new RequestTimingMiddleware(
    logger as unknown as LoggerService,
  );

  beforeEach(() => logger.log.mockClear());

  it('adds a Server-Timing header when headers are written', () => {
    const req = fakeReq();
    const res = fakeRes();
    const next = jest.fn();

    middleware.use(req as never, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);

    (res as unknown as { writeHead: (code: number) => void }).writeHead(200);
    expect(res.headers['Server-Timing']).toMatch(/^app;dur=\d+\.\d$/);
  });

  it('logs one structured line per request with the route pattern', () => {
    const req = fakeReq();
    const res = fakeRes();

    middleware.use(req as never, res as never, jest.fn());
    res.statusCode = 201;
    res.emit('finish');

    expect(logger.log).toHaveBeenCalledTimes(1);
    const [entry, context] = logger.log.mock.calls[0] as [
      Record<string, unknown>,
      string,
    ];
    expect(context).toBe('Http');
    expect(entry).toMatchObject({
      message: expect.stringMatching(/^GET \/groups\/g-1 201 \d+(\.\d)?ms$/),
      method: 'GET',
      route: '/groups/:id',
      path: '/groups/g-1',
      status: 201,
      requestId: 'rid-1',
      userId: 'u-1',
    });
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('falls back to the raw path when the request matched no route', () => {
    const req = fakeReq({
      route: undefined,
      user: undefined,
      requestId: undefined,
    });
    const res = fakeRes();

    middleware.use(req as never, res as never, jest.fn());
    res.statusCode = 404;
    res.emit('finish');

    expect(logger.log.mock.calls[0][0]).toMatchObject({
      route: '/groups/g-1',
      status: 404,
      requestId: null,
      userId: null,
    });
  });

  it('does not log the liveness probe', () => {
    const req = fakeReq({ path: '/health', originalUrl: '/health' });
    const res = fakeRes();

    middleware.use(req as never, res as never, jest.fn());
    res.emit('finish');

    expect(logger.log).not.toHaveBeenCalled();
  });
});
