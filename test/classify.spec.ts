import { backoff, classifyResponse } from '../src/zatca/submission/classify';

const MIN = 60_000;
const now = new Date('2026-10-12T10:00:00Z');

describe('classifyResponse', () => {
  it.each([
    [200, 'ACCEPTED', true],
    [202, 'ACCEPTED_WITH_WARNINGS', true],
    [400, 'REJECTED', true],
    [404, 'REJECTED', true],
    [401, 'PENDING', false],
    [403, 'PENDING', false],
    [429, 'PENDING', false],
    [500, 'PENDING', false],
    [503, 'PENDING', false],
  ] as const)('HTTP %i → %s', (httpStatus, status, final) => {
    const out = classifyResponse({ httpStatus, attempts: 1, now });
    expect(out.status).toBe(status);
    expect(out.final).toBe(final);
    expect(out.nextRetryAt === null).toBe(final);
  });

  it('network error → PENDING with the error kept', () => {
    const out = classifyResponse({ networkError: 'ETIMEDOUT', attempts: 1, now });
    expect(out).toEqual({ status: 'PENDING', nextRetryAt: new Date(now.getTime() + 5 * MIN), lastError: 'ETIMEDOUT', final: false });
  });

  it('401 explains it is an authentication problem', () => {
    expect(classifyResponse({ httpStatus: 401, attempts: 1, now }).lastError).toContain('مصادقة');
  });

  it('accepted invoices carry no error and no retry', () => {
    expect(classifyResponse({ httpStatus: 200, attempts: 3, now })).toEqual({ status: 'ACCEPTED', nextRetryAt: null, lastError: null, final: true });
  });

  it('next retry grows with attempts', () => {
    expect(classifyResponse({ httpStatus: 503, attempts: 3, now }).nextRetryAt).toEqual(new Date(now.getTime() + 20 * MIN));
  });
});

describe('backoff', () => {
  it.each([
    [1, 5 * MIN],
    [2, 10 * MIN],
    [3, 20 * MIN],
    [4, 40 * MIN],
    [6, 160 * MIN],
    [7, 320 * MIN],
    [8, 360 * MIN],
    [50, 360 * MIN],
  ])('backoff(%i) = %i ms', (n, ms) => {
    expect(backoff(n)).toBe(ms);
  });

  it('treats 0 or negative attempts as the first', () => {
    expect(backoff(0)).toBe(5 * MIN);
  });
});
