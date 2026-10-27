// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { initSchema } from "@/lib/db-schema";
import { getEmbedding } from "../store";
import {
  EMBEDDING_CYCLE_LIMIT,
  EMBEDDING_INTERVAL_MS,
  runEmbeddingCycle,
} from "../embedding-job";

vi.mock("../provider", () => ({
  embedText: vi.fn(),
  embeddingProviderEnabled: vi.fn(() => true),
}));

import { embedText } from "../provider";

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

function insertMessage(db: Database.Database, index: number): number {
  const result = db
    .prepare(
      `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      "embedding-job-test",
      "test-project",
      "test-agent",
      "user",
      `message ${index}`,
      new Date().toISOString(),
      "public_approved",
      "indexable"
    );
  return result.lastInsertRowid as number;
}

describe("embedding background job", () => {
  let db: Database.Database;
  const mockEmbedText = vi.mocked(embedText);

  beforeEach(() => {
    db = makeDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    db.close();
  });

  it("uses a 5-minute interval and 50-message cycle cap", () => {
    expect(EMBEDDING_INTERVAL_MS).toBe(300_000);
    expect(EMBEDDING_CYCLE_LIMIT).toBe(50);
  });

  it("embeds at most 50 messages per cycle", async () => {
    const ids = Array.from({ length: 55 }, (_, index) => insertMessage(db, index));
    mockEmbedText.mockResolvedValue({ embedding: [0.1, 0.2, 0.3], degraded: false });

    const result = await runEmbeddingCycle(db);

    expect(result).toEqual({ embedded: 50, degraded: false });
    const embeddedCount = ids.filter((id) => getEmbedding(db, id)).length;
    expect(embeddedCount).toBe(50);
  });

  it("writes no rows and does not throw when embeddings are degraded", async () => {
    const id = insertMessage(db, 1);
    mockEmbedText.mockResolvedValue({ embedding: null, degraded: true });

    await expect(runEmbeddingCycle(db)).resolves.toEqual({ embedded: 0, degraded: true });
    expect(getEmbedding(db, id)).toBeNull();
  });

  it("skips messages with empty content without calling the provider", async () => {
    db.prepare(
      `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "embedding-job-empty",
      "test-project",
      "test-agent",
      "user",
      "   ",
      new Date().toISOString(),
      "public_approved",
      "indexable"
    );

    const result = await runEmbeddingCycle(db);
    expect(result).toEqual({ embedded: 0, degraded: false });
    expect(mockEmbedText).not.toHaveBeenCalled();
  });

  it("returns degraded when the embedding cycle throws", async () => {
    const spy = vi.spyOn(await import("../store"), "messagesNeedingEmbedding").mockImplementation(() => {
      throw new Error("sqlite unavailable");
    });
    await expect(runEmbeddingCycle(db)).resolves.toEqual({ embedded: 0, degraded: true });
    spy.mockRestore();
  });

  it("does not schedule the background job when the provider is disabled", async () => {
    vi.resetModules();
    vi.doMock("../provider", () => ({
      embedText: vi.fn(),
      embeddingProviderEnabled: vi.fn(() => false),
    }));
    const intervalSpy = vi.spyOn(global, "setInterval");
    const { startEmbeddingJob } = await import("../embedding-job");
    startEmbeddingJob();
    startEmbeddingJob();
    expect(intervalSpy).not.toHaveBeenCalled();
    intervalSpy.mockRestore();
    vi.doUnmock("../provider");
    vi.resetModules();
  });
});
