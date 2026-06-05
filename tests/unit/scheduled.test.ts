/**
 * Unit tests — scheduled() audit retention purge.
 *
 * The cron handler is the only thing that makes audit retention real (the table
 * is append-only). It must invoke the purge and must never throw: a missed
 * purge is a monitoring concern, not an incident.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPurge = vi.fn();
vi.mock('../../src/lib/audit', () => ({
  purgeExpiredAudit: (...a: unknown[]) => mockPurge(...a),
}));

const mockLog = vi.fn();
const mockLogError = vi.fn();
vi.mock('../../src/lib/logger', () => ({
  log: (...a: unknown[]) => mockLog(...a),
  logError: (...a: unknown[]) => mockLogError(...a),
}));

// Router is imported transitively by index; stub it so importing the entry
// module here doesn't drag the whole route graph into the unit test.
vi.mock('../../src/router', () => ({ route: vi.fn() }));
vi.mock('../../src/lib/rate-limiter-do', () => ({ RateLimiterDO: class {} }));

import worker from '../../src/index';

const env = { WKRP_DB: {} } as never;
const ctx = {} as never;
const controller = { cron: '17 4 * * *', scheduledTime: Date.now(), noRetry() {} } as never;

beforeEach(() => vi.clearAllMocks());

describe('scheduled audit purge', () => {
  it('invokes purgeExpiredAudit and logs the count', async () => {
    mockPurge.mockResolvedValue(3);
    await worker.scheduled!(controller, env, ctx);
    expect(mockPurge).toHaveBeenCalledWith(env);
    expect(mockLog).toHaveBeenCalledWith('SCHEDULED_AUDIT_PURGE', expect.objectContaining({ purged: 3 }));
  });

  it('never throws when the purge fails', async () => {
    mockPurge.mockRejectedValue(new Error('d1 down'));
    await expect(worker.scheduled!(controller, env, ctx)).resolves.toBeUndefined();
    expect(mockLogError).toHaveBeenCalled();
  });
});
