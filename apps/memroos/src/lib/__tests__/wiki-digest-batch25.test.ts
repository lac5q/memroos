// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MEM0_URL } from "@/lib/constants";
import { initSchema } from "@/lib/db-schema";
import {
  fetchEpisodicMemoriesForDigest,
  readWikiDigestWatermark,
  runWikiDigest,
  writeWikiDigestWatermark,
} from "@/lib/wiki-digest";

describe("wiki-digest batch25 — watermark partials, mem0 fetch shapes, episodic fallback", () => {
  const vaults: string[] = [];
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    for (const vault of vaults) {
      fs.rmSync(vault, { recursive: true, force: true });
    }
    vaults.length = 0;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("readWikiDigestWatermark fills defaults for partial JSON", () => {
    const kb = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-b25-wm-"));
    vaults.push(kb);
    const wmDir = path.join(kb, "llm-wiki", ".memroos");
    fs.mkdirSync(wmDir, { recursive: true });
    fs.writeFileSync(
      path.join(wmDir, "wiki-digest-watermark.json"),
      JSON.stringify({ lastCreatedAt: "2026-07-01T00:00:00.000Z" }),
      "utf8",
    );
    const wm = readWikiDigestWatermark(kb, new Date("2026-07-22T00:00:00.000Z"));
    expect(wm.lastId).toBeNull();
    expect(wm.pagesWritten).toBe(0);
    expect(wm.updatedAt).toBe("2026-07-22T00:00:00.000Z");
  });

  it("defaultFetchMemories parses results and memories response envelopes", async () => {
    const kb = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-b25-mem0-"));
    vaults.push(kb);
    fs.mkdirSync(path.join(kb, "llm-wiki", "wiki"), { recursive: true });
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [
            {
              id: "r1",
              memory: "Envelope via results",
              created_at: "2026-07-22T10:00:00.000Z",
              agent_id: "agent-b25",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const first = await runWikiDigest({
      knowledgeBasePath: kb,
      agentId: "agent-b25",
      dryRun: true,
      allowEpisodicFallback: false,
      now: new Date("2026-07-22T12:00:00.000Z"),
      log: () => undefined,
    });
    expect(first.considered).toBeGreaterThan(0);

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          memories: [{ hash: "h2", data: "Envelope via memories", createdAt: "2026-07-22T11:00:00.000Z" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const second = await runWikiDigest({
      knowledgeBasePath: kb,
      agentId: "agent-b25",
      dryRun: true,
      allowEpisodicFallback: false,
      now: new Date("2026-07-22T13:00:00.000Z"),
      log: () => undefined,
    });
    expect(second.considered).toBeGreaterThan(0);
    expect(fetchMock.mock.calls[0]?.[0]).toContain(`${MEM0_URL.replace(/\/$/, "")}/memory/all`);
  });

  it("runWikiDigest falls back to sqlite episodic rows when mem0 fetch fails", async () => {
    const kb = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-b25-fallback-"));
    vaults.push(kb);
    fs.mkdirSync(path.join(kb, "llm-wiki", "wiki", "memroos-digest"), { recursive: true });
    const db = new Database(":memory:");
    initSchema(db);
    db.prepare(
      `INSERT INTO messages (session_id, role, content, timestamp, agent_id, project)
       VALUES ('sess-b25', 'user', 'Episodic fallback body for batch25', datetime('now'), 'agent-b25', 'memroos')`,
    ).run();
    fetchMock.mockRejectedValueOnce(new Error("mem0_fetch_failed:503"));
    const summary = await runWikiDigest({
      knowledgeBasePath: kb,
      agentId: "agent-b25",
      dryRun: false,
      db,
      now: new Date("2026-07-22T14:00:00.000Z"),
      log: () => undefined,
    });
    expect(summary.written).toBeGreaterThan(0);
    db.close();
  });

  it("fetchEpisodicMemoriesForDigest filters by agent id when provided", () => {
    const db = new Database(":memory:");
    initSchema(db);
    db.prepare(
      `INSERT INTO messages (session_id, role, content, timestamp, agent_id, project)
       VALUES ('sess-other', 'assistant', 'other agent', datetime('now'), 'other', 'memroos')`,
    ).run();
    db.prepare(
      `INSERT INTO messages (session_id, role, content, timestamp, agent_id, project)
       VALUES ('sess-b25', 'user', 'target agent only', datetime('now'), 'agent-b25', 'memroos')`,
    ).run();
    const rows = fetchEpisodicMemoriesForDigest(db, { agentId: "agent-b25", limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.content).toContain("target agent");
    db.close();
  });

  it("writeWikiDigestWatermark persists readable watermark file", () => {
    const kb = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-b25-write-"));
    vaults.push(kb);
    writeWikiDigestWatermark(kb, {
      lastCreatedAt: "2026-07-22T00:00:00.000Z",
      lastId: "m-b25",
      updatedAt: "2026-07-22T01:00:00.000Z",
      pagesWritten: 2,
    });
    const parsed = readWikiDigestWatermark(kb);
    expect(parsed.lastId).toBe("m-b25");
    expect(parsed.pagesWritten).toBe(2);
  });
});
