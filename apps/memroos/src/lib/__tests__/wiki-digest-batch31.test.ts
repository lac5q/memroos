// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clusterKeyForMemory,
  runWikiDigest,
  shouldSkipMemory,
} from "@/lib/wiki-digest";

describe("wiki-digest batch31 — skip gates, cluster hash, memories payload shape", () => {
  const vaults: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const vault of vaults) {
      fs.rmSync(vault, { recursive: true, force: true });
    }
    vaults.length = 0;
  });

  it("shouldSkipMemory rejects high sensitivity and secret patterns", () => {
    expect(shouldSkipMemory({ id: "s1", content: "normal batch31 wiki text" }).skip).toBe(false);
    expect(shouldSkipMemory({ id: "s2", content: "secret", sensitivity: "restricted" }).reason).toBe(
      "high_sensitivity",
    );
    expect(shouldSkipMemory({ id: "s3", content: "token sk-abcdefghijklmnopqrstuvwxyz" }).reason).toBe(
      "secret_pattern",
    );
  });

  it("clusterKeyForMemory falls back to memory hash when slug is short", () => {
    const item = { id: "x1", content: "a" };
    const key = clusterKeyForMemory(item);
    const expected = `memory-${createHash("sha256").update(item.id || "a").digest("hex").slice(0, 10)}`;
    expect(key).toBe(expected);
  });

  it("runWikiDigest accepts mem0 payloads shaped as memories[]", async () => {
    const kb = fs.mkdtempSync(path.join(os.tmpdir(), `wiki-b31-${randomUUID()}-`));
    vaults.push(kb);
    const summary = await runWikiDigest({
      knowledgeBasePath: kb,
      dryRun: true,
      now: new Date("2026-11-08T12:00:00.000Z"),
      fetchMemories: async () => [
        {
          id: `mem-b31-${randomUUID().slice(0, 6)}`,
          content: "Batch31 wiki digest uses memories wrapper with enough detail for clustering",
          createdAt: "2026-11-08T11:00:00.000Z",
        },
      ],
    });
    expect(summary.written).toBeGreaterThan(0);
    expect(summary.status).not.toBe("failed");
  });
});
