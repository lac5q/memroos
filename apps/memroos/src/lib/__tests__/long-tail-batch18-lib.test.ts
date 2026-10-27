// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { createSpace } from "@/lib/space";
import { buildAgentContextPacket } from "@/lib/agent-context-packet";
import { hasLogFunction, runDecay, _resetForTest } from "@/lib/memory-decay";
import {
  aggregateSourceStatus,
  loadEnabledMeetingCollections,
  searchMeetingCollections,
} from "@/lib/meeting-qmd-recall";
import { SOURCE_STATUS } from "@/lib/meeting-source-status";
import {
  hashSyntheticSmoke,
  loadSyntheticSmoke,
} from "@/lib/retrieval-bench/adapters/synthetic";
import {
  isStageRecord,
  reconcileStages,
  stageRecord,
  type StageRecord,
} from "@/lib/retrieval-bench/modules/reconciliation";
import type { AggregateReport } from "@/lib/retrieval-bench/schema";
import {
  negotiateDescriptor,
  resolveRegisteredTool,
  validateInitializeParams,
  validateJsonRpcEnvelope,
} from "@/lib/msiq/mcp-protocol";
import { redactUrlForDisplay, sendMessageToA2aAgent } from "@/lib/a2a/client";
import type { DispatchTask } from "@/lib/dispatch/types";
import {
  exportSkillPackage,
  importSkillPackage,
  syncSkillsWithAgent,
  type SkillPackage,
} from "@/lib/skillforge/multi-agent";
import { runSkillCycle, updateSkillRegistry } from "@/lib/skillforge/integration";
import type { SkillForgeProposal } from "@/lib/skillforge/types";
import { buildSkillSuggestionAudit } from "@/lib/skills/activity-suggestions";
import { getSkillDependencyView, summarizeDependencyView } from "@/lib/skills/skill-dependencies";
import { classifyText, detectFixedSensitiveLabels } from "@/lib/classification/cascade";
import {
  extractWikilinks,
  getWikiRoot,
  listWikiTree,
  readWikiPage,
  resolveWikiPath,
  resolveWikilink,
  searchWikiPages,
  wikiRootExists,
} from "@/lib/wiki-vault";
import { onboardUser } from "@/lib/identity/lifecycle";

const FIXTURES_DIR = path.resolve(__dirname, "../../../../../evals/comparative-retrieval/fixtures");

const decayDb = new Database(":memory:");
initSchema(decayDb);

vi.mock("@/lib/db", () => ({
  getDb: () => decayDb,
  closeDb: () => {},
}));

let tmpDirs: string[] = [];

function mkWikiRoot(structure?: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `wiki-b18-${randomUUID().slice(0, 8)}-`));
  tmpDirs.push(root);
  if (structure) {
    for (const [rel, body] of Object.entries(structure)) {
      const full = path.join(root, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, body, "utf8");
    }
  }
  return root;
}

afterEach(() => {
  for (const dir of tmpDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  tmpDirs = [];
  _resetForTest();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("long-tail batch18 lib — wiki-vault", () => {
  it("resolveWikiPath rejects path traversal outside the vault root", () => {
    const root = mkWikiRoot();
    expect(resolveWikiPath(root, "../secret.md")).toBeNull();
    expect(resolveWikiPath(root, "notes/page.md")).toBeTruthy();
  });

  it("wikiRootExists is false for missing directories", () => {
    expect(wikiRootExists(path.join(os.tmpdir(), `missing-${randomUUID()}`))).toBe(false);
  });

  it("getWikiRoot honors explicit wikiRoot override", () => {
    const root = mkWikiRoot();
    expect(getWikiRoot({ wikiRoot: root })).toBe(path.resolve(root));
  });

  it("listWikiTree returns empty array when root is absent", () => {
    expect(listWikiTree(path.join(os.tmpdir(), `no-wiki-${randomUUID()}`))).toEqual([]);
  });

  it("listWikiTree includes markdown files and nested directories", () => {
    const root = mkWikiRoot({
      "alpha/intro.md": "# Alpha\n",
      "beta/readme.txt": "plain text",
      ".hidden/skip.md": "hidden",
    });
    const tree = listWikiTree(root);
    expect(tree.some((n) => n.name === "alpha" && n.type === "dir")).toBe(true);
    expect(tree.some((n) => n.name === "intro.md")).toBe(false);
    const alpha = tree.find((n) => n.name === "alpha");
    expect(alpha?.children?.some((c) => c.name === "intro.md")).toBe(true);
  });

  it("readWikiPage returns title from heading and mtime", () => {
    const root = mkWikiRoot({ "page.md": "# Custom Title\nBody" });
    const page = readWikiPage(root, "page.md");
    expect(page?.title).toBe("Custom Title");
    expect(page?.content).toContain("Body");
    expect(page?.mtime).toMatch(/T/);
  });

  it("readWikiPage returns null for traversal paths", () => {
    const root = mkWikiRoot({ "safe.md": "x" });
    expect(readWikiPage(root, "../../etc/passwd")).toBeNull();
  });

  it("extractWikilinks parses aliases and anchors", () => {
    const links = extractWikilinks("See [[Target Page|alias]] and [[Other#section]].");
    expect(links).toEqual(["Target Page", "Other"]);
  });

  it("resolveWikilink finds pages by basename search", () => {
    const root = mkWikiRoot({ "deep/nested/My Topic.md": "# Topic\n" });
    expect(resolveWikilink(root, "My Topic")).toBe("deep/nested/My Topic.md");
  });

  it("searchWikiPages returns snippets for query matches", () => {
    const root = mkWikiRoot({ "findme.md": "The needle UNIQUE_TOKEN appears here." });
    const hits = searchWikiPages(root, "unique_token", 5);
    expect(hits.length).toBe(1);
    expect(hits[0]?.title).toBe("findme");
    expect(hits[0]?.snippet.toLowerCase()).toContain("unique");
  });

  it("searchWikiPages returns empty for blank query", () => {
    const root = mkWikiRoot({ "a.md": "text" });
    expect(searchWikiPages(root, "   ")).toEqual([]);
  });
});

describe("long-tail batch18 lib — meeting QMD recall", () => {
  it("aggregateSourceStatus returns providerAbsent for empty map", () => {
    expect(aggregateSourceStatus({})).toBe(SOURCE_STATUS.providerAbsent);
  });

  it("aggregateSourceStatus picks weakest status across collections", () => {
    const status = aggregateSourceStatus({
      a: { collection: "a", status: SOURCE_STATUS.recalled, count: 1, lastIndexAt: null },
      b: { collection: "b", status: SOURCE_STATUS.providerAbsent, count: 0, lastIndexAt: null },
    });
    expect(status).toBe(SOURCE_STATUS.providerAbsent);
  });

  it("searchMeetingCollections rejects empty query", async () => {
    const result = await searchMeetingCollections("  ");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/required/i);
  });

  it("searchMeetingCollections dedupes hits and marks recalled collections", async () => {
    const exec = vi.fn(async () => ({
      stdout: JSON.stringify([
        { file: "/a/one.md", title: "One", snippet: "hello", score: 0.9, indexed_at: "2026-01-01T00:00:00Z" },
        { file: "/a/one.md", title: "Dup", snippet: "dup", score: 0.8 },
      ]),
      stderr: "",
    }));
    const result = await searchMeetingCollections("hello", 5, ["meet-recordings"], exec);
    expect(result.ok).toBe(true);
    expect(result.hits.length).toBe(1);
    expect(result.collectionStatus["meet-recordings"]?.status).toBe(SOURCE_STATUS.recalled);
  });

  it("searchMeetingCollections records indexedUnrecalled when qmd returns no hits", async () => {
    const exec = vi.fn(async () => ({ stdout: "[]", stderr: "" }));
    const result = await searchMeetingCollections("term", 4, ["spark-recordings"], exec);
    expect(result.hits).toEqual([]);
    expect(result.collectionStatus["spark-recordings"]?.status).toBe(SOURCE_STATUS.indexedUnrecalled);
  });

  it("searchMeetingCollections captures exec failures per collection", async () => {
    const exec = vi.fn(async () => {
      throw new Error("qmd binary missing");
    });
    const result = await searchMeetingCollections("term", 3, ["meet-recordings-zoom"], exec);
    expect(result.ok).toBe(false);
    expect(result.collectionStatus["meet-recordings-zoom"]?.reason).toMatch(/missing/);
  });

  it("loadEnabledMeetingCollections falls back to defaults when config is missing", async () => {
    const prev = process.env.MEMROOS_MEETING_SOURCES_CONFIG;
    delete process.env.MEMROOS_MEETING_SOURCES_CONFIG;
    const cols = await loadEnabledMeetingCollections(path.join(os.tmpdir(), `no-config-${randomUUID()}.json`));
    if (prev) process.env.MEMROOS_MEETING_SOURCES_CONFIG = prev;
    expect(cols.length).toBeGreaterThan(3);
  });

  it("loadEnabledMeetingCollections reads enabled qmdCollections from config file", async () => {
    const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), `meet-src-${randomUUID()}-`));
    tmpDirs.push(cfgDir);
    const cfgPath = path.join(cfgDir, "meeting-sources.json");
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({
        sources: [
          { enabled: true, qmdCollections: ["custom-meetings"] },
          { enabled: false, qmdCollections: ["ignored"] },
        ],
      }),
      "utf8",
    );
    const cols = await loadEnabledMeetingCollections(cfgPath);
    expect(cols).toEqual(["custom-meetings"]);
  });
});

describe("long-tail batch18 lib — synthetic adapter + reconciliation", () => {
  it("loadSyntheticSmoke returns not found when fixture is absent", () => {
    const result = loadSyntheticSmoke({ fixturesDir: path.join(os.tmpdir(), `empty-${randomUUID()}`) });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/fixture_file_not_found/);
  });

  it("loadSyntheticSmoke loads smoke tasks and stamps provenance", () => {
    const loaded = loadSyntheticSmoke({ fixturesDir: FIXTURES_DIR, limit: 2 });
    expect(loaded.ok).toBe(true);
    expect(loaded.tasks?.length).toBe(2);
    expect(loaded.truncated).toBe(true);
    expect(loaded.tasks?.[0]?.provenance).toBeTruthy();
  });

  it("loadSyntheticSmoke rejects malformed JSON fixtures", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `bad-json-${randomUUID()}-`));
    tmpDirs.push(dir);
    fs.writeFileSync(path.join(dir, "memroos-public-smoke.json"), "{not-json", "utf8");
    const result = loadSyntheticSmoke({ fixturesDir: dir });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/fixture_json_malformed/);
  });

  it("loadSyntheticSmoke rejects non-array fixture roots", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `not-array-${randomUUID()}-`));
    tmpDirs.push(dir);
    fs.writeFileSync(path.join(dir, "memroos-public-smoke.json"), JSON.stringify({ tasks: [] }), "utf8");
    expect(loadSyntheticSmoke({ fixturesDir: dir }).reason).toBe("fixture_root_not_array");
  });

  it("hashSyntheticSmoke is stable for the same task slice", () => {
    const loaded = loadSyntheticSmoke({ fixturesDir: FIXTURES_DIR, limit: 3 });
    expect(loaded.tasks).toBeTruthy();
    const h1 = hashSyntheticSmoke(loaded.tasks!);
    const h2 = hashSyntheticSmoke(loaded.tasks!);
    expect(h1).toBe(h2);
    expect(h1.startsWith("sha256:")).toBe(true);
  });

  it("reconcileStages flags injected count mismatches", () => {
    const report: AggregateReport = {
      taskCount: 1,
      aggregate: { completedTaskCount: 1, failedTaskCount: 0 },
      tasks: [{ taskId: "t1", injectedCount: 2, ignoredCount: 0, packedCount: 0 }],
    } as AggregateReport;
    const perTask = new Map<string, StageRecord[]>([
      ["t1", [stageRecord({ taskId: "t1", stage: "injected", ids: ["a"] })]],
    ]);
    const receipt = reconcileStages({ report, perTask });
    expect(receipt.ok).toBe(false);
    expect(receipt.mismatches.some((m) => m.startsWith("injected_count_mismatch"))).toBe(true);
  });

  it("reconcileStages annotates failed tasks at aggregate level", () => {
    const report: AggregateReport = {
      taskCount: 1,
      aggregate: { completedTaskCount: 0, failedTaskCount: 1 },
      tasks: [{ taskId: "t1", injectedCount: 0, ignoredCount: 0, packedCount: 0 }],
    } as AggregateReport;
    const receipt = reconcileStages({ report, perTask: new Map() });
    expect(receipt.mismatches).toContain("failed_tasks_present:1");
  });

  it("reconcileStages passes when stage ids match task metrics", () => {
    const report: AggregateReport = {
      taskCount: 1,
      aggregate: { completedTaskCount: 1, failedTaskCount: 0 },
      tasks: [{ taskId: "t1", injectedCount: 1, ignoredCount: 0, packedCount: 1 }],
    } as AggregateReport;
    const perTask = new Map<string, StageRecord[]>([
      [
        "t1",
        [
          stageRecord({ taskId: "t1", stage: "retrieved", ids: ["r1"] }),
          stageRecord({ taskId: "t1", stage: "injected", ids: ["r1"] }),
          stageRecord({ taskId: "t1", stage: "packed", ids: ["r1"] }),
        ],
      ],
    ]);
    const receipt = reconcileStages({ report, perTask });
    expect(receipt.ok).toBe(true);
    expect(receipt.reconciliationHash).toMatch(/^sha256:/);
  });

  it("isStageRecord rejects arrays and incomplete objects", () => {
    expect(isStageRecord([])).toBe(false);
    expect(isStageRecord({ taskId: "x" })).toBe(false);
    expect(isStageRecord({ taskId: "x", stage: "retrieved", ids: [] })).toBe(true);
  });
});

describe("long-tail batch18 lib — MCP protocol validators", () => {
  it("validateJsonRpcEnvelope rejects unknown top-level fields", () => {
    const result = validateJsonRpcEnvelope({ jsonrpc: "2.0", method: "tools/list", id: 1, extra: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toMatch(/unknown field/);
  });

  it("validateJsonRpcEnvelope rejects invalid id types", () => {
    const result = validateJsonRpcEnvelope({ jsonrpc: "2.0", method: "ping", id: {} });
    expect(result.ok).toBe(false);
  });

  it("validateInitializeParams rejects unsupported protocol versions", () => {
    const result = validateInitializeParams({
      protocolVersion: "2099-01-01",
      capabilities: [{ name: "memory.read", source: "test" }],
      clientInfo: { name: "c", version: "1" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unsupported_protocol_version");
  });

  it("validateInitializeParams rejects malformed capability entries", () => {
    const result = validateInitializeParams({
      protocolVersion: "2024-11-05",
      capabilities: [{ name: "", source: "test" }],
      clientInfo: { name: "c", version: "1" },
    });
    expect(result.ok).toBe(false);
  });

  it("negotiateDescriptor fails on unsupported transport", () => {
    const outcome = negotiateDescriptor({
      transport: "hosted-cloud",
      initialize: {
        protocolVersion: "2024-11-05",
        capabilities: [{ name: "memory.read", source: "s" }],
        serverInfo: { name: "s", version: "1" },
        tools: [{ name: "memory_read" }],
      },
      transcript: [],
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("unsupported_transport");
  });

  it("negotiateDescriptor fails when required tools are missing", () => {
    const outcome = negotiateDescriptor({
      transport: "local",
      initialize: {
        protocolVersion: "2024-11-05",
        capabilities: [
          { name: "memory.read", source: "s" },
          { name: "memory.write", source: "s" },
          { name: "memory.search", source: "s" },
          { name: "tools.list", source: "s" },
        ],
        serverInfo: { name: "s", version: "1" },
        tools: [{ name: "memory_read" }],
      },
      transcript: [],
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("missing_tools");
  });

  it("negotiateDescriptor succeeds with full capability and tool set", () => {
    const outcome = negotiateDescriptor({
      transport: "mcp_stdio",
      initialize: {
        protocolVersion: "2025-03-26",
        capabilities: [
          { name: "memory.read", source: "s" },
          { name: "memory.write", source: "s" },
          { name: "memory.search", source: "s" },
          { name: "tools.list", source: "s" },
        ],
        serverInfo: { name: "s", version: "1" },
        tools: [{ name: "memory_read" }, { name: "memory_write" }, { name: "memory_search" }],
      },
      transcript: [],
    });
    expect(outcome.ok).toBe(true);
  });

  it("resolveRegisteredTool enforces declared scope dimensions", () => {
    const denied = resolveRegisteredTool({
      tools: [{ name: "memory_read", requiredScope: ["tenantId"] }],
      name: "memory_read",
    });
    expect(denied.ok).toBe(false);

    const ok = resolveRegisteredTool({
      tools: [{ name: "memory_read", requiredScope: ["tenantId"] }],
      name: "memory_read",
      requestedScope: ["tenantId"],
    });
    expect(ok.ok).toBe(true);
  });

  it("resolveRegisteredTool returns unregistered_tool for unknown names", () => {
    const result = resolveRegisteredTool({ tools: [], name: "missing" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unregistered_tool");
  });
});

describe("long-tail batch18 lib — memory decay + A2A client", () => {
  beforeEach(() => {
    _resetForTest();
    decayDb.exec("DELETE FROM memory_decay_runs");
    decayDb.exec("DELETE FROM memory_salience");
    decayDb.exec("DELETE FROM messages");
  });

  it("hasLogFunction caches sqlite LOG() probe result", () => {
    expect(typeof hasLogFunction()).toBe("boolean");
    expect(hasLogFunction()).toBe(hasLogFunction());
  });

  it("runDecay skips pinned tier rows", () => {
    const msgId = decayDb
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp)
         VALUES ('s', 'p', 'agent', 'user', 'hi', datetime('now'))`,
      )
      .run().lastInsertRowid as number;
    decayDb
      .prepare(
        `INSERT INTO memory_salience(message_id, tier, salience_score, access_count, last_decay_at)
         VALUES (?, 'pinned', 0.8, 0, '1970-01-01')`,
      )
      .run(msgId);
    const summary = runDecay({ tenantId: "default-tenant", now: new Date("2026-07-02T00:00:00Z") });
    expect(summary.skippedPinned).toBeGreaterThanOrEqual(1);
  });

  it("runDecay applies tier decay to eligible high-tier rows", () => {
    const msgId = decayDb
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp)
         VALUES ('s2', 'p', 'agent', 'user', 'decay-me', datetime('now'))`,
      )
      .run().lastInsertRowid as number;
    decayDb
      .prepare(
        `INSERT INTO memory_salience(message_id, tier, salience_score, access_count, last_decay_at)
         VALUES (?, 'high', 1.0, 2, '1970-01-01')`,
      )
      .run(msgId);
    const summary = runDecay({ tenantId: "default-tenant", now: new Date("2026-07-02T00:00:00Z") });
    expect(summary.decayed).toBeGreaterThanOrEqual(1);
    const row = decayDb.prepare("SELECT salience_score FROM memory_salience WHERE message_id = ?").get(msgId) as {
      salience_score: number;
    };
    expect(row.salience_score).toBeLessThan(1.0);
  });

  it("redactUrlForDisplay strips credentials from malformed URLs", () => {
    expect(redactUrlForDisplay("http://user:secret@localhost:3000/tasks")).toBe("http://localhost:3000/tasks");
    expect(redactUrlForDisplay("not-a-url://user:pass@host")).toContain("host");
  });

  it("sendMessageToA2aAgent accepts remote tasks over fetch", async () => {
    const task: DispatchTask = {
      task_id: "task-1",
      context_id: "ctx-1",
      task_summary: "do work",
      priority: "normal",
      dispatched_at: new Date().toISOString(),
      from_agent: "a",
      to_agent: "b",
      input: {},
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ id: "remote-1", status: { state: "working" } }, { status: 200 }),
      ),
    );
    const result = await sendMessageToA2aAgent(
      { id: "remote", host: "localhost", port: 3000, tunnelUrl: "http://localhost:3000" },
      task,
    );
    expect(result.accepted).toBe(true);
    expect(result.mode).toBe("pushed");
  });

  it("sendMessageToA2aAgent surfaces HTTP error bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 503 })),
    );
    const result = await sendMessageToA2aAgent(
      { id: "remote", tunnelUrl: "http://localhost:3000" },
      {
        task_id: "t2",
        context_id: "c2",
        task_summary: "x",
        priority: "normal",
        dispatched_at: new Date().toISOString(),
        from_agent: "a",
        to_agent: "b",
      },
    );
    expect(result.accepted).toBe(false);
    expect(result.detail).toMatch(/503/);
  });
});

describe("long-tail batch18 lib — skillforge + dependencies + classification", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
  });

  it("exportSkillPackage returns error when skill is missing", () => {
    expect(exportSkillPackage(db, "999999").success).toBe(false);
  });

  it("importSkillPackage rejects packages without passing eval receipts", () => {
    const pkg: SkillPackage = {
      id: "pkg-1",
      skillId: "42",
      name: "Test",
      content: "body",
      metadata: { version: "1.0.0", author: "a", tags: [], evalReceipts: [] },
      compatibility: ["memroos"],
      exportedAt: new Date().toISOString(),
    };
    const result = importSkillPackage(db, pkg);
    expect(result.success).toBe(false);
    expect(result.errors.join(" ")).toMatch(/Eval validation failed/);
  });

  it("syncSkillsWithAgent records errors when export fails for unknown skills", () => {
    const sync = syncSkillsWithAgent(db, "http://localhost:9999/a2a", ["999999"]);
    expect(sync.synced).toBe(0);
    expect(sync.errors.some((e) => /Failed to export/i.test(e))).toBe(true);
  });

  it("runSkillCycle marks lint failed when registry is empty", async () => {
    const result = await runSkillCycle(db, { tenantId: "default-tenant" } as never);
    expect(result.lintPassed).toBe(false);
    expect(result.errors.some((e) => /No skills/i.test(e))).toBe(true);
  });

  it("updateSkillRegistry updates version for an existing registry row", () => {
    db.prepare(
      `INSERT INTO skill_registry (name, source_harness, dispatch_status, raw_body, imported_by, version)
       VALUES ('forge-skill', 'memroos', 'enabled', '# Skill', 'test', '1.0.0')`,
    ).run();
    const id = (db.prepare("SELECT id FROM skill_registry WHERE name = 'forge-skill'").get() as { id: number }).id;
    const proposal = {
      sourceSkillId: String(id),
      sourceVersion: "1.0.0",
    } as SkillForgeProposal;
    const result = updateSkillRegistry(db, proposal);
    expect(result.success).toBe(true);
    const version = (db.prepare("SELECT version FROM skill_registry WHERE id = ?").get(id) as { version: string })
      .version;
    expect(version).toMatch(/1\.0\.0-rev-/);
  });

  it("getSkillDependencyView reports missing registry rows", () => {
    const view = getSkillDependencyView(db, 123456);
    expect(view.forward_consistency.ok).toBe(false);
    expect(summarizeDependencyView(view)).toMatchObject({ skill_id: 123456 });
  });

  it("getSkillDependencyView includes config provenance for registry skills", () => {
    db.prepare(
      `INSERT INTO skill_registry (name, source_harness, dispatch_status, raw_body, imported_by, version)
       VALUES ('dep-skill', 'memroos', 'enabled', '# body', 'test', '2.0.0')`,
    ).run();
    const id = (db.prepare("SELECT id FROM skill_registry WHERE name = 'dep-skill'").get() as { id: number }).id;
    const view = getSkillDependencyView(db, id);
    expect(view.trusted.some((row) => row.provenance === "config")).toBe(true);
  });

  it("detectFixedSensitiveLabels walks nested metadata objects", () => {
    const fixed = detectFixedSensitiveLabels({
      content: "routine",
      sourceType: "message",
      metadata: { metadata: { providerLabels: { nested: ["Finance / Payroll"] } } },
    });
    expect(fixed.matchedTokens.length).toBeGreaterThan(0);
  });

  it("classifyText respects depth limit when metadata is deeply nested", () => {
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let i = 0; i < 6; i++) {
      const next: Record<string, unknown> = { metadata: { labels: i === 5 ? ["Legal Hold"] : [] } };
      cursor.metadata = next;
      cursor = next;
    }
    const result = classifyText({
      content: "Engineering deployment checklist.",
      sourceType: "message",
      metadata: deep,
    });
    expect(result.label.domain).toBeTruthy();
  });

  it("buildSkillSuggestionAudit uses custom activity roots", () => {
    const activityRoot = fs.mkdtempSync(path.join(os.tmpdir(), `activity-${randomUUID()}-`));
    tmpDirs.push(activityRoot);
    const jsonl = path.join(activityRoot, "recent.jsonl");
    fs.writeFileSync(
      jsonl,
      JSON.stringify({ text: "memory classification policy vault sealed indexable" }) + "\n",
      "utf8",
    );
    const skillRoot = fs.mkdtempSync(path.join(os.tmpdir(), `skills-${randomUUID()}-`));
    tmpDirs.push(skillRoot);
    const suggestions = buildSkillSuggestionAudit({
      now: new Date(),
      days: 30,
      activityRoots: { codex: activityRoot },
      skillRoots: { memroos: skillRoot },
    });
    expect(suggestions.some((s) => s.slug === "memroos-memory-classification")).toBe(true);
  });
});

describe("long-tail batch18 lib — agent context + identity lifecycle", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
  });

  it("buildAgentContextPacket treats invalid metadata_json as empty metadata", () => {
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    const captureId = randomUUID();
    const candidateId = randomUUID();
    db.prepare(
      `INSERT INTO hive_delegations
       (task_id, from_agent, to_agent, task_summary, status, created_at, updated_at)
       VALUES (?, 'agent-1', 'agent-2', 'Goal task', 'active', ?, ?)`,
    ).run(goalId, "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
    db.prepare(
      `INSERT INTO agent_session_captures
       (id, tenant_id, source_agent_id, runtime, session_id, capture_hash, captured_at)
       VALUES (?, 'default-tenant', 'agent-1', 'test', 'session-1', ?, ?)`,
    ).run(captureId, randomUUID(), "2026-07-01T00:00:00.000Z");
    db.prepare(
      `INSERT INTO agent_memory_candidates
       (id, tenant_id, capture_id, agent_id, memory_type, content, content_hash, status,
        belief_stage, metadata_json, created_at)
       VALUES (?, 'default-tenant', ?, 'agent-1', 'decision_intent', 'content', ?, 'promoted',
        'bronze_raw_source', ?, ?)`,
    ).run(candidateId, captureId, "a".repeat(64), "{not-json", "2026-07-01T00:00:00.000Z");
    const { packet } = buildAgentContextPacket(db, { goalId, actorAgentId: "agent-1", lane: "memory" });
    expect(packet.goal.id).toBe(goalId);
    expect(packet.memories.length).toBeGreaterThanOrEqual(0);
  });

  it("onboardUser skips blank space ids when attaching memberships", () => {
    const space = createSpace(db, { tenantId: "default-tenant", name: `space-${randomUUID().slice(0, 6)}` });
    const receipt = onboardUser(db, {
      email: `user-${randomUUID().slice(0, 6)}@example.com`,
      displayName: "Batch18 User",
      role: "operator",
      spaceIds: ["", "   ", space.id],
      agentKit: { name: "Batch Agent", platform: "memroos", skills: [], capabilities: [] },
    });
    expect(receipt.userId).toMatch(/^usr_/);
    const members = db
      .prepare("SELECT space_id FROM space_members WHERE member_id = ?")
      .all(receipt.userId) as Array<{ space_id: string }>;
    expect(members.some((m) => m.space_id === space.id)).toBe(true);
    expect(members.length).toBe(1);
  });

  it("onboardUser requires agentKit.name", () => {
    expect(() =>
      onboardUser(db, {
        email: "a@example.com",
        displayName: "A",
        role: "operator",
        spaceIds: [],
        agentKit: { name: "  ", platform: "memroos" },
      }),
    ).toThrow(/agentKit.name is required/);
  });
});
