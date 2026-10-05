import type { LoggerService } from '@nestjs/common';

export interface ModelMock {
  create: jest.Mock;
  findOne: jest.Mock;
  findAll: jest.Mock;
  findAndCountAll: jest.Mock;
  findByPk: jest.Mock;
  count: jest.Mock;
  update: jest.Mock;
  destroy: jest.Mock;
}

export function makeModelMock(): ModelMock {
  return {
    create: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
    // Sensible empty defaults: a test that does not care about listing
    // should not have to stub the readers to avoid a crash.
    findAndCountAll: jest.fn().mockResolvedValue({ rows: [], count: 0 }),
    findByPk: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
    update: jest.fn(),
    destroy: jest.fn(),
  };
}

export const fakeTx = { LOCK: { UPDATE: 'UPDATE' } };

export function makeSequelizeMock() {
  return {
    transaction: jest.fn((cb: (tx: typeof fakeTx) => unknown) =>
      Promise.resolve(cb(fakeTx)),
    ),
  };
}

export function makeSilentLogger(): LoggerService & {
  log: jest.Mock;
  error: jest.Mock;
  warn: jest.Mock;
  debug: jest.Mock;
  verbose: jest.Mock;
} {
  return {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  };
}
