import type { Request, Response } from 'express';
import {
  BULL_BOARD_FAILURE_WINDOW_MS,
  BULL_BOARD_MAX_FAILURES,
  createBasicAuthGate,
} from './bull-board.setup';

const USER = 'queues-admin';
const PASSWORD = 'a-long-enough-password';

function basic(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

function request(authorization: string | undefined, ip = '203.0.113.7') {
  return { ip, headers: { authorization } } as unknown as Request;
}

interface FakeResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  set: jest.Mock<FakeResponse, [string, string]>;
  status: jest.Mock<FakeResponse, [number]>;
  send: jest.Mock<FakeResponse, [string]>;
}

function response(): FakeResponse {
  const res: FakeResponse = {
    statusCode: 200,
    headers: {},
    body: '',
    set: jest.fn<FakeResponse, [string, string]>(),
    status: jest.fn<FakeResponse, [number]>(),
    send: jest.fn<FakeResponse, [string]>(),
  };
  res.set.mockImplementation((name, value) => {
    res.headers[name] = value;
    return res;
  });
  res.status.mockImplementation((code) => {
    res.statusCode = code;
    return res;
  });
  res.send.mockImplementation((body) => {
    res.body = body;
    return res;
  });
  return res;
}

describe('createBasicAuthGate', () => {
  let clock: number;
  let gate: ReturnType<typeof createBasicAuthGate>;

  beforeEach(() => {
    clock = 1_000_000;
    gate = createBasicAuthGate(USER, PASSWORD, () => clock);
  });

  function attempt(authorization: string | undefined, ip?: string) {
    const res = response();
    const next = jest.fn();
    gate(request(authorization, ip), res as unknown as Response, next);
    return { res, next };
  }

  it('lets the right credentials through', () => {
    const { res, next } = attempt(basic(USER, PASSWORD));
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('asks for credentials when none are sent', () => {
    const { res, next } = attempt(undefined);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.headers['WWW-Authenticate']).toBe('Basic realm="bull-board"');
  });

  it('refuses a wrong password, a wrong user and a header without a colon', () => {
    expect(attempt(basic(USER, 'wrong')).res.statusCode).toBe(401);
    expect(attempt(basic('someone', PASSWORD)).res.statusCode).toBe(401);
    const noColon = `Basic ${Buffer.from(USER).toString('base64')}`;
    expect(attempt(noColon).res.statusCode).toBe(401);
  });

  it('makes an address wait after too many wrong tries, the right password included', () => {
    for (let i = 0; i < BULL_BOARD_MAX_FAILURES; i++) {
      expect(attempt(basic(USER, `guess-${i}`)).res.statusCode).toBe(401);
    }
    const blocked = attempt(basic(USER, PASSWORD));
    expect(blocked.next).not.toHaveBeenCalled();
    expect(blocked.res.statusCode).toBe(429);
    expect(Number(blocked.res.headers['Retry-After'])).toBe(
      BULL_BOARD_FAILURE_WINDOW_MS / 1000,
    );
  });

  it('does not count the browser asking for the prompt', () => {
    for (let i = 0; i < BULL_BOARD_MAX_FAILURES * 2; i++) {
      attempt(undefined);
    }
    expect(attempt(basic(USER, PASSWORD)).next).toHaveBeenCalled();
  });

  it('keeps other addresses out of it', () => {
    for (let i = 0; i < BULL_BOARD_MAX_FAILURES; i++) {
      attempt(basic(USER, 'wrong'));
    }
    expect(
      attempt(basic(USER, PASSWORD), '198.51.100.1').next,
    ).toHaveBeenCalled();
  });

  it('lets the address try again once the window ends', () => {
    for (let i = 0; i < BULL_BOARD_MAX_FAILURES; i++) {
      attempt(basic(USER, 'wrong'));
    }
    clock += BULL_BOARD_FAILURE_WINDOW_MS;
    expect(attempt(basic(USER, PASSWORD)).next).toHaveBeenCalled();
  });

  it('forgets earlier wrong tries after a right one', () => {
    for (let i = 0; i < BULL_BOARD_MAX_FAILURES - 1; i++) {
      attempt(basic(USER, 'wrong'));
    }
    expect(attempt(basic(USER, PASSWORD)).next).toHaveBeenCalled();
    for (let i = 0; i < BULL_BOARD_MAX_FAILURES - 1; i++) {
      expect(attempt(basic(USER, 'wrong')).res.statusCode).toBe(401);
    }
    expect(attempt(basic(USER, PASSWORD)).next).toHaveBeenCalled();
  });
});
