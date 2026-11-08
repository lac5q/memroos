// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { runEmbeddingCycle, startEmbeddingJob } from "../embedding-job";

vi.mock("../provider", () => ({
  embedText: vi.fn(),
  embeddingProviderEnabled: vi.fn(() => true),
}));

import { embedText, embeddingProviderEnabled } from "../provider";

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

describe("embedding-job batch18b", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    db.close();
    vi.resetModules();
  });

  it("runEmbeddingCycle returns degraded when embedText throws mid-cycle", async () => {
    db.prepare(
      `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("s1", "p", "a", "user", "hello embed b18b", new Date().toISOString(), "public_approved", "indexable");
    vi.mocked(embedText).mockRejectedValueOnce(new Error("provider unavailable"));
    const result = await runEmbeddingCycle(db);
    expect(result.embedded).toBe(0);
    expect(result.degraded).toBe(true);
  });

  it("startEmbeddingJob schedules interval when provider enabled", async () => {
    vi.resetModules();
    vi.doMock("../provider", () => ({
      embedText: vi.fn(),
      embeddingProviderEnabled: vi.fn(() => true),
    }));
    const intervalSpy = vi.spyOn(global, "setInterval").mockReturnValue({ unref: vi.fn() } as never);
    const { startEmbeddingJob: startFresh } = await import("../embedding-job");
    startFresh();
    expect(intervalSpy).toHaveBeenCalled();
    intervalSpy.mockRestore();
    vi.doUnmock("../provider");
    void embeddingProviderEnabled;
  });
});
