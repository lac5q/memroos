// @vitest-environment node
import crypto, { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  ensureAgentContextBusSchema,
  listAgentContextMessages,
  postAgentContextMessage,
} from "@/lib/agent-context-bus";
import { validateA2aAgentCard, isAllowedAgentCardUrl } from "@/lib/a2a/card-ingestion";
import { previousSkillEntryHash, skillAuditEntryHash } from "@/lib/audit/skill-chain";
import { collectLocalFootprintInventory, defaultLocalStoreProfiles } from "@/lib/cloud-offload/footprint";
import { verifyDelegationChain } from "@/lib/identity/delegation";
import { createIntercomAdapter } from "@/lib/l3/adapters/intercom";
import {
  negotiateDescriptor,
  resolveRegisteredTool,
  validateInitializeParams,
  validateJsonRpcEnvelope,
} from "@/lib/msiq/mcp-protocol";
import { processNativeMemoryIngest } from "@/lib/native-memory/sink";
import { matchDimensions } from "@/lib/policy/dimensions";
import { validateTask } from "@/lib/retrieval-bench/validation";
import { verifyLaneAssignments } from "@/lib/retrieval-bench/lanes";
import { createEvalJob, listEvalJobs } from "@/lib/seal/behavioral-jobs";
import { getA2aConfig } from "@/lib/a2a/config";
import { REQUIRED_MSIQ_CAPABILITIES, REQUIRED_MSIQ_TOOLS } from "@/lib/msiq/mcp-protocol";
import { computeWDelta } from "@/lib/skillforge/eval-gate";
import { validateOkfBundle } from "@/lib/okf";
import {
  extractWikilinks,
  listWikiTree,
  readWikiPage,
  resolveWikiPath,
  resolveWikilink,
  searchWikiPages,
} from "@/lib/wiki-vault";
import { gsdInputFromJson, gsdStringArray } from "@/lib/agent-gsd-control";

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

function seedContextAgents(db: Database.Database) {
  ensureAgentContextBusSchema(db);
  db.prepare(
    `INSERT INTO registered_agents(id, name, role, platform, protocol, status)
     VALUES ('agent-a', 'A', 'ops', 'codex', 'rest', 'active'),
            ('agent-b', 'B', 'ops', 'codex', 'rest', 'active')`,
  ).run();
}

function seedSealProposal(db: Database.Database, id: string, agentId = "agent-1"): void {
  const runId = `run-for-${id}`;
  db.prepare(
    `INSERT OR IGNORE INTO eval_runs (
       id, trace_id, agent_id, role, composite_w, trusted, drift_agreement, drift_status,
       layer_breakdown_json, scorer_results_json, judge_provider, judge_model, judge_model_family,
       prompt_template_version, prompt_hash, golden_set_path, golden_set_version, config_hash,
       started_at, completed_at
     ) VALUES (?, ?, ?, 'ops', 0.42, 1, 1.0, 'passed', '{}', '[]', 'local', 'judge', 'local',
       'v1', 'hash', './golden.jsonl', 'v1', 'config', '2026-05-21T00:00:00.000Z', '2026-05-21T00:00:01.000Z')`,
  ).run(runId, `trace-for-${id}`, agentId);
  db.prepare(
    `INSERT OR IGNORE INTO seal_proposals (
       id, trace_id, run_id, agent_id, proposal_type, status, diff_json, rationale,
       forecast_w_delta, baseline_w, baseline_run_id, baseline_layer_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'skill_addition', 'approved', '{}', 'batch15', 0.0, 0.42, ?, '{}',
       '2026-05-21T00:00:00.000Z', '2026-05-21T00:00:00.000Z')`,
  ).run(id, `trace-for-${id}`, runId, agentId, runId);
}

describe("long-tail batch15 — lib modules", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe("scheduler-singleton stale and race paths", () => {
    let lockPath: string;

    afterEach(() => {
      if (lockPath && fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
      vi.resetModules();
    });

    it("reclaims unreadable lock files", async () => {
      lockPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sched-b15-")), "scheduler.lock");
      fs.mkdirSync(path.dirname(lockPath), { recursive: true });
      fs.writeFileSync(lockPath, Buffer.from([0xff, 0xfe, 0x00]));

      process.env.MEMROOS_SCHEDULER_LOCK = lockPath;
      vi.resetModules();
      const { tryAcquireSchedulerLock } = await import("@/lib/scheduler-singleton");
      expect(tryAcquireSchedulerLock()).toBe(true);
      expect(fs.readFileSync(lockPath, "utf8").trim()).toBe(String(process.pid));
    });

    it("returns false when another live pid holds the lock", async () => {
      lockPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sched-b15-live-")), "scheduler.lock");
      fs.mkdirSync(path.dirname(lockPath), { recursive: true });
      fs.writeFileSync(lockPath, "999997");
      process.env.MEMROOS_SCHEDULER_LOCK = lockPath;
      vi.spyOn(process, "kill").mockImplementation((pid) => {
        if (pid === 999997) return true as unknown as void;
        return true as unknown as void;
      });
      vi.resetModules();
      const { tryAcquireSchedulerLock } = await import("@/lib/scheduler-singleton");
      expect(tryAcquireSchedulerLock()).toBe(false);
    });
  });

  describe("cloud-offload footprint", () => {
    it("resolves bare home tilde paths in default profiles", () => {
      const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "home-b15-"));
      vi.spyOn(os, "homedir").mockReturnValue(fakeHome);
      const qmd = defaultLocalStoreProfiles("/tmp/repo").find((p) => p.id === "qmd-cache");
      expect(qmd?.path).toBe(path.join(fakeHome, ".cache", "qmd"));
    });

    it("emits warnings for large permanent stores", () => {
      const repo = fs.mkdtempSync(path.join(os.tmpdir(), "foot-b15-"));
      fs.mkdirSync(path.join(repo, "data"), { recursive: true });
      fs.writeFileSync(path.join(repo, "data/conversations.db"), "x");
      const realStat = fs.statSync.bind(fs);
      vi.spyOn(fs, "statSync").mockImplementation((target, opts) => {
        const p = String(target);
        if (p.includes("conversations.db")) {
          return { isFile: () => true, isDirectory: () => false, size: 2 * 1024 * 1024 * 1024 + 1 } as fs.Stats;
        }
        return realStat(target, opts);
      });
      const inventory = collectLocalFootprintInventory(repo);
      expect(inventory.warnings.some((w) => w.includes("sqlite-operational"))).toBe(true);
      fs.rmSync(repo, { recursive: true, force: true });
    });
  });

  describe("agent-context-bus list filters", () => {
    it("filters inbox, outbox, all, and correlationId", () => {
      const db = freshDb();
      seedContextAgents(db);
      postAgentContextMessage(db, {
        fromAgent: "agent-a",
        toAgent: "agent-b",
        body: "hello",
        correlationId: `corr-${randomUUID()}`,
      });
      const corr = `corr-${randomUUID()}`;
      postAgentContextMessage(db, {
        fromAgent: "agent-b",
        toAgent: "agent-a",
        body: "reply path",
        correlationId: corr,
      });

      const inbox = listAgentContextMessages(db, { agentId: "agent-b", box: "inbox" });
      expect(inbox.every((m) => m.toAgent === "agent-b")).toBe(true);

      const outbox = listAgentContextMessages(db, { agentId: "agent-a", box: "outbox" });
      expect(outbox.every((m) => m.fromAgent === "agent-a")).toBe(true);

      const all = listAgentContextMessages(db, { agentId: "agent-a", box: "all" });
      expect(all.length).toBeGreaterThanOrEqual(2);

      const byCorr = listAgentContextMessages(db, { correlationId: corr });
      expect(byCorr).toHaveLength(1);
      db.close();
    });
  });

  describe("msiq mcp-protocol branches", () => {
    it("rejects capability entries with invalid version types", () => {
      const out = validateInitializeParams({
        protocolVersion: "2024-11-05",
        capabilities: [{ name: "tools", version: 123, source: "host" }],
        clientInfo: { name: "c", version: "1" },
      });
      expect(out.ok).toBe(false);
    });

    it("negotiateDescriptor fails on unsupported transport and missing tools", () => {
      const init = {
        protocolVersion: "2024-11-05" as const,
        capabilities: REQUIRED_MSIQ_CAPABILITIES.map((name) => ({ name, version: "1", source: "host" })),
        tools: [],
      };
      const badTransport = negotiateDescriptor({
        transport: "stdio",
        initialize: init,
        transcript: [],
      });
      expect(badTransport.ok).toBe(false);

      const missingTools = negotiateDescriptor({
        transport: "local",
        initialize: init,
        transcript: [],
      });
      expect(missingTools.ok).toBe(false);
      if (!missingTools.ok) expect(missingTools.reason).toBe("missing_tools");

      const completeTools = negotiateDescriptor({
        transport: "local",
        initialize: {
          ...init,
          tools: REQUIRED_MSIQ_TOOLS.map((name) => ({ name, description: name })),
        },
        transcript: [],
      });
      expect(completeTools.ok).toBe(true);
    });

    it("resolveRegisteredTool enforces scope and capability requirements", () => {
      const tools = [
        {
          name: "memory.search",
          description: "search",
          inputSchema: {},
          requiredScope: ["tenant"],
          requiredCapabilities: ["read"],
        },
      ];
      expect(resolveRegisteredTool({ tools, name: "missing" }).ok).toBe(false);
      expect(
        resolveRegisteredTool({ tools, name: "memory.search", requestedScope: ["tenant"], requestedCapabilities: ["read"] }).ok,
      ).toBe(true);
      expect(
        resolveRegisteredTool({ tools, name: "memory.search", requestedScope: ["wrong"] }).ok,
      ).toBe(false);
      expect(
        resolveRegisteredTool({ tools, name: "memory.search", requestedScope: ["tenant"] }).ok,
      ).toBe(false);
    });

    it("validateJsonRpcEnvelope rejects unknown top-level fields", () => {
      const out = validateJsonRpcEnvelope({
        jsonrpc: "2.0",
        id: "1",
        method: "tools/list",
        extra: true,
      });
      expect(out.ok).toBe(false);
    });
  });

  describe("retrieval-bench validation session edges", () => {
    it("flags invalid session turns and roles", () => {
      const raw = {
        id: "task-b15",
        dataset: "memroos_public_synthetic",
        task_type: "single_hop",
        corpus: [{ id: "c1", text: "hello" }],
        question: "q?",
        expected_answer: "a",
        evidence_spans: ["c1"],
        license: "MIT",
        citation: "batch15",
        provenance: {
          dataset: "memroos_public_synthetic",
          sourceCitation: "c",
          sourceLicense: "MIT",
          sourceAvailability: "synthetic",
        },
        sessions: [
          {
            session_id: "s1",
            turns: [{ role: "bot", content: "nope" }],
          },
        ],
      };
      const result = validateTask(raw, { seenIds: new Set() });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.some((i) => i.field.includes("turns"))).toBe(true);
      }
    });
  });

  describe("lanes registry drift guard", () => {
    it("verifyLaneAssignments stays aligned with schema map", () => {
      expect(verifyLaneAssignments()).toEqual({ ok: true, mismatches: [] });
    });
  });

  describe("policy dimensions scalar object fields", () => {
    it("matches visibility and purpose when request uses scalar strings", () => {
      const rule = {
        object: { visibility: ["internal"] },
        purpose: ["audit"],
        effect: "deny" as const,
      };
      expect(
        matchDimensions(rule, {
          object: { visibility: "internal" },
          purpose: "audit",
        }),
      ).toBe(true);
      expect(
        matchDimensions(rule, {
          object: { visibility: "public" },
          purpose: "audit",
        }),
      ).toBe(false);
    });
  });

  describe("wiki-vault filesystem helpers", () => {
    let wikiRoot: string;

    beforeEach(() => {
      wikiRoot = fs.mkdtempSync(path.join(os.tmpdir(), `wiki-b15-${randomUUID()}-`));
      fs.mkdirSync(path.join(wikiRoot, "guides"), { recursive: true });
      fs.writeFileSync(
        path.join(wikiRoot, "guides", "start.md"),
        "# Start Here\n\nSee [[other-page]] for more.\n",
      );
      fs.writeFileSync(path.join(wikiRoot, "other-page.md"), "# Other\n\ncontent\n");
    });

    afterEach(() => {
      fs.rmSync(wikiRoot, { recursive: true, force: true });
    });

    it("lists tree, reads pages, resolves wikilinks, and searches", () => {
      expect(resolveWikiPath(wikiRoot, "../etc/passwd")).toBeNull();
      const tree = listWikiTree(wikiRoot, 2);
      expect(tree.some((n) => n.path === "guides")).toBe(true);
      const page = readWikiPage(wikiRoot, "guides/start.md");
      expect(page?.title).toBe("Start Here");
      expect(extractWikilinks(page!.content)).toContain("other-page");
      expect(resolveWikilink(wikiRoot, "other-page")).toBe("other-page.md");
      const hits = searchWikiPages(wikiRoot, "other", 5);
      expect(hits.length).toBeGreaterThan(0);
    });
  });

  describe("okf bundle validation", () => {
    it("reports invalid frontmatter parse failures", () => {
      const result = validateOkfBundle({
        "bad.md": "---\n:type: [\n---\nbody\n",
      });
      expect(result.conformant).toBe(false);
      expect(result.errors.some((e) => e.code === "invalid_frontmatter")).toBe(true);
    });
  });

  describe("native-memory sink alerts", () => {
    it("records HIGH-severity filter matches in alerts", () => {
      const secret = `ghp_${"a".repeat(36)}`;
      const result = processNativeMemoryIngest({
        source: "claude",
        agentId: "agent-1",
        userId: "user-1",
        content: `token=${secret}\nnotes=ok\n`,
        memoryPath: "/tmp/MEMORY.md",
      });
      expect(result.filter.matchCount).toBeGreaterThan(0);
      expect(result.alerts.some((a) => a.includes("content_filter"))).toBe(true);
      expect(result.filter.patternNames.length).toBeGreaterThan(0);
    });
  });

  describe("skillforge computeWDelta gates", () => {
    it("gates on low improvement and negative delta", () => {
      const strong = { overallScore: 0.85, taskScores: [] };
      const heldOut = { behavioralW: 0.85, passRate: 0.9, tasksRun: 3 };
      expect(computeWDelta(strong, heldOut, 0.5).gated).toBe(false);
      expect(computeWDelta(strong, heldOut, 0.84).gated).toBe(true);
      expect(computeWDelta({ overallScore: 0.3, taskScores: [] }, heldOut, 0.5).gated).toBe(true);
      expect(computeWDelta(strong, { ...heldOut, passRate: 0.2, tasksRun: 3 }, 0.5).gated).toBe(true);
    });
  });

  describe("seal behavioral-jobs list filters", () => {
    it("filters eval jobs by proposalId, status, and limit", () => {
      const db = freshDb();
      seedSealProposal(db, "prop-a");
      seedSealProposal(db, "prop-b");
      const j1 = createEvalJob(db, { proposalId: "prop-a", proposalType: "skill_addition", agentId: "agent-1" });
      const j2 = createEvalJob(db, { proposalId: "prop-a", proposalType: "skill_addition", agentId: "agent-2" });
      createEvalJob(db, { proposalId: "prop-b", proposalType: "skill_addition", agentId: "agent-1" });
      db.prepare(`UPDATE seal_eval_jobs SET status = 'passed' WHERE id = ?`).run(j2.id);

      expect(listEvalJobs(db, { proposalId: "prop-a", status: "passed" })).toHaveLength(1);
      expect(listEvalJobs(db, { limit: 2 }).map((j) => j.id)).toContain(j1.id);
      db.close();
    });
  });

  describe("audit skill-chain hash helpers", () => {
    it("returns null previous hash when metadata is corrupt", () => {
      const db = freshDb();
      db.prepare(
        `INSERT INTO audit_entries (
           id, tenant_id, actor_id, actor_role, event_type, entity_type, entity_id,
           reason, metadata_json, created_at
         ) VALUES ('ae1', 'default-tenant', 'op', 'operator', 'skill_pin_set', 'skill', 's1', NULL, '{bad', ?)`,
      ).run(new Date().toISOString());
      expect(previousSkillEntryHash(db, "default-tenant")).toBeNull();
      const hash = skillAuditEntryHash({
        id: "x",
        tenantId: "default-tenant",
        actorId: "op",
        actorRole: "operator",
        eventType: "skill.test",
        entityType: "skill",
        entityId: "s1",
        reason: null,
        metadata: { entryHash: "sha256:abc" },
        createdAt: new Date().toISOString(),
      });
      expect(hash.startsWith("sha256:")).toBe(true);
      db.close();
    });
  });

  describe("identity delegation verification failures", () => {
    it("returns stable reason codes for malformed chains", () => {
      expect(verifyDelegationChain({} as never).reason).toBe("missing_user");
      expect(
        verifyDelegationChain({
          user: { id: "u", role: "admin" },
          agent: { id: "a", capabilities: [] },
          hops: [],
        }).reason,
      ).toBe("missing_hops");
    });
  });

  describe("a2a card ingestion helpers", () => {
    it("blocks private-network card URLs when policy disallows them", () => {
      const strict = { ...getA2aConfig(), allowPrivateNetworkCards: false };
      expect(isAllowedAgentCardUrl("http://172.16.0.1/card.json", strict)).toBe(false);
      expect(isAllowedAgentCardUrl("https://agents.example/card.json", strict)).toBe(true);
    });

    it("validateA2aAgentCard rejects skills without ids", () => {
      expect(() =>
        validateA2aAgentCard({
          name: "Agent",
          url: "https://agent.example/rpc",
          version: "1",
          skills: [{ name: "only-name" }],
        }),
      ).toThrow(/at least one skill/);
    });
  });

  describe("intercom adapter fetch failure", () => {
    it("returns empty events when Intercom API responds with error", async () => {
      process.env.INTERCOM_ACCESS_TOKEN = "tok";
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({ ok: false, status: 502, text: async () => "bad gateway" })),
      );
      const events = await createIntercomAdapter({ mock: false }).poll(new Date());
      expect(events).toEqual([]);
      delete process.env.INTERCOM_ACCESS_TOKEN;
    });
  });

  describe("agent-gsd-control json helpers", () => {
    it("normalizes json inputs and string arrays", () => {
      expect(gsdInputFromJson("not-object")).toEqual({});
      expect(gsdStringArray(["a", 1, "b"])).toEqual(["a", "b"]);
    });
  });
});
