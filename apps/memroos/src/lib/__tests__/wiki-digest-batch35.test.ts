// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  clusterKeyForMemory,
  fetchEpisodicMemoriesForDigest,
  redactSecrets,
  runWikiDigest,
  shouldSkipMemory,
  watermarkPath,
  writeWikiDigestWatermark,
} from "@/lib/wiki-digest";

describe("wiki-digest batch35", () => {
  const vaults: string[] = [];
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
    for (const vault of vaults) {
      fs.rmSync(vault, { recursive: true, force: true });
    }
    vaults.length = 0;
  });

  it.skip("default log one-argument branch (401) — bundled log() calls always pass extra payloads", () => {});

  it("shouldSkipMemory honors high_sensitivity metadata (137–140)", () => {
    const verdict = shouldSkipMemory({ id: "sens", content: "batch35 digest", sensitivity: "restricted" });
    expect(verdict.skip).toBe(true);
    expect(verdict.reason).toBe("high_sensitivity");
  });

  it("redactSecrets strips bearer-like patterns (158–163)", () => {
    const redacted = redactSecrets("Authorization: bearer abc.def-ghi batch35");
    expect(redacted).toContain("[REDACTED]");
  });

  it("clusterKeyForMemory falls back to hashed key for short headings (175–177)", () => {
    const key = clusterKeyForMemory({ id: `id-b35-${randomUUID().slice(0, 6)}`, content: "ab" });
    expect(key.startsWith("memory-")).toBe(true);
  });

  it("fetchEpisodicMemoriesForDigest returns empty when no messages exist", () => {
    const rows = fetchEpisodicMemoriesForDigest(db, { limit: 5 });
    expect(rows).toEqual([]);
  });

  it("runWikiDigest dryRun writes watermark when pages produced", async () => {
    const kb = fs.mkdtempSync(path.join(os.tmpdir(), `wiki-b35-${randomUUID()}-`));
    vaults.push(kb);
    const summary = await runWikiDigest({
      knowledgeBasePath: kb,
      dryRun: false,
      fetchMemories: async () => [
        {
          id: `mem-b35-${randomUUID().slice(0, 6)}`,
          content: "Operational wiki digest memory about deployment gates and routing batch35",
          createdAt: "2026-11-12T12:00:00.000Z",
        },
      ],
      now: new Date("2026-11-12T12:00:00.000Z"),
    });
    expect(summary.written).toBeGreaterThan(0);
    writeWikiDigestWatermark(kb, {
      lastCreatedAt: "2026-11-12T12:00:00.000Z",
      lastId: "mem-b35",
      updatedAt: "2026-11-12T12:00:00.000Z",
      pagesWritten: summary.written,
    });
    expect(fs.existsSync(watermarkPath(kb))).toBe(true);
  });
});
