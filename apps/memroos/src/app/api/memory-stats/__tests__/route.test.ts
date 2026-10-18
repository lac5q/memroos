// @vitest-environment node
import Database from 'better-sqlite3';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const testDb = new Database(':memory:');

vi.mock('@/lib/db', () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock('@/lib/auth/session', () => ({
  authenticateUser: vi.fn().mockResolvedValue({ userId: 'test-user', role: 'operator', email: '', displayName: '', tenantId: 'default' }),
}));

vi.mock('@/lib/auth/middleware-roles', () => ({
  requireRole: vi.fn().mockReturnValue(null),
}));

const { initSchema } = await import('@/lib/db-schema');
initSchema(testDb);

afterAll(() => {
  testDb.close();
});

function seedMessage(sessionSuffix: string, consolidated = 0, agentId = 'agent', timestamp = '2024-01-01T00:00:00Z') {
  const id = testDb.prepare(
    "INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, consolidated) VALUES(?,?,?,?,?,?,?)"
  ).run(`sess-${sessionSuffix}`, 'p1', agentId, 'user', `msg ${sessionSuffix}`, timestamp, consolidated).lastInsertRowid as number;
  testDb.prepare('INSERT OR IGNORE INTO memory_salience(message_id, tier) VALUES(?, ?)').run(id, 'mid');
  return id;
}

describe('GET /api/memory-stats', () => {
  beforeEach(() => {
    vi.resetModules();
    testDb.exec('DELETE FROM memory_meta_insights');
    testDb.exec('DELETE FROM memory_consolidation_runs');
    testDb.exec('DELETE FROM memory_salience');
    testDb.exec('DELETE FROM messages');
  });

  it('returns lastRun, pendingUnconsolidated, and tierStats', async () => {
    seedMessage('s1', 0);
    seedMessage('s2', 1);
    // Insert a completed run
    testDb.prepare(
      "INSERT INTO memory_consolidation_runs(batch_size, insights_written, status, completed_at) VALUES(1, 1, 'completed', '2024-01-01T00:00:00Z')"
    ).run();

    const { GET } = await import('../route');
    const req = new Request('http://localhost/api/memory-stats');
    const res = await GET(req as unknown as import('next/server').NextRequest);
    const body = await res.json();

    expect(body).toHaveProperty('lastRun');
    expect(body.lastRun).not.toBeNull();
    expect(body).toHaveProperty('pendingUnconsolidated');
    expect(body.pendingUnconsolidated).toBe(1);
    expect(body).toHaveProperty('tierStats');
    expect(Array.isArray(body.tierStats)).toBe(true);
    expect(body.lastRun).toHaveProperty('started_at');
    expect(body.lastRun).toHaveProperty('error_message');
    expect(body).toHaveProperty('recentFailures24h');
    expect(body).toHaveProperty('timestamp');
  });

  it('returns null lastRun when no consolidation runs exist', async () => {
    const { GET } = await import('../route');
    const req = new Request('http://localhost/api/memory-stats');
    const res = await GET(req as unknown as import('next/server').NextRequest);
    const body = await res.json();

    expect(body.lastRun).toBeNull();
  });

  it('pendingUnconsolidated decreases after marking messages consolidated', async () => {
    seedMessage('d1', 0);
    seedMessage('d2', 0);

    const { GET } = await import('../route');
    const req1 = new Request('http://localhost/api/memory-stats');
    const res1 = await GET(req1 as unknown as import('next/server').NextRequest);
    const body1 = await res1.json();
    expect(body1.pendingUnconsolidated).toBe(2);

    testDb.exec('UPDATE messages SET consolidated = 1');
    vi.resetModules();
    const { GET: GET2 } = await import('../route');
    const req2 = new Request('http://localhost/api/memory-stats');
    const res2 = await GET2(req2 as unknown as import('next/server').NextRequest);
    const body2 = await res2.json();
    expect(body2.pendingUnconsolidated).toBe(0);
  });

  it('returns recent failure count and latest error message', async () => {
    testDb.prepare(
      "INSERT INTO memory_consolidation_runs(started_at, batch_size, insights_written, status, error_message) VALUES(strftime('%Y-%m-%dT%H:%M:%SZ','now'), 0, 0, 'failed', ?)"
    ).run('429 usage limit exceeded');

    const { GET } = await import('../route');
    const res = await GET(new Request('http://localhost/api/memory-stats') as unknown as import('next/server').NextRequest);
    const body = await res.json();

    expect(body.lastRun.status).toBe('failed');
    expect(body.lastRun.error_message).toContain('429');
    expect(body.recentFailures24h).toBe(1);
  });

  it('returns 401 when session authentication fails', async () => {
    const auth = await import('@/lib/auth/session');
    vi.mocked(auth.authenticateUser).mockResolvedValueOnce(null);
    const { GET } = await import('../route');
    const res = await GET(new Request('http://localhost/api/memory-stats') as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(401);
  });

  it('treats invalid window query as all-time scope', async () => {
    seedMessage('invalid-window', 0);
    const { GET } = await import('../route');
    const res = await GET(
      new Request('http://localhost/api/memory-stats?window=invalid&workspace=all') as unknown as import('next/server').NextRequest
    );
    const body = await res.json();
    expect(body.metrics.pendingUnconsolidated.scope.window).toBe('all');
    expect(body.pendingUnconsolidated).toBe(1);
  });

  it('filters message inventory by requested window and workspace', async () => {
    seedMessage('recent-local', 0, 'codex', new Date(Date.now() - 60 * 60 * 1000).toISOString());
    seedMessage('recent-remote', 0, 'zapier', new Date(Date.now() - 60 * 60 * 1000).toISOString());
    seedMessage('old-local', 0, 'codex', new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString());

    const { GET } = await import('../route');
    const localRes = await GET(new Request('http://localhost/api/memory-stats?window=day&workspace=local') as unknown as import('next/server').NextRequest);
    const localBody = await localRes.json();
    const remoteRes = await GET(new Request('http://localhost/api/memory-stats?window=day&workspace=remote') as unknown as import('next/server').NextRequest);
    const remoteBody = await remoteRes.json();

    expect(localBody.pendingUnconsolidated).toBe(1);
    expect(localBody.sources).toEqual([{ agent_id: 'codex', cnt: 1 }]);
    expect(localBody.tierStats).toHaveLength(1);
    expect(localBody.tierStats[0].count).toBe(1);
    expect(remoteBody.pendingUnconsolidated).toBe(1);
    expect(remoteBody.sources).toEqual([{ agent_id: 'zapier', cnt: 1 }]);
  });
});

describe("GET /api/memory-stats truthful metric contract (VAL-LIB-002)", () => {
  beforeEach(() => {
    testDb.exec('DELETE FROM memory_meta_insights');
    testDb.exec('DELETE FROM memory_consolidation_runs');
    testDb.exec('DELETE FROM memory_salience');
    testDb.exec('DELETE FROM messages');
  });

  it("returns metric envelopes for pendingUnconsolidated, recentFailures24h, and lastRun", async () => {
    seedMessage('s1', 0, 'agent', new Date(Date.now() - 60 * 60 * 1000).toISOString());
    testDb.prepare(
      "INSERT INTO memory_consolidation_runs(started_at, batch_size, insights_written, status, error_message) VALUES(strftime('%Y-%m-%dT%H:%M:%SZ','now'), 0, 0, 'failed', '429 usage limit exceeded')"
    ).run();

    const { GET } = await import('../route');
    const res = await GET(new Request('http://localhost/api/memory-stats?window=week&workspace=all') as unknown as import('next/server').NextRequest);
    const body = await res.json();

    expect(body.metrics).toBeDefined();
    expect(body.metrics.pendingUnconsolidated).toMatchObject({
      status: 'live',
      value: 1,
      source: 'sqlite://messages',
      scope: expect.objectContaining({ window: 'week', workspace: 'all' }),
    });
    expect(body.metrics.recentFailures24h).toMatchObject({
      status: expect.stringMatching(/^(live|empty|error)$/),
      value: expect.any(Number),
      source: 'sqlite://memory_consolidation_runs',
    });
    // lastRun (a failed run) -> degraded with reason, not zero
    expect(body.metrics.lastRun).toMatchObject({
      status: 'degraded',
      value: null,
      reason: expect.stringMatching(/429|fail|error/i),
    });
    // No consolidation at all should produce lastRun.status === unavailable
    testDb.exec('DELETE FROM memory_consolidation_runs');
    vi.resetModules();
    const { GET: GET2 } = await import('../route');
    const emptyBody = await (await GET2(new Request('http://localhost/api/memory-stats?window=week&workspace=all') as unknown as import('next/server').NextRequest)).json();
    expect(emptyBody.metrics.lastRun.status).toBe('unavailable');
    expect(emptyBody.metrics.lastRun.value).toBeNull();
    expect(emptyBody.metrics.lastRun.reason).toBeTruthy();
  });
});
