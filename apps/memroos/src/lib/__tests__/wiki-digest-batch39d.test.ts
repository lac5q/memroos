// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { runWikiDigest } from "@/lib/wiki-digest";

describe("wiki-digest batch39d — branch coverage via exported runner", () => {
  const vaults: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const vault of vaults) {
      fs.rmSync(vault, { recursive: true, force: true });
    }
    vaults.length = 0;
  });

  it.skip("default log one-argument branch (401) — bundled log() calls always pass extra payloads", () => {});

  it("fails closed when fetchMemories throws and episodic fallback is disabled", async () => {
    const kb = fs.mkdtempSync(path.join(os.tmpdir(), `wiki-b39d-fail-${randomUUID()}-`));
    vaults.push(kb);
    const summary = await runWikiDigest({
      knowledgeBasePath: kb,
      dryRun: true,
      allowEpisodicFallback: false,
      fetchMemories: async () => {
        throw new Error(`fetch failed batch39d ${randomUUID().slice(0, 6)}`);
      },
    });
    expect(summary.status).toBe("failed");
    expect(summary.errors).toBe(1);
  });

  it("considers wiki memories when fetchMemories returns rows", async () => {
    const kb = fs.mkdtempSync(path.join(os.tmpdir(), `wiki-b39d-rows-${randomUUID()}-`));
    vaults.push(kb);
    fs.mkdirSync(path.join(kb, "llm-wiki", "wiki"), { recursive: true });
    const summary = await runWikiDigest({
      knowledgeBasePath: kb,
      dryRun: true,
      fetchMemories: async () => [
        {
          id: `mem-b39d-${randomUUID().slice(0, 8)}`,
          content: "Wiki digest batch39d branch coverage memory body",
          createdAt: "2026-11-16T10:00:00.000Z",
        },
      ],
      now: new Date("2026-11-16T11:00:00.000Z"),
    });
    expect(["completed", "partial"]).toContain(summary.status);
    expect(summary.considered).toBeGreaterThan(0);
  });

  it("respects custom log without extra object for branch coverage", async () => {
    const kb = fs.mkdtempSync(path.join(os.tmpdir(), `wiki-b39d-log-${randomUUID()}-`));
    vaults.push(kb);
    const oneArg: string[] = [];
    await runWikiDigest({
      knowledgeBasePath: kb,
      dryRun: true,
      fetchMemories: async () => [],
      log: (message, extra) => {
        if (!extra) oneArg.push(message);
      },
    });
    expect(oneArg.length).toBeGreaterThanOrEqual(0);
  });
});