// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  fetchEpisodicMemoriesForDigest,
  readWikiDigestWatermark,
  runWikiDigest,
  shouldSkipMemory,
  writeWikiDigestWatermark,
} from "@/lib/wiki-digest";

describe("wiki-digest batch34 — watermark, fallback, and skip branches", () => {
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

  // sticky: default log one-argument branch (401) — bundled log() calls always pass extra payloads.

  it("shouldSkipMemory rejects personal legal scrap and attorney-client patterns (143-147)", () => {
    expect(shouldSkipMemory({ id: "legal", content: "attorney-client privileged memo batch34" }).reason).toBe(
      "personal_legal_scrap",
    );
    expect(shouldSkipMemory({ id: "empty", content: "   " }).reason).toBe("empty");
  });

  it("fetchEpisodicMemoriesForDigest filters by agent when agentId is set (247-292)", () => {
    const agentA = `agent-a-b34-${randomUUID().slice(0, 6)}`;
    const agentB = `agent-b-b34-${randomUUID().slice(0, 6)}`;
    db.prepare(
      `INSERT INTO messages (session_id, project, agent_id, role, content, timestamp)
       VALUES (?, 'alpha', ?, 'user', 'agent A episodic wiki digest b34', datetime('now')),
              (?, 'alpha', ?, 'user', 'agent B episodic wiki digest b34', datetime('now'))`,
    ).run(`sess-${randomUUID()}`, agentA, `sess-${randomUUID()}`, agentB);
    const rows = fetchEpisodicMemoriesForDigest(db, { agentId: agentA, limit: 10 });
    expect(rows.every((r) => r.agentId === agentA)).toBe(true);
    expect(rows.some((r) => r.content.includes("agent A"))).toBe(true);
  });

  it("runWikiDigest uses episodic fallback when mem0 fetch fails (423-442)", async () => {
    const kb = fs.mkdtempSync(path.join(os.tmpdir(), `wiki-b34-${randomUUID()}-`));
    vaults.push(kb);
    db.prepare(
      `INSERT INTO messages (session_id, project, agent_id, role, content, timestamp, visibility, policy)
       VALUES (?, 'alpha', 'codex', 'assistant', 'fallback episodic body long enough for wiki digest batch34', datetime('now'), 'internal', 'indexable')`,
    ).run(`sess-${randomUUID()}`);
    const summary = await runWikiDigest({
      knowledgeBasePath: kb,
      dryRun: true,
      db,
      fetchMemories: async () => {
        throw new Error("mem0_down_b34");
      },
      now: new Date("2026-11-10T12:00:00.000Z"),
    });
    expect(summary.considered).toBeGreaterThan(0);
    expect(summary.status).not.toBe("failed");
  });

  it("runWikiDigest skips items before watermark and sensitive patterns (460-466)", async () => {
    const kb = fs.mkdtempSync(path.join(os.tmpdir(), `wiki-b34-wm-${randomUUID()}-`));
    vaults.push(kb);
    writeWikiDigestWatermark(kb, {
      lastCreatedAt: "2026-11-10T11:00:00.000Z",
      lastId: "old-id",
      updatedAt: "2026-11-10T11:00:00.000Z",
      pagesWritten: 0,
    });
    const watermark = readWikiDigestWatermark(kb);
    const summary = await runWikiDigest({
      knowledgeBasePath: kb,
      dryRun: true,
      fetchMemories: async () => [
        { id: "old", content: "stale batch34", createdAt: "2026-11-10T10:00:00.000Z" },
        { id: "secret", content: "token sk-abcdefghijklmnopqrstuvwxyz123456", createdAt: "2026-11-10T12:00:00.000Z" },
        {
          id: `new-${randomUUID().slice(0, 6)}`,
          content: "Fresh wiki digest memory content for clustering batch34 test",
          createdAt: "2026-11-10T12:00:00.000Z",
        },
      ],
      now: new Date("2026-11-10T12:00:00.000Z"),
    });
    expect(watermark.lastId).toBe("old-id");
    expect(summary.skipped).toBeGreaterThanOrEqual(2);
    expect(summary.written).toBeGreaterThan(0);
  });

  it("runWikiDigest returns nothing_new when clusters empty after gates (482-490)", async () => {
    const kb = fs.mkdtempSync(path.join(os.tmpdir(), `wiki-b34-empty-${randomUUID()}-`));
    vaults.push(kb);
    const summary = await runWikiDigest({
      knowledgeBasePath: kb,
      dryRun: true,
      allowEpisodicFallback: false,
      fetchMemories: async () => [
        { id: "skip", content: "token sk-abcdefghijklmnopqrstuvwxyz", createdAt: "2026-11-10T12:00:00.000Z" },
      ],
      now: new Date("2026-11-10T12:00:00.000Z"),
    });
    expect(summary.status).toBe("skipped");
    expect(summary.reason).toMatch(/nothing_new/);
  });
});
