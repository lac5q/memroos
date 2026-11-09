// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  isAfterVectorCursor,
  projectMemoryFact,
  scrollQdrantPoints,
  countNeo4jNodes,
} from "../graph-catchup";

describe("graph-catchup batch15 — cursor tie-breaks and qdrant guard", () => {
  it("isAfterVectorCursor compares id-only cursors when createdAt missing", () => {
    const cursor = { vectorLastCreatedAt: null, vectorLastId: "aaa" };
    expect(isAfterVectorCursor({ id: "vector:bbb", createdAt: null }, cursor)).toBe(true);
    expect(isAfterVectorCursor({ id: "vector:aaa", createdAt: null }, cursor)).toBe(false);
  });

  it("projectMemoryFact returns dry_run without calling neo4j", async () => {
    const queryFn = vi.fn(async () => ({}));
    const mode = await projectMemoryFact(
      { id: "fact-1", content: "Alice met Bob", source: "test" },
      { dryRun: true, queryFn },
    );
    expect(mode).toBe("dry_run");
    expect(queryFn).not.toHaveBeenCalled();
  });

  it("scrollQdrantPoints throws when QDRANT_URL is unset", async () => {
    let message = "";
    try {
      await scrollQdrantPoints(null, 10, { url: "" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("QDRANT_URL");
  });

  it("countNeo4jNodes parses numeric string counts", async () => {
    const count = await countNeo4jNodes(async () => ({
      results: [{ data: [{ row: ["42"] }] }],
    }));
    expect(count).toBe(42);
  });
});
