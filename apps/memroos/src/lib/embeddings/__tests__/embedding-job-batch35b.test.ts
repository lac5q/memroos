// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { initSchema } from "@/lib/db-schema";

vi.mock("../provider", () => ({
  embedText: vi.fn(async () => ({ embedding: [0.1], degraded: false })),
  embeddingProviderEnabled: vi.fn(() => true),
}));

import { embedText, embeddingProviderEnabled } from "../provider";

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

describe("embedding-job batch35b", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
    vi.clearAllMocks();
    vi.mocked(embeddingProviderEnabled).mockReturnValue(true);
  });

  afterEach(() => {
    db.close();
    vi.resetModules();
  });

  it("skips rows without content (33) and returns degraded when embed reports degraded (36–37)", async () => {
    const sessionId = `sess-b35b-${randomUUID().slice(0, 8)}`;
    const emptyInsert = db
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES (?, 'p', 'a', 'user', '', datetime('now'), 'public_approved', 'indexable')`,
      )
      .run(sessionId);
    const emptyId = Number(emptyInsert.lastInsertRowid);
    const withBody = db
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES (?, 'p', 'a', 'user', 'has-body', datetime('now'), 'public_approved', 'indexable')`,
      )
      .run(`${sessionId}-2`);
    const bodyId = Number(withBody.lastInsertRowid);
    vi.mocked(embedText).mockResolvedValueOnce({ embedding: [0.2], degraded: true });
    const store = await import("../store");
    const spy = vi.spyOn(store, "messagesNeedingEmbedding").mockReturnValue([emptyId, bodyId]);
    const { runEmbeddingCycle } = await import("../embedding-job");
    const result = await runEmbeddingCycle(db);
    expect(result.degraded).toBe(true);
    expect(vi.mocked(embedText)).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("startEmbeddingJob no-ops when provider disabled (52–56)", async () => {
    vi.resetModules();
    vi.doMock("../provider", () => ({
      embedText: vi.fn(),
      embeddingProviderEnabled: vi.fn(() => false),
    }));
    const intervalSpy = vi.spyOn(global, "setInterval").mockReturnValue({ unref: vi.fn() } as never);
    const { startEmbeddingJob } = await import("../embedding-job");
    startEmbeddingJob();
    expect(intervalSpy).not.toHaveBeenCalled();
    intervalSpy.mockRestore();
    vi.doUnmock("../provider");
  });
});
