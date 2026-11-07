// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { neo4jHttpQuery } from "../backends";

function stubAbortSignal(): void {
  vi.spyOn(AbortSignal, "timeout").mockImplementation(() => new AbortController().signal);
}

beforeEach(() => {
  stubAbortSignal();
  process.env.NEO4J_PASSWORD = "secret";
  process.env.NEO4J_HTTP_URL = "https://abcd.databases.neo4j.io";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.NEO4J_PASSWORD;
  delete process.env.NEO4J_HTTP_URL;
});

describe("memory backends batch26 — Neo4j v2 json catch and HTTP detail fallback", () => {
  it("neo4jHttpQuery uses empty body when response.json rejects on query/v2", async () => {
    stubAbortSignal();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("invalid json batch26");
        },
      })),
    );

    const result = await neo4jHttpQuery("RETURN 1");
    expect(result.results[0]?.columns).toEqual([]);
    expect(result.results[0]?.data).toEqual([]);
  });

  it("neo4jHttpQuery falls back to HTTP status when error payload is not an array", async () => {
    stubAbortSignal();
    const fetchMock = vi.fn(async (url: string) => {
      expect(String(url)).toContain("/query/v2");
      return {
        ok: false,
        status: 503,
        json: async () => ({ errors: "not-an-array" }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      await neo4jHttpQuery("RETURN 1");
      expect.unreachable("expected neo4jHttpQuery to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Neo4j query/v2 failed: HTTP 503");
    }
    expect(fetchMock).toHaveBeenCalled();
  });

  it("neo4jHttpQuery coerces non-array v2 values rows into single-cell rows", async () => {
    stubAbortSignal();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: { fields: ["n"], values: ["scalar-row-batch26"] },
        }),
      })),
    );

    const result = await neo4jHttpQuery("RETURN 1 AS n");
    expect(result.results[0]?.data[0]?.row).toEqual(["scalar-row-batch26"]);
  });
});
