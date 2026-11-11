// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runWikiDigest } from "@/lib/wiki-digest";

describe("wiki-digest batch30 — default logger path and episodic fallback", () => {
  const vaults: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const vault of vaults) {
      fs.rmSync(vault, { recursive: true, force: true });
    }
    vaults.length = 0;
  });

  it("runWikiDigest dryRun with memories exercises done log via default logger", async () => {
    const kb = fs.mkdtempSync(path.join(os.tmpdir(), `wiki-b30-${randomUUID()}-`));
    vaults.push(kb);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const summary = await runWikiDigest({
      knowledgeBasePath: kb,
      dryRun: true,
      now: new Date("2026-11-07T12:00:00.000Z"),
      fetchMemories: async () => [
        {
          id: `mem-${randomUUID().slice(0, 8)}`,
          content: "Batch30 wiki digest memory with enough operational detail for clustering",
          createdAt: "2026-11-07T11:00:00.000Z",
        },
      ],
    });
    expect(summary.written).toBeGreaterThan(0);
    expect(logSpy.mock.calls.some((call) => String(call[0]).includes("[wiki-digest] done"))).toBe(
      true,
    );
    logSpy.mockRestore();
  });

  it("runWikiDigest returns failed summary when episodic fallback is disabled", async () => {
    const kb = fs.mkdtempSync(path.join(os.tmpdir(), `wiki-b30-fail-${randomUUID()}-`));
    vaults.push(kb);
    const summary = await runWikiDigest({
      knowledgeBasePath: kb,
      dryRun: true,
      allowEpisodicFallback: false,
      fetchMemories: async () => {
        throw new Error("mem0 down batch30");
      },
    });
    expect(summary.status).toBe("failed");
    expect(summary.reason).toMatch(/mem0 down batch30/);
  });
});
