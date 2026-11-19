// @vitest-environment node
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  GRAPH_CATCHUP_CHECKPOINT_ID,
  readGraphCatchupCheckpoint,
  writeGraphCatchupCheckpoint,
  projectMemoryFact,
} from "../graph-catchup";

describe("graph-catchup batch16c — checkpoint defaults and projection errors", () => {
  const testDb = new Database(":memory:");
  initSchema(testDb);

  it("readGraphCatchupCheckpoint returns seeded defaults when row missing", () => {
    const checkpoint = readGraphCatchupCheckpoint(testDb);
    expect(checkpoint.episodicLastId).toBe(0);
    expect(checkpoint.vectorLastCreatedAt).toBeNull();
  });

  it("writeGraphCatchupCheckpoint persists vector cursor fields", () => {
    const written = writeGraphCatchupCheckpoint(testDb, {
      id: GRAPH_CATCHUP_CHECKPOINT_ID,
      episodicLastId: 42,
      vectorLastCreatedAt: "2026-07-01T12:00:00.000Z",
      vectorLastId: "vector:abc",
      updatedAt: "2026-07-01T12:05:00.000Z",
    });
    expect(written.episodicLastId).toBe(42);
    const reread = readGraphCatchupCheckpoint(testDb);
    expect(reread.vectorLastId).toBe("vector:abc");
  });

  it("projectMemoryFact returns dry_run without touching Neo4j", async () => {
    const queryFn = vi.fn(async () => ({}));
    const mode = await projectMemoryFact(
      { id: "fact-dry", content: "dry run fact content", source: "test" },
      { dryRun: true, queryFn },
    );
    expect(mode).toBe("dry_run");
    expect(queryFn).not.toHaveBeenCalled();
  });
});
