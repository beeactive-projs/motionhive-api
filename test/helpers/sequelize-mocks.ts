import type { LoggerService } from '@nestjs/common';

export interface ModelMock {
  create: jest.Mock;
  findOne: jest.Mock;
  findAll: jest.Mock;
  findByPk: jest.Mock;
  update: jest.Mock;
  destroy: jest.Mock;
}

export function makeModelMock(): ModelMock {
  return {
    create: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
    findByPk: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
  };
}

export const fakeTx = { LOCK: { UPDATE: 'UPDATE' } } as unknown as {
  LOCK: { UPDATE: string };
};

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
