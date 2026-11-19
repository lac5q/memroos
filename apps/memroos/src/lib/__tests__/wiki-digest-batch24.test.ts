// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runWikiDigest } from "@/lib/wiki-digest";

describe("wiki-digest batch24 — default logger and graph merge branches", () => {
  const vaults: string[] = [];

  afterEach(() => {
    for (const vault of vaults) {
      fs.rmSync(vault, { recursive: true, force: true });
    }
    vaults.length = 0;
    vi.restoreAllMocks();
  });

  it("uses built-in logger for plain and structured messages when log option is omitted", async () => {
    const kb = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-b24-log-"));
    vaults.push(kb);
    fs.mkdirSync(path.join(kb, "llm-wiki", "wiki"), { recursive: true });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runWikiDigest({
      knowledgeBasePath: kb,
      dryRun: true,
      fetchMemories: async () => [
        {
          id: "m-default-log",
          content: "Exercise default logger branches in batch24.",
          createdAt: "2026-07-22T00:00:00.000Z",
        },
      ],
      now: new Date("2026-07-22T01:00:00.000Z"),
    });
    expect(logSpy.mock.calls.some((call) => String(call[0]) === "[wiki-digest] done")).toBe(true);
    logSpy.mockRestore();
  });

  it("merges wiki graph nodes when existing graph JSON is malformed", async () => {
    const kb = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-b24-graph-"));
    vaults.push(kb);
    const wikiRoot = path.join(kb, "llm-wiki", "wiki");
    fs.mkdirSync(path.join(wikiRoot, ".memroos"), { recursive: true });
    fs.mkdirSync(path.join(wikiRoot, "graph"), { recursive: true });
    fs.writeFileSync(path.join(wikiRoot, "graph", "knowledge-graph.json"), "{not-json", "utf8");
    const summary = await runWikiDigest({
      knowledgeBasePath: kb,
      dryRun: false,
      fetchMemories: async () => [
        {
          id: "m-graph",
          content: "Graph merge should recover from invalid existing graph file.",
          createdAt: "2026-07-22T02:00:00.000Z",
        },
      ],
      now: new Date("2026-07-22T03:00:00.000Z"),
      log: () => undefined,
    });
    expect(summary.written).toBeGreaterThan(0);
    const graphRaw = fs.readFileSync(path.join(wikiRoot, "graph", "knowledge-graph.json"), "utf8");
    const graph = JSON.parse(graphRaw) as { nodes?: Array<{ id: string }> };
    expect(Array.isArray(graph.nodes)).toBe(true);
    expect((graph.nodes?.length ?? 0) > 0).toBe(true);
  });
});
