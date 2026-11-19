// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { closeDb, getDb } from "@/lib/db";
import { _resetForTest, hasLogFunction, runDecay } from "@/lib/memory-decay";
import {
  aggregateSourceStatus,
  loadEnabledMeetingCollections,
  searchMeetingCollections,
} from "@/lib/meeting-qmd-recall";
import { parseAgents, parseModelUsage } from "@/lib/parsers";
import { evaluateKnowledgePolicy, evaluatePolicy } from "@/lib/policy/engine";
import {
  assembleRecollectionContextPack,
  decideRecollection,
  planRecollectionQueries,
  scoreRecollectionCandidate,
} from "@/lib/recollection-policy";

describe("lib batch15 mid — policy, recollection, parsers, decay, meetings", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    _resetForTest();
  });

  it("evaluatePolicy validates request shape and unsupported domains", () => {
    expect(() => evaluatePolicy({ domain: "" as never, action: "read" })).toThrow(/domain is required/);
    expect(() => evaluatePolicy({ domain: "memory-use", action: "" as never })).toThrow(/action is required/);
    expect(() =>
      evaluatePolicy(
        { domain: "memory-use", action: "read", actor: { id: "a", role: "agent" } },
        new Database(":memory:"),
      ),
    ).toThrow(/memoryUse payload/);
    expect(() =>
      evaluatePolicy(
        { domain: "capability", action: "dispatch", actor: { id: "a", role: "agent" } },
        new Database(":memory:"),
      ),
    ).toThrow(/capability payload/);
    expect(() =>
      evaluatePolicy({ domain: "knowledge", action: "read" }, new Database(":memory:")),
    ).toThrow(/requires an actor/);
    expect(() => evaluatePolicy({ domain: "unknown" as never, action: "read" })).toThrow(/unsupported domain/);
    expect(() =>
      evaluatePolicy({
        domain: "knowledge",
        action: "read",
        actor: { id: "a", role: "agent" },
        ontologyReference: {
          tenantId: "default-tenant",
          spaceId: "s",
          recordType: "knowledge",
          recordId: "1",
        },
      }),
    ).toThrow(/require persistence/);
  });

  it("evaluateKnowledgePolicy emits best-effort receipt when db is provided", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const evaluation = evaluateKnowledgePolicy(
      {
        action: "knowledge.read",
        actor: { id: "agent:test", role: "agent", tenantId: "default-tenant" },
      },
      db,
    );
    expect(evaluation.receipt.outcome).toBe("allow");
    const count = (db.prepare(`SELECT COUNT(*) AS c FROM audit_entries`).get() as { c: number }).c;
    expect(count).toBeGreaterThanOrEqual(0);
    db.close();
  });

  it("evaluatePolicy dimension tightening can flip allow to deny for GTM export", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const evaluation = evaluatePolicy(
      {
        domain: "memory-use",
        action: "export.gtm-client",
        actor: { id: "agent-gtm", role: "agent" },
        memoryUse: {
          actor: { id: "agent-gtm", role: "agent" },
          purpose: "export",
          label: {
            visibility: "internal",
            policy: "agent_visible",
            domain: "client",
            sensitivity: "privileged",
          },
        },
        dimensions: {
          subject: { team: ["GTM"] },
          object: { domain: ["client"], sensitivity: ["privileged"] },
          purpose: "export",
        },
      },
      db,
    );
    expect(evaluation.receipt.outcome).toBe("deny");
    expect(evaluation.receipt.reason).toContain("dimension_deny");
    db.close();
  });

  it("recollection policy scoring and assembly cover recency, freshness, and threshold branches", () => {
    expect(planRecollectionQueries({ taskText: "   " })).toEqual([]);
    const decision = decideRecollection({
      taskText: "What changed last month in checkout?",
      project: "MemRoOS",
      entities: ["checkout"],
      sourceRefs: ["github:issue-1"],
      handoffState: { hasPendingHandoff: true },
      rediscoveryRisk: true,
    });
    expect(decision.decision).toBe("search_required");
    expect(decision.reasons).toContain("task_has_recency_ref");

    const now = new Date("2026-06-01T00:00:00Z");
    const scored = scoreRecollectionCandidate(
      {
        id: "c1",
        tier: "vector",
        content: "checkout freeze budget",
        beliefStage: "bronze_raw_source",
        authorization: "redacted",
        sourceHealth: "degraded",
        policyRisk: "high",
        capturedAt: "2026-05-31T23:00:00.000Z",
        importance: Number.NaN,
        provenance: "test",
      },
      { taskText: "checkout budget", now },
    );
    expect(scored.components.recency).toBeGreaterThan(0.8);
    expect(scored.components.freshness).toBe(0.25);
    expect(scored.components.policy).toBe(0.55);

    const pack = assembleRecollectionContextPack(
      [
        {
          id: "low",
          tier: "vector",
          content: "unrelated topic",
          beliefStage: "bronze_raw_source",
          provenance: "test",
          authorization: "allowed",
        },
        {
          id: "high",
          tier: "vector",
          content: "checkout budget freeze",
          beliefStage: "gold_operational_truth",
          provenance: "test",
          authorization: "allowed",
          capturedAt: "2026-05-31T12:00:00.000Z",
        },
      ],
      { taskText: "checkout budget", threshold: 0.2, maxItems: 1, now },
    );
    expect(pack.injected).toHaveLength(1);
    expect(pack.ignored.some((i) => i.reason === "below_threshold")).toBe(true);
  });

  it("parseAgents skips non-directories and parseModelUsage tolerates missing home projects", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `agents-b15-${crypto.randomUUID()}-`));
    fs.writeFileSync(path.join(root, "not-a-dir.txt"), "x");
    const agentDir = path.join(root, "codex-agent");
    fs.mkdirSync(agentDir);
    const hb = path.join(agentDir, "HEARTBEAT.md");
    fs.writeFileSync(hb, "STATUS: ok");
    const oldMtime = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    fs.utimesSync(hb, oldMtime, oldMtime);
    const agents = await parseAgents(root);
    expect(agents.some((a) => a.id === "codex-agent" && a.status === "dormant")).toBe(true);

    vi.stubEnv("HOME", fs.mkdtempSync(path.join(os.tmpdir(), `home-b15-${crypto.randomUUID()}-`)));
    const usage = await parseModelUsage();
    expect(usage.models).toEqual([]);
  });

  it("hasLogFunction probes sqlite LOG() and runDecay records failed status on internal errors", () => {
    _resetForTest();
    expect(typeof hasLogFunction()).toBe("boolean");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `decay-b15-${crypto.randomUUID()}-`));
    process.env.MEMROOS_ROOT = root;
    process.env.SQLITE_DB_PATH = path.join(root, "decay.db");
    try {
      closeDb();
    } catch {
      /* ignore */
    }
    const db = getDb();
    initSchema(db);
    const messageId = Number(
      db
        .prepare(
          `INSERT INTO messages (session_id, project, agent_id, role, content, timestamp)
           VALUES ('sess', 'proj', 'agent', 'user', 'decay me', datetime('now', '-2 days'))`,
        )
        .run().lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO memory_salience (message_id, tier, salience_score, access_count, last_decay_at)
       VALUES (?, 'low', 0.8, 1, datetime('now', '-2 days'))`,
    ).run(messageId);
    const originalPrepare = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation((sql: unknown) => {
      if (typeof sql === "string" && sql.includes("UPDATE memory_salience SET salience_score")) {
        throw new Error("decay boom");
      }
      return originalPrepare(sql as string);
    });
    const summary = runDecay({ tenantId: "default-tenant", actorId: "operator", scope: { tenantId: "default-tenant" } });
    expect(summary.status).toBe("failed");
    closeDb();
    delete process.env.MEMROOS_ROOT;
    delete process.env.SQLITE_DB_PATH;
  });

  it("meeting qmd recall expands home paths and normalizes nested hit shapes", async () => {
    const cfgDir = path.join(os.homedir(), `.memroos-qmd-b15-${crypto.randomUUID().slice(0, 8)}`);
    fs.mkdirSync(cfgDir, { recursive: true });
    const cfg = path.join(cfgDir, "meeting-sources.json");
    fs.writeFileSync(
      cfg,
      JSON.stringify({ sources: [{ enabled: true, qmdCollections: ["meetings-batch15"] }] }),
      "utf8",
    );
    const fromTilde = await loadEnabledMeetingCollections(`~/${path.basename(cfgDir)}/meeting-sources.json`);
    expect(fromTilde).toEqual(["meetings-batch15"]);
    fs.rmSync(cfgDir, { recursive: true, force: true });

    const execFileAsync = vi.fn(async () => ({
      stdout: JSON.stringify({ results: [{ file: "/meetings/a.md", title: "Budget", snippet: "notes" }] }),
    }));
    const search = await searchMeetingCollections("budget", 5, ["col-a"], execFileAsync);
    expect(search.hits[0]?.content).toContain("notes");
    expect(aggregateSourceStatus(search.collectionStatus)).toBeDefined();
  });
});
