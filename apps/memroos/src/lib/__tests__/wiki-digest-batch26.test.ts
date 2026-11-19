// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  clusterKeyForMemory,
  fetchEpisodicMemoriesForDigest,
  redactSecrets,
  runWikiDigest,
  shouldSkipMemory,
} from "@/lib/wiki-digest";

describe("wiki-digest batch26 — skip gates, clustering, fetch shapes, failure paths", () => {
  const vaults: string[] = [];

  afterEach(() => {
    for (const vault of vaults) {
      fs.rmSync(vault, { recursive: true, force: true });
    }
    vaults.length = 0;
    vi.restoreAllMocks();
  });

  it("shouldSkipMemory rejects high sensitivity, legal scrap, and sk- secret patterns", () => {
    expect(shouldSkipMemory({ id: "1", content: "   ", createdAt: null }).reason).toBe("empty");
    expect(shouldSkipMemory({ id: "2", content: "note", sensitivity: "restricted", createdAt: null }).reason).toBe(
      "high_sensitivity",
    );
    expect(
      shouldSkipMemory({ id: "3", content: "This mentions attorney-client privilege.", createdAt: null }).reason,
    ).toBe("personal_legal_scrap");
    expect(shouldSkipMemory({ id: "4", content: "token sk-abcdefghijklmnopqrst", createdAt: null }).reason).toBe(
      "secret_pattern",
    );
    expect(redactSecrets("apikey=sk-abcdefghijklmnopqrst")).toContain("[REDACTED]");
  });

  it("clusterKeyForMemory falls back to hashed key for very short headings", () => {
    const key = clusterKeyForMemory({ id: "mem-b26", content: "Hi!", createdAt: null });
    expect(key.startsWith("memory-")).toBe(true);
  });

  it("defaultFetchMemories accepts top-level array responses", async () => {
    const kb = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-b26-array-"));
    vaults.push(kb);
    fs.mkdirSync(path.join(kb, "llm-wiki", "wiki"), { recursive: true });
    const summary = await runWikiDigest({
      knowledgeBasePath: kb,
      dryRun: true,
      fetchMemories: async () => [
        {
          id: "array-m1",
          content: "Top-level array envelope for batch26.",
          createdAt: "2026-07-23T00:00:00.000Z",
        },
      ],
      now: new Date("2026-07-23T01:00:00.000Z"),
      log: () => undefined,
    });
    expect(summary.considered).toBe(1);
    expect(summary.written).toBe(1);
  });

  it("runWikiDigest fails fast when episodic fallback is disabled", async () => {
    const kb = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-b26-nofallback-"));
    vaults.push(kb);
    fs.mkdirSync(path.join(kb, "llm-wiki", "wiki"), { recursive: true });
    const summary = await runWikiDigest({
      knowledgeBasePath: kb,
      dryRun: true,
      allowEpisodicFallback: false,
      fetchMemories: async () => {
        throw new Error("mem0_fetch_failed:503");
      },
      now: new Date("2026-07-23T02:00:00.000Z"),
      log: () => undefined,
    });
    expect(summary.status).toBe("failed");
    expect(summary.reason).toMatch(/mem0_fetch_failed/);
  });

  it("fetchEpisodicMemoriesForDigest without agentId returns recent messages", () => {
    const db = new Database(":memory:");
    initSchema(db);
    db.prepare(
      `INSERT INTO messages (session_id, role, content, timestamp, agent_id, project)
       VALUES ('sess-b26', 'assistant', 'Episodic all agents batch26', datetime('now'), 'agent-b26', 'memroos')`,
    ).run();
    const rows = fetchEpisodicMemoriesForDigest(db, { limit: 5 });
    expect(rows.some((r) => r.content.includes("batch26"))).toBe(true);
    db.close();
  });

  it("runWikiDigest uses default logger extra branch on fetch failure with fallback disabled path logging", async () => {
    const kb = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-b26-logfail-"));
    vaults.push(kb);
    fs.mkdirSync(path.join(kb, "llm-wiki", "wiki"), { recursive: true });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runWikiDigest({
      knowledgeBasePath: kb,
      allowEpisodicFallback: false,
      fetchMemories: async () => {
        throw new Error("mem0_fetch_failed:500");
      },
      now: new Date("2026-07-23T03:00:00.000Z"),
    });
    expect(logSpy.mock.calls.some((call) => String(call[0]).includes("[wiki-digest] fetch failed"))).toBe(true);
    logSpy.mockRestore();
  });
});
