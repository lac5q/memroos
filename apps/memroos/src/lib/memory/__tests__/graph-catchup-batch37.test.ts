// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { projectMemoryFact, scrollQdrantPoints } from "../graph-catchup";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.QDRANT_API_KEY;
});

describe("graph-catchup batch37 — entity projection catch, scroll api key", () => {
  it.skip("defaultLog one-arg branch (121) — production log() always passes structured extra", () => {});

  it("projectMemoryFact continues when entity projection throws (407-415)", async () => {
    let calls = 0;
    const queryFn = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return { results: [{ data: [{ row: ["ok"] }] }], errors: [] as unknown[] };
      }
      throw new Error("entity projection failed batch37");
    });
    const result = await projectMemoryFact(
      {
        id: `fact-b37-${randomUUID().slice(0, 6)}`,
        content: "Acme Corp discussed MemRoOS graph catchup batch37 projection",
        source: "vector",
        agentId: "agent-b37",
        createdAt: "2026-11-14T10:00:00.000Z",
      },
      { queryFn },
    );
    expect(result).toBe("projected");
    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  it("projectMemoryFact returns dry_run without querying (392)", async () => {
    const queryFn = vi.fn(async () => ({ results: [], errors: [] as unknown[] }));
    const result = await projectMemoryFact(
      {
        id: `dry-b37-${randomUUID().slice(0, 6)}`,
        content: "dry run batch37",
        source: "episodic",
      },
      { dryRun: true, queryFn },
    );
    expect(result).toBe("dry_run");
    expect(queryFn).not.toHaveBeenCalled();
  });

  it("scrollQdrantPoints sends api-key header when configured (446-454)", async () => {
    process.env.QDRANT_API_KEY = `key-b37-${randomUUID().slice(0, 8)}`;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ result: { points: [], next_page_offset: null } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await scrollQdrantPoints(null, 2, { url: "http://localhost:6333", collection: "agent_memory_local" });
    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers as Record<string, string>;
    expect(headers["api-key"]).toBe(process.env.QDRANT_API_KEY);
  });
});