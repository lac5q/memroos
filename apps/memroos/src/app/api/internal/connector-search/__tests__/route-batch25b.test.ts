// @vitest-environment node
import Database from "better-sqlite3";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const testDb = new Database(":memory:");

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

testDb.exec(`
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    request_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'private',
    policy TEXT NOT NULL DEFAULT 'sealed',
    space_id TEXT
  );
  CREATE VIRTUAL TABLE messages_fts USING fts5(
    content, content=messages, content_rowid=id, tokenize='unicode61'
  );
  CREATE TRIGGER messages_ai AFTER INSERT ON messages
    WHEN new.policy = 'indexable' AND new.visibility IN ('internal','public_safe','public_approved')
    BEGIN
      INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
    END;
  CREATE TABLE space_members (
    space_id TEXT NOT NULL,
    member_id TEXT NOT NULL,
    member_type TEXT NOT NULL DEFAULT 'human',
    role TEXT NOT NULL DEFAULT 'member',
    PRIMARY KEY (space_id, member_id)
  );
`);

afterAll(() => {
  testDb.close();
});

beforeEach(() => {
  testDb.exec("DELETE FROM messages");
});

describe("GET /api/internal/connector-search batch25b", () => {
  it("respects limit query param on localhost", async () => {
    for (let i = 0; i < 5; i += 1) {
      testDb
        .prepare(
          `INSERT INTO messages (session_id, role, content, timestamp, request_id, visibility, policy)
           VALUES (?, 'connector', ?, '2026-07-20T00:00:00Z', ?, 'internal', 'indexable')`,
        )
        .run(`linear:conn-${i}`, `Alacriti connector hit ${i}`, `COR-${i}`);
    }
    const { GET } = await import("../route");
    const req = new Request("http://localhost/api/internal/connector-search?q=Alacriti&limit=2");
    const res = await GET(req as unknown as import("next/server").NextRequest);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.results.length).toBeLessThanOrEqual(2);
  });
});
