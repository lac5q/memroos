// @vitest-environment node
import Database from 'better-sqlite3';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const testDb = new Database(':memory:');

vi.mock('@/lib/db', () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockOllamaResponse(content: string, init?: ResponseInit) {
  return Promise.resolve(
    new Response(JSON.stringify({ message: { content } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      ...init,
    })
  );
}

const { initSchema } = await import('@/lib/db-schema');
initSchema(testDb);

afterAll(() => {
  testDb.close();
});

function seedMessage(sessionSuffix: string) {
  testDb.prepare(
    "INSERT OR IGNORE INTO messages(session_id, project, agent_id, role, content, timestamp) VALUES(?,?,?,?,?,?)"
  ).run(`sess-${sessionSuffix}`, 'p1', 'agent', 'user', `message ${sessionSuffix}`, '2024-01-01T00:00:00Z');
  testDb.exec("INSERT OR IGNORE INTO memory_salience(message_id) SELECT id FROM messages");
}

describe('runConsolidation', () => {
  beforeEach(() => {
    vi.resetModules();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(
      mockOllamaResponse(JSON.stringify([{ insight_type: 'pattern', content: 'Test pattern insight' }]))
    );
    testDb.exec('DELETE FROM memory_meta_insights');
    testDb.exec('DELETE FROM memory_consolidation_runs');
    testDb.exec('DELETE FROM memory_salience');
    testDb.exec('DELETE FROM messages');
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.CONSOLIDATION_MODEL;
  });

  it('marks messages as consolidated=1 after successful run', async () => {
    seedMessage('c1');
    const { runConsolidation } = await import('@/lib/memory-consolidation');
    const result = await runConsolidation();

    const row = testDb
      .prepare('SELECT COUNT(*) AS cnt FROM messages WHERE consolidated = 0')
      .get() as { cnt: number };
    expect(row.cnt).toBe(0);
    expect(result.status).toBe('completed');
  });

  it('creates a row in memory_consolidation_runs with status=completed', async () => {
    seedMessage('c2');
    const { runConsolidation } = await import('@/lib/memory-consolidation');
    const result = await runConsolidation();

    const run = testDb
      .prepare("SELECT status FROM memory_consolidation_runs ORDER BY id DESC LIMIT 1")
      .get() as { status: string } | undefined;
    expect(run?.status).toBe('completed');
    expect(result).toMatchObject({ status: 'completed' });
  });

  it('writes parsed meta-insights to memory_meta_insights', async () => {
    seedMessage('c3');
    testDb.exec('UPDATE messages SET consolidated = 0');
    const { runConsolidation } = await import('@/lib/memory-consolidation');
    const result = await runConsolidation();

    const insight = testDb
      .prepare('SELECT insight_type, content FROM memory_meta_insights LIMIT 1')
      .get() as { insight_type: string; content: string } | undefined;
    expect(insight?.insight_type).toBe('pattern');
    expect(insight?.content).toBe('Test pattern insight');
    expect(result).toMatchObject({ status: 'completed', insightsWritten: 1 });
  });

  it('skips already-consolidated messages (WHERE consolidated=0)', async () => {
    testDb.exec('UPDATE messages SET consolidated = 1');
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const { runConsolidation } = await import('@/lib/memory-consolidation');
    const result = await runConsolidation();

    const run = testDb
      .prepare('SELECT batch_size, status FROM memory_consolidation_runs ORDER BY id DESC LIMIT 1')
      .get() as { batch_size: number; status: string } | undefined;
    expect(run?.batch_size).toBe(0);
    expect(run?.status).toBe('completed');
    expect(result).toMatchObject({ status: 'completed', batchSize: 0, insightsWritten: 0 });
  });

  it('handles LLM JSON parse failure gracefully (returns empty insights)', async () => {
    mockFetch.mockResolvedValueOnce(mockOllamaResponse('not valid json at all'));
    seedMessage('c4');
    testDb.exec('UPDATE messages SET consolidated = 0');
    const { runConsolidation } = await import('@/lib/memory-consolidation');
    const result = await runConsolidation();

    const run = testDb
      .prepare('SELECT insights_written, status FROM memory_consolidation_runs ORDER BY id DESC LIMIT 1')
      .get() as { insights_written: number; status: string } | undefined;
    expect(run?.insights_written).toBe(0);
    expect(run?.status).toBe('completed');
    expect(result).toMatchObject({ status: 'completed', insightsWritten: 0 });
  });

  it('uses configured Ollama endpoint and model without requiring Anthropic credentials', async () => {
    process.env.OLLAMA_BASE_URL = 'http://ollama.test:11434';
    process.env.CONSOLIDATION_MODEL = 'qwen-local:test';
    seedMessage('ollama1');

    const { runConsolidation } = await import('@/lib/memory-consolidation');
    const result = await runConsolidation();

    expect(result).toMatchObject({ status: 'completed' });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://ollama.test:11434/api/chat',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(String),
      })
    );
    const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
    expect(body.model).toBe('qwen-local:test');
  });

  it('records failed status when Ollama returns a non-OK HTTP response', async () => {
    mockFetch.mockResolvedValueOnce(new Response('model unavailable', { status: 503 }));
    seedMessage('ollama-fail');
    const { runConsolidation } = await import('@/lib/memory-consolidation');
    const result = await runConsolidation();
    expect(result.status).toBe('failed');
    const run = testDb
      .prepare('SELECT status, error_message FROM memory_consolidation_runs ORDER BY id DESC LIMIT 1')
      .get() as { status: string; error_message: string | null } | undefined;
    expect(run?.status).toBe('failed');
    expect(String(run?.error_message ?? '')).toMatch(/Ollama API error/i);
  });

  it('skips provider calls during rate-limit backoff', async () => {
    seedMessage('rl1');
    testDb.prepare(
      "INSERT INTO memory_consolidation_runs(started_at, status, error_message) VALUES(strftime('%Y-%m-%dT%H:%M:%SZ','now'), 'failed', ?)"
    ).run('429 usage limit exceeded');

    const { runConsolidation } = await import('@/lib/memory-consolidation');
    const result = await runConsolidation();

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('provider_rate_limited');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('startConsolidationScheduler', () => {
  it('double-start guard prevents duplicate intervals', async () => {
    const { startConsolidationScheduler } = await import('@/lib/memory-consolidation');
    expect(() => {
      startConsolidationScheduler();
      startConsolidationScheduler();
    }).not.toThrow();
  });
});
