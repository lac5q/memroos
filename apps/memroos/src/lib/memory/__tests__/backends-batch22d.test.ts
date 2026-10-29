// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { GraphMemoryAdapter } from "../backends";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.NEO4J_PASSWORD;
  delete process.env.NEO4J_HTTP_URL;
});

function stubAbortSignal(): void {
  vi.spyOn(AbortSignal, "timeout").mockImplementation(() => new AbortController().signal);
}

beforeEach(() => {
  stubAbortSignal();
});

describe("memory backends batch22d — Neo4j query v2 and graph normalization", () => {
  it("GraphMemoryAdapter.write falls back to mem0 when Neo4j is not configured", async () => {
    delete process.env.NEO4J_PASSWORD;
    stubAbortSignal();
    const adapter = new GraphMemoryAdapter();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok", { status: 200 })),
    );
    await expect(adapter.write({ content: "batch22d graph write" })).resolves.toBeUndefined();
  });

  it("GraphMemoryAdapter.search JSON-stringifies opaque node payloads", async () => {
    stubAbortSignal();
    process.env.NEO4J_PASSWORD = "secret";
    process.env.NEO4J_HTTP_URL = "http://localhost:7474";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          results: [{ columns: ["n"], data: [{ row: [42] }] }],
          errors: [],
        }),
      ),
    );
    const adapter = new GraphMemoryAdapter();
    const hits = await adapter.search("", 1);
    expect(hits[0]?.content).toBe("42");
  });
});
