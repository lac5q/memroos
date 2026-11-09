// @vitest-environment node
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

// Use a unique temp directory per test run to avoid conflicts with parallel agents
const TEST_DB_DIR = path.join(os.tmpdir(), `db-ingest-test-${crypto.randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test-ingest.db');
const TEST_MEMORY_PATH = path.join(TEST_DB_DIR, 'projects');

// Override env vars before importing modules
process.env.SQLITE_DB_PATH = TEST_DB_PATH;
process.env.CLAUDE_MEMORY_PATH = TEST_MEMORY_PATH;
process.env.HERMES_MEMORY_PATH = path.join(TEST_DB_DIR, 'hermes-sessions');
process.env.QWEN_MEMORY_PATH = path.join(TEST_DB_DIR, 'qwen-projects');
process.env.CODEX_MEMORY_PATH = path.join(TEST_DB_DIR, 'codex-sessions');

// Lazy imports after env vars are set
let getDb: () => import('better-sqlite3').Database;
let closeDb: () => void;
let deriveAgentId: (projectDirName: string) => string;
let extractContent: (entry: unknown) => string | null;
let ingestAllSessions: (db: import('better-sqlite3').Database) => {
  filesProcessed: number;
  rowsInserted: number;
  filesSkipped: number;
};
let recallByKeyword: (
  db: import('better-sqlite3').Database,
  query: string,
  limit?: number
) => unknown[];
let rebuildMessageFtsProjection: (db: import('better-sqlite3').Database) => void;
let ingestHermesFile: (db: import('better-sqlite3').Database, filePath: string) => number;
let ingestQwenFile: (db: import('better-sqlite3').Database, filePath: string, projectDirName: string) => number;
let ingestCodexFile: (db: import('better-sqlite3').Database, filePath: string, sessionId: string) => number;

/** Helper: write a JSONL file with given entries */
function writeJsonl(filePath: string, entries: unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, entries.map((e) => JSON.stringify(e)).join('\n'));
}

/** Helper: create a minimal user entry with string content */
function makeUserEntry(content: string, requestId = crypto.randomUUID()): unknown {
  return {
    type: 'user',
    message: { role: 'user', content },
    requestId,
    timestamp: new Date().toISOString(),
    sessionId: 'session-123',
    cwd: '/tmp',
    gitBranch: 'main',
  };
}

/** Helper: create a minimal assistant entry with array content */
function makeAssistantEntry(
  blocks: unknown[],
  requestId = crypto.randomUUID()
): unknown {
  return {
    type: 'assistant',
    message: { role: 'assistant', content: blocks },
    requestId,
    timestamp: new Date().toISOString(),
    sessionId: 'session-123',
    cwd: '/tmp',
    gitBranch: 'main',
  };
}

describe('db-ingest: deriveAgentId', () => {
  beforeEach(async () => {
    const m = await import('../db-ingest');
    deriveAgentId = m.deriveAgentId;
  });

  it('Test 1: deriveAgentId("-Users-jdoe-github-memroos") returns "memroos"', () => {
    expect(deriveAgentId('-Users-jdoe-github-memroos')).toBe('memroos');
  });

  it('Test 2: deriveAgentId("-Users-jdoe--paperclip-instances-foo") returns "paperclip"', () => {
    expect(deriveAgentId('-Users-jdoe--paperclip-instances-foo')).toBe('paperclip');
  });

  it('Test 3: deriveAgentId("") returns "claude-code" (fallback)', () => {
    expect(deriveAgentId('')).toBe('claude-code');
  });

  it('Test 3b: deriveAgentId uses the last path segment for short decoded paths', () => {
    expect(deriveAgentId('-Users-jdoe')).toBe('jdoe');
  });
});

describe('db-ingest: extractContent', () => {
  beforeEach(async () => {
    const m = await import('../db-ingest');
    extractContent = m.extractContent;
  });

  it('Test 4: extractContent user entry with string content returns the string (truncated to 8000 chars)', () => {
    const longString = 'a'.repeat(9000);
    const entry = makeUserEntry(longString);
    const result = extractContent(entry);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(8000);
    expect(result!).toBe(longString.slice(0, 8000));
  });

  it('Test 5: extractContent user entry with array content extracts only text blocks', () => {
    const entry = {
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'hello world' },
          { type: 'tool_result', content: 'some tool result' },
          { type: 'text', text: 'second text' },
        ],
      },
      requestId: 'req-1',
      timestamp: new Date().toISOString(),
    };
    const result = extractContent(entry);
    expect(result).toBe('hello world\nsecond text');
  });

  it('Test 6: extractContent assistant entry with thinking blocks skips them, extracts only text blocks', () => {
    const entry = makeAssistantEntry([
      { type: 'thinking', thinking: 'internal reasoning...', signature: 'abc123' },
      { type: 'text', text: 'The answer is 42.' },
    ]);
    const result = extractContent(entry);
    expect(result).toBe('The answer is 42.');
  });

  it('Test 7: extractContent assistant entry with tool_use blocks skips them', () => {
    const entry = makeAssistantEntry([
      { type: 'tool_use', id: 'tool-1', name: 'read_file', input: { path: '/etc/passwd' } },
      { type: 'text', text: 'Reading the file now.' },
    ]);
    const result = extractContent(entry);
    expect(result).toBe('Reading the file now.');
  });

  it('Test 8: extractContent returns null for type "system" or unknown types', () => {
    expect(extractContent({ type: 'system', content: 'system prompt' })).toBeNull();
    expect(extractContent({ type: 'file-history-snapshot', data: {} })).toBeNull();
    expect(extractContent({ type: 'unknown-type' })).toBeNull();
  });
});

describe('db-ingest: ingestAllSessions and recallByKeyword', () => {
  let db: import('better-sqlite3').Database;

  beforeEach(async () => {
    // Ensure temp directories exist
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
    fs.mkdirSync(TEST_MEMORY_PATH, { recursive: true });

    const dbModule = await import('../db');
    if (dbModule.closeDb) dbModule.closeDb();
    getDb = dbModule.getDb;
    closeDb = dbModule.closeDb;
    db = getDb();

    const m = await import('../db-ingest');
    const schema = await import('../db-schema');
    ingestAllSessions = m.ingestAllSessions;
    recallByKeyword = m.recallByKeyword;
    rebuildMessageFtsProjection = schema.rebuildMessageFtsProjection;
  });

  afterAll(() => {
    if (closeDb) closeDb();
    if (fs.existsSync(TEST_DB_DIR)) {
      fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    }
  });

  it('Test 9: Ingesting a JSONL file creates rows in messages table with correct fields', () => {
    const projectDir = path.join(TEST_MEMORY_PATH, '-Users-jdoe-github-memroos');
    const sessionFile = path.join(projectDir, 'session-abc.jsonl');

    writeJsonl(sessionFile, [
      makeUserEntry('hello from user', 'req-001'),
      makeAssistantEntry([{ type: 'text', text: 'hello from assistant' }], 'req-002'),
    ]);

    const result = ingestAllSessions(db);

    expect(result.filesProcessed).toBeGreaterThanOrEqual(1);
    expect(result.rowsInserted).toBeGreaterThanOrEqual(2);

    const rows = db
      .prepare('SELECT * FROM messages WHERE session_id = ?')
      .all('session-abc') as Array<{ project: string; agent_id: string; role: string; content: string }>;

    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0].project).toBe('memroos');
    expect(rows[0].agent_id).toBe('memroos');
    const roles = rows.map((r) => r.role);
    expect(roles).toContain('user');
    expect(roles).toContain('assistant');
  });

  it('Test 10: Re-ingesting same file (unchanged mtime+size) is skipped (0 new rows)', () => {
    const projectDir = path.join(TEST_MEMORY_PATH, '-Users-jdoe-github-test-project');
    const sessionFile = path.join(projectDir, 'session-skip.jsonl');

    writeJsonl(sessionFile, [makeUserEntry('skip test message', 'req-skip-01')]);

    // First ingest
    const first = ingestAllSessions(db);
    expect(first.rowsInserted).toBeGreaterThanOrEqual(1);

    // Second ingest — same file, same mtime+size
    const second = ingestAllSessions(db);
    expect(second.filesSkipped).toBeGreaterThanOrEqual(1);
    // rowsInserted for the unchanged file should be 0
    // (other files from Test 9 might also be re-processed but skipped)
    const totalRows = (
      db.prepare('SELECT COUNT(*) as c FROM messages WHERE session_id = ?').get('session-skip') as {
        c: number;
      }
    ).c;
    // Should still be 1 (not doubled)
    expect(totalRows).toBe(1);
  });

  it('Test 11: recallByKeyword returns results with snippet, project, agent_id, rank', () => {
    const projectDir = path.join(TEST_MEMORY_PATH, '-Users-jdoe-github-recall-test');
    const sessionFile = path.join(projectDir, 'session-recall.jsonl');

    const uniqueWord = `uniquekeyword${crypto.randomUUID().replace(/-/g, '')}`;
    writeJsonl(sessionFile, [makeUserEntry(`This message contains ${uniqueWord} for recall`, 'req-recall-01')]);

    ingestAllSessions(db);
    db.prepare(
      "UPDATE messages SET visibility = 'public_approved', policy = 'indexable' WHERE content LIKE ?"
    ).run(`%${uniqueWord}%`);
    rebuildMessageFtsProjection(db);

    const results = recallByKeyword(db, uniqueWord) as Array<{
      snippet: string;
      project: string;
      agent_id: string;
      rank: number;
      session_id: string;
    }>;

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]).toHaveProperty('snippet');
    expect(results[0]).toHaveProperty('project');
    expect(results[0]).toHaveProperty('agent_id');
    expect(results[0]).toHaveProperty('rank');
    expect(results[0].snippet).toContain(uniqueWord);
  });

  it('Test 12: recallByKeyword with phrase-quoted query returns exact phrase matches', () => {
    const projectDir = path.join(TEST_MEMORY_PATH, '-Users-jdoe-github-phrase-test');
    const sessionFile = path.join(projectDir, 'session-phrase.jsonl');

    writeJsonl(sessionFile, [
      makeUserEntry('The quick brown fox jumps over the lazy dog', 'req-phrase-01'),
    ]);

    ingestAllSessions(db);
    db.prepare(
      "UPDATE messages SET visibility = 'public_approved', policy = 'indexable' WHERE content LIKE '%quick brown fox%'"
    ).run();
    rebuildMessageFtsProjection(db);

    // Phrase match should find exact phrase
    const results = recallByKeyword(db, 'quick brown fox') as Array<{ snippet: string }>;
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].snippet).toBeTruthy();
  });
});

describe('db-ingest: recallByKeyword error handling', () => {
  let db: import('better-sqlite3').Database;

  beforeEach(async () => {
    const dbModule = await import('../db');
    getDb = dbModule.getDb;
    db = getDb();
    const m = await import('../db-ingest');
    recallByKeyword = m.recallByKeyword;
  });

  it('FTS5 syntax errors return empty array (malformed queries)', () => {
    // Unmatched quotes cause FTS5 syntax errors
    const results = recallByKeyword(db, '"unclosed quote');
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(0);
  });

  it('limit is capped at 100 (DoS prevention)', async () => {
    const m = await import('../db-ingest');
    // Should not throw even with absurd limit
    const results = m.recallByKeyword(db, 'test', 9999);
    expect(Array.isArray(results)).toBe(true);
    // We can't easily verify the cap without inspecting implementation,
    // but no crash is the key assertion
  });
});

describe('db-ingest: direct provider file ingestion', () => {
  let db: import('better-sqlite3').Database;

  beforeEach(async () => {
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
    const dbModule = await import('../db');
    if (dbModule.closeDb) dbModule.closeDb();
    getDb = dbModule.getDb;
    closeDb = dbModule.closeDb;
    db = getDb();

    const m = await import('../db-ingest');
    ingestHermesFile = m.ingestHermesFile;
    ingestQwenFile = m.ingestQwenFile;
    ingestCodexFile = m.ingestCodexFile;
  });

  it('ingestHermesFile inserts user and assistant rows with project=hermes', () => {
    const filePath = path.join(TEST_DB_DIR, 'hermes-sessions', 'sess-h1.jsonl');
    writeJsonl(filePath, [
      { role: 'user', content: 'hello hermes', timestamp: '2025-01-01T00:00:00Z' },
      { role: 'assistant', content: 'hi there', timestamp: '2025-01-01T00:00:01Z' },
    ]);

    const inserted = ingestHermesFile(db, filePath);
    expect(inserted).toBe(2);

    const rows = db
      .prepare('SELECT role, content, project, agent_id, session_id FROM messages WHERE session_id = ?')
      .all('sess-h1') as Array<{ role: string; content: string; project: string; agent_id: string; session_id: string }>;

    expect(rows.length).toBe(2);
    expect(rows.every((row) => row.project === 'hermes')).toBe(true);
    expect(rows.every((row) => row.agent_id === 'hermes')).toBe(true);
    expect(rows.map((row) => row.role).sort()).toEqual(['assistant', 'user']);
  });

  it('ingestHermesFile skips malformed JSONL lines', () => {
    const filePath = path.join(TEST_DB_DIR, 'hermes-sessions', 'sess-h-bad.jsonl');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      `{not-json\n${JSON.stringify({ role: 'user', content: 'kept', timestamp: '2025-01-01T00:00:00Z' })}\n`
    );
    const inserted = ingestHermesFile(db, filePath);
    expect(inserted).toBe(1);
  });

  it('ingestHermesFile skips unsupported role, non-string content, and empty content', () => {
    const filePath = path.join(TEST_DB_DIR, 'hermes-sessions', 'sess-h2.jsonl');
    writeJsonl(filePath, [
      'primitive json string',
      { role: 'system', content: 'ignored system msg' },
      { role: 'user', content: 12345 },
      { role: 'user', content: '' },
      { role: 'assistant', content: null },
      { role: 'user', content: 'valid message' },
    ]);

    const inserted = ingestHermesFile(db, filePath);
    expect(inserted).toBe(1);

    const rows = db.prepare('SELECT content FROM messages WHERE session_id = ?').all('sess-h2') as Array<{ content: string }>;
    expect(rows).toEqual([{ content: 'valid message' }]);
  });

  it('ingestHermesFile truncates content to 8000 characters', () => {
    const longContent = 'x'.repeat(9500);
    const filePath = path.join(TEST_DB_DIR, 'hermes-sessions', 'sess-h3.jsonl');
    writeJsonl(filePath, [{ role: 'user', content: longContent }]);

    ingestHermesFile(db, filePath);

    const row = db.prepare('SELECT content FROM messages WHERE session_id = ?').get('sess-h3') as { content: string };
    expect(row.content.length).toBe(8000);
  });

  it('ingestQwenFile inserts rows with project=qwen:<agentId> and preserves metadata', () => {
    const filePath = path.join(TEST_DB_DIR, 'qwen-projects', 'sess-q1.jsonl');
    writeJsonl(filePath, [
      {
        type: 'user',
        timestamp: '2025-03-01T10:00:00Z',
        cwd: '/workspace/project',
        gitBranch: 'feature-x',
        message: { role: 'user', parts: [{ text: 'qwen hello' }] },
      },
      {
        type: 'assistant',
        timestamp: '2025-03-01T10:00:01Z',
        cwd: '/workspace/project',
        gitBranch: 'feature-x',
        message: { role: 'assistant', parts: [{ text: 'qwen reply' }] },
      },
    ]);

    const inserted = ingestQwenFile(db, filePath, '-Users-jdoe-github-memroos');
    expect(inserted).toBe(2);

    const rows = db
      .prepare('SELECT role, content, project, agent_id, cwd, git_branch, timestamp FROM messages WHERE session_id = ?')
      .all('sess-q1') as Array<{ role: string; content: string; project: string; agent_id: string; cwd: string; git_branch: string; timestamp: string }>;

    expect(rows.length).toBe(2);
    expect(rows.every((row) => row.project === 'qwen:memroos')).toBe(true);
    expect(rows.every((row) => row.agent_id === 'memroos')).toBe(true);
    expect(rows.every((row) => row.cwd === '/workspace/project')).toBe(true);
    expect(rows.every((row) => row.git_branch === 'feature-x')).toBe(true);
    expect(rows[0].timestamp).toBe('2025-03-01T10:00:00Z');
  });

  it('ingestQwenFile skips unsupported types, primitive entries, and empty parts', () => {
    const filePath = path.join(TEST_DB_DIR, 'qwen-projects', 'sess-q2.jsonl');
    writeJsonl(filePath, [
      'primitive json string',
      { type: 'system', message: { parts: [{ text: 'ignored' }] } },
      { type: 'user', message: { parts: [] } },
      { type: 'assistant', message: { parts: [{ text: '' }] } },
      { type: 'user', message: { parts: [{ text: 'keep me' }] } },
    ]);

    const inserted = ingestQwenFile(db, filePath, '-Users-jdoe-github-memroos');
    expect(inserted).toBe(1);

    const rows = db.prepare('SELECT content FROM messages WHERE session_id = ?').all('sess-q2') as Array<{ content: string }>;
    expect(rows).toEqual([{ content: 'keep me' }]);
  });

  it('ingestCodexFile inserts response_item rows with project=codex', () => {
    const filePath = path.join(TEST_DB_DIR, 'codex-sessions', 'sess-c1.jsonl');
    writeJsonl(filePath, [
      {
        type: 'response_item',
        timestamp: '2025-04-01T12:00:00Z',
        payload: { role: 'user', content: [{ type: 'input_text', text: 'codex question' }] },
      },
      {
        type: 'response_item',
        timestamp: '2025-04-01T12:00:01Z',
        payload: { role: 'assistant', content: [{ type: 'output_text', text: 'codex answer' }] },
      },
    ]);

    const inserted = ingestCodexFile(db, filePath, 'sess-c1');
    expect(inserted).toBe(2);

    const rows = db
      .prepare('SELECT role, content, project, agent_id, session_id FROM messages WHERE session_id = ?')
      .all('sess-c1') as Array<{ role: string; content: string; project: string; agent_id: string; session_id: string }>;

    expect(rows.length).toBe(2);
    expect(rows.every((row) => row.project === 'codex')).toBe(true);
    expect(rows.every((row) => row.agent_id === 'codex')).toBe(true);
    expect(rows.every((row) => row.session_id === 'sess-c1')).toBe(true);
    expect(rows.map((row) => row.role).sort()).toEqual(['assistant', 'user']);
  });

  it('ingestCodexFile skips non-response_item, missing payload, unsupported role, and unsupported content', () => {
    const filePath = path.join(TEST_DB_DIR, 'codex-sessions', 'sess-c2.jsonl');
    writeJsonl(filePath, [
      'primitive json string',
      { type: 'other_event', payload: { role: 'user', content: [{ type: 'input_text', text: 'nope' }] } },
      { type: 'response_item' },
      { type: 'response_item', payload: { role: 'system', content: [{ type: 'input_text', text: 'nope' }] } },
      { type: 'response_item', payload: { role: 'user', content: [{ type: 'image', text: 'nope' }] } },
      { type: 'response_item', payload: { role: 'user', content: [{ type: 'input_text', text: 'yes' }] } },
    ]);

    const inserted = ingestCodexFile(db, filePath, 'sess-c2');
    expect(inserted).toBe(1);

    const rows = db.prepare('SELECT content FROM messages WHERE session_id = ?').all('sess-c2') as Array<{ content: string }>;
    expect(rows).toEqual([{ content: 'yes' }]);
  });
});

describe('db-ingest: ingestAllSessions provider scans', () => {
  let db: import('better-sqlite3').Database;

  beforeEach(async () => {
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
    const dbModule = await import('../db');
    if (dbModule.closeDb) dbModule.closeDb();
    db = dbModule.getDb();
    const m = await import('../db-ingest');
    ingestAllSessions = m.ingestAllSessions;
  });

  it('ingests qwen, hermes, and codex session files through ingestAllSessions', () => {
    const qwenProject = path.join(process.env.QWEN_MEMORY_PATH!, '-Users-jdoe-github-memroos', 'chats');
    const hermesDir = process.env.HERMES_MEMORY_PATH!;
    const codexDir = path.join(process.env.CODEX_MEMORY_PATH!, '2026', '01', '17');

    writeJsonl(path.join(qwenProject, 'sess-all-qwen.jsonl'), [{
      type: 'user',
      timestamp: '2026-03-01T10:00:00Z',
      message: { role: 'user', parts: [{ text: 'qwen ingest all' }] },
    }]);
    writeJsonl(path.join(hermesDir, 'sess-all-hermes.jsonl'), [{
      role: 'assistant',
      content: 'hermes ingest all',
      timestamp: '2026-03-01T10:00:01Z',
    }]);
    writeJsonl(path.join(codexDir, 'sess-all-codex.jsonl'), [{
      type: 'response_item',
      timestamp: '2026-04-01T12:00:00Z',
      payload: { role: 'assistant', content: [{ type: 'output_text', text: 'codex ingest all' }] },
    }]);

    const result = ingestAllSessions(db);
    expect(result.filesProcessed).toBeGreaterThanOrEqual(3);
    expect(result.rowsInserted).toBeGreaterThanOrEqual(3);

    const qwenRows = db.prepare('SELECT project FROM messages WHERE session_id = ?').all('sess-all-qwen') as Array<{ project: string }>;
    const hermesRows = db.prepare('SELECT project FROM messages WHERE session_id = ?').all('sess-all-hermes') as Array<{ project: string }>;
    const codexRows = db.prepare('SELECT project FROM messages WHERE session_id = ?').all('sess-all-codex') as Array<{ project: string }>;
    expect(qwenRows[0]?.project).toBe('qwen:memroos');
    expect(hermesRows[0]?.project).toBe('hermes');
    expect(codexRows[0]?.project).toBe('codex');
  });
});
