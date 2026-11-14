// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { runMemoryRecallEvalSuite } from "@/lib/memory-recall-evals";

describe("memory-recall-evals batch37b — vector write json catch (516)", () => {
  const db = new Database(":memory:");
  initSchema(db);

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    delete process.env.MEMORY_RECALL_EVAL_CASES_PATH;
    delete process.env.MEMORY_EVAL_VECTOR_TIMEOUT_MS;
  });

  it("seedFixture uses json().catch empty object when vector add body is not JSON", async () => {
    const casesPath = path.join(os.tmpdir(), `mre-b37b-json-${crypto.randomUUID()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        {
          id: "vector-bad-json-body",
          layer: "gold",
          scenario: "vector add returns non-json",
          agentId: "memory-eval",
          taskPrompt: "noop",
          expectedFacts: ["token-b37b"],
          expectedTiers: ["vector"],
          requiredTiming: "before_plan",
          fixtures: [{ id: "fix-b37b", tier: "vector", content: "token-b37b payload" }],
        },
      ]),
      "utf8",
    );
    vi.stubEnv("MEMORY_RECALL_EVAL_CASES_PATH", casesPath);
    vi.stubEnv("MEMORY_EVAL_VECTOR_TIMEOUT_MS", "5000");

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/memory/add")) {
        return {
          ok: true,
          status: 200,
          json: () => Promise.reject(new Error("invalid-json-b37b")),
        } as Response;
      }
      if (url.includes("/memory/search")) {
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    const run = await runMemoryRecallEvalSuite({ mode: "gold", db });
    expect(run.results).toHaveLength(1);
    const result = run.results[0]!;
    expect(result.caseId).toBe("vector-bad-json-body");
    expect(
      result.trace.some((event) => event.action === "memory_write" && event.tier === "vector"),
    ).toBe(true);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/memory/add"))).toBe(true);
    fs.unlinkSync(casesPath);
  });
});