// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const mockAuthenticateUser = vi.fn();
const mockAuthenticateAgent = vi.fn();
const mockAuthorizeRegistryWrite = vi.fn();
const mockEmbedText = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => mockAuthenticateUser(...args),
}));

vi.mock("@/lib/agent-registry", () => ({
  authenticateAgentHeaders: (...args: unknown[]) => mockAuthenticateAgent(...args),
  recordToolOutcome: vi.fn(),
  recordHeartbeat: vi.fn(() => ({ ok: true })),
  listRegisteredAgents: vi.fn(() => []),
}));

vi.mock("@/lib/operator-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/operator-auth")>();
  return {
    ...actual,
    authorizeRegistryWrite: (...args: unknown[]) => mockAuthorizeRegistryWrite(...args),
  };
});

vi.mock("@/lib/knowledge-collections", () => ({
  loadCollections: vi.fn(() => [
    { name: "ops-docs", category: "internal" as const, path: "/tmp/ops" },
    { name: "empty-set", category: "public" as const, path: "/tmp/empty" },
  ]),
  collectCollectionFiles: vi.fn(async (collection: { name: string }) => {
    if (collection.name === "ops-docs") {
      return [{ mtime: new Date("2026-01-15T12:00:00.000Z") }];
    }
    return [];
  }),
}));

vi.mock("@/lib/embeddings/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/embeddings/provider")>();
  return {
    ...actual,
    embedText: (...args: unknown[]) => mockEmbedText(...args),
  };
});

const LOOPBACK = "http://localhost";

const operatorSession = {
  userId: "op-1",
  role: "operator" as const,
  email: "op@example.com",
  displayName: "Operator",
  tenantId: "default-tenant",
};

function asReq(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as unknown as NextRequest;
}

function jsonPost(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function insertMessage(
  overrides: Partial<{
    session_id: string;
    project: string;
    agent_id: string;
    role: string;
    content: string;
    timestamp: string;
    visibility: string;
    policy: string;
  }> = {}
) {
  return testDb
    .prepare(
      `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      overrides.session_id ?? "sess-1",
      overrides.project ?? "default",
      overrides.agent_id ?? "agent-a",
      overrides.role ?? "user",
      overrides.content ?? "hello recall batch13b",
      overrides.timestamp ?? "2026-01-01T00:00:00.000Z",
      overrides.visibility ?? "public_approved",
      overrides.policy ?? "indexable"
    ).lastInsertRowid as number;
}

function insertSkillSyncRow(row: {
  skill_name: string;
  source_harness: string;
  pending_proposal_id?: string | null;
  pending_detected_hash?: string | null;
  pending_diff_summary?: string;
  pending_diff_payload?: string;
  approved_at?: string | null;
  rejected_at?: string | null;
  last_synced_hash?: string | null;
  version_pinned_to?: string | null;
}) {
  const now = new Date().toISOString();
  testDb
    .prepare(
      `INSERT INTO skill_sync_state (
        skill_name, source_harness, last_synced_hash, pending_proposal_id,
        pending_detected_hash, pending_detected_version, pending_diff_summary,
        pending_diff_payload, pending_proposed_by, pending_proposed_at,
        version_pinned_to, last_check_at, approved_at, rejected_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 'scanner', ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.skill_name,
      row.source_harness,
      row.last_synced_hash ?? "aa".repeat(32),
      row.pending_proposal_id ?? null,
      row.pending_detected_hash ?? null,
      row.pending_diff_summary ?? "",
      row.pending_diff_payload ?? "{}",
      now,
      row.version_pinned_to ?? null,
      now,
      row.approved_at ?? null,
      row.rejected_at ?? null,
      now
    );
}

const APO_PROPOSAL = "APO_PROPOSAL_demo_skill_demo_20260505_120000.md";
const APO_BODY = `# Proposal
**APO Constraint to add to SKILL.md:**
\`\`\`
Always validate auth before retry.
\`\`\`
`;

async function loadApoRoute(apoRoot: string) {
  vi.resetModules();
  vi.stubEnv("APO_PROPOSALS_PATH", path.join(apoRoot, "proposals"));
  vi.stubEnv("APO_SKILLS_PATH", path.join(apoRoot, "skills"));
  vi.stubEnv("APO_AGENT_CONFIGS_PATH", path.join(apoRoot, "agents"));
  vi.stubEnv("APO_CRON_LOG_PATH", path.join(apoRoot, "cron.log"));
  vi.stubEnv("SKILLS_PATH", path.join(apoRoot, "skills"));
  vi.stubEnv("HOME", apoRoot);
  for (const segment of [
    "github/PMO/agents",
    "github/knowledge/agent-configs",
    "github/knowledge/skills",
    ".openclaw/skills",
    ".claude/skills",
  ]) {
    mkdirSync(path.join(apoRoot, segment), { recursive: true });
  }
  return import("../apo/route");
}

describe("long-tail batch 13b — API routes", () => {
  beforeEach(() => {
    mockAuthenticateUser.mockReset();
    mockAuthenticateAgent.mockReset();
    mockAuthorizeRegistryWrite.mockReset();
    mockEmbedText.mockReset();
    mockAuthenticateUser.mockResolvedValue(operatorSession);
    mockAuthenticateAgent.mockReturnValue({ id: "agent-1", name: "Agent" });
    mockAuthorizeRegistryWrite.mockReturnValue(true);
    mockEmbedText.mockResolvedValue({ degraded: false, embedding: [0.1, 0.2, 0.3] });
    delete process.env.MEMROOS_OPERATOR_API_KEY;
    delete process.env.MEMROOS_AGENT_API_KEY;
    vi.unstubAllEnvs();
  });

  describe("POST/GET /api/apo", () => {
    let apoRoot: string;

    beforeEach(() => {
      apoRoot = mkdtempSync(path.join(tmpdir(), "apo-batch13b-"));
    });

    afterEach(() => {
      rmSync(apoRoot, { recursive: true, force: true });
    });

    it("GET returns empty stats when proposal directories are absent", async () => {
      const { GET } = await loadApoRoute(apoRoot);
      const body = await (await GET()).json();
      expect(body.stats.totalProposals).toBe(0);
      expect(body.stats.recentLogLines).toEqual([]);
      expect(body.stats.lastRun).toBeNull();
    });

    it("GET parses cron log run markers into stats.lastRun", async () => {
      writeFileSync(path.join(apoRoot, "cron.log"), "[2026-05-05 12:00:00] Starting APO cycle\n");
      const { GET } = await loadApoRoute(apoRoot);
      const body = await (await GET()).json();
      expect(body.stats.lastRun).toEqual(expect.any(String));
      expect(body.stats.recentLogLines.length).toBeGreaterThan(0);
    });

    it("POST defaults action to approve when action is omitted", async () => {
      mkdirSync(path.join(apoRoot, "proposals"), { recursive: true });
      mkdirSync(path.join(apoRoot, "skills", "demo"), { recursive: true });
      writeFileSync(path.join(apoRoot, "proposals", APO_PROPOSAL), APO_BODY);
      writeFileSync(path.join(apoRoot, "skills", "demo", "SKILL.md"), "# Skill\n");
      const { POST } = await loadApoRoute(apoRoot);
      const res = await POST(jsonPost(`${LOOPBACK}/api/apo`, { proposalId: APO_PROPOSAL }));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, queued: true });
    });

    it("POST rejects remote writes without registry authorization", async () => {
      mockAuthorizeRegistryWrite.mockReturnValueOnce(false);
      const { POST } = await loadApoRoute(apoRoot);
      const res = await POST(
        jsonPost("https://memroos.example/api/apo", {
          action: "approve",
          proposalId: APO_PROPOSAL,
        })
      );
      expect(res.status).toBe(403);
    });

    it("POST apply-approved returns 422 when constraint block is missing", async () => {
      mkdirSync(path.join(apoRoot, "proposals", "approved"), { recursive: true });
      writeFileSync(path.join(apoRoot, "proposals", "approved", APO_PROPOSAL), "# no constraint\n");
      const { POST } = await loadApoRoute(apoRoot);
      const res = await POST(
        jsonPost(`${LOOPBACK}/api/apo`, { action: "apply-approved", proposalId: APO_PROPOSAL })
      );
      expect(res.status).toBe(422);
    });

    it("POST process-approved reports failures when queue items are invalid", async () => {
      mkdirSync(path.join(apoRoot, "proposals", "approved"), { recursive: true });
      writeFileSync(path.join(apoRoot, "proposals", "approved", APO_PROPOSAL), "# no constraint\n");
      const { POST } = await loadApoRoute(apoRoot);
      const res = await POST(jsonPost(`${LOOPBACK}/api/apo`, { action: "process-approved", limit: 1 }));
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.failed).toBe(1);
      expect(body.processed).toBe(0);
    });
  });

  describe("GET/POST /api/hive", () => {
    it("GET ?context_id= groups delegations and parsed action artifacts", async () => {
      testDb
        .prepare(
          `INSERT INTO hive_delegations(task_id, from_agent, to_agent, task_summary, priority, status, context_id)
           VALUES ('t-ctx', 'director', 'worker', 'ctx task', 3, 'active', 'ctx-99')`
        )
        .run();
      testDb
        .prepare(
          `INSERT INTO hive_actions(agent_id, action_type, summary, artifacts)
           VALUES ('worker', 'continue', 'ctx step', '{"context_id":"ctx-99","step":1}')`
        )
        .run();

      const { GET } = await import("../hive/route");
      const res = await GET(asReq(`${LOOPBACK}/api/hive?context_id=ctx-99`));
      const body = await res.json();
      expect(body.context_id).toBe("ctx-99");
      expect(body.delegations).toHaveLength(1);
      expect(body.actions[0].artifacts).toEqual({ context_id: "ctx-99", step: 1 });
    });

    it("GET ?task_id= returns delegation context_id when present", async () => {
      testDb
        .prepare(
          `INSERT INTO hive_delegations(task_id, from_agent, to_agent, task_summary, priority, status, context_id)
           VALUES ('task-bind', 'lead', 'worker', 'bound task', 2, 'active', 'ctx-bind')`
        )
        .run();
      testDb
        .prepare(
          `INSERT INTO hive_actions(agent_id, action_type, summary, artifacts)
           VALUES ('worker', 'trigger', 'bound action', '{"task_id":"task-bind"}')`
        )
        .run();
      const { GET } = await import("../hive/route");
      const body = await (await GET(asReq(`${LOOPBACK}/api/hive?task_id=task-bind`))).json();
      expect(body.context_id).toBe("ctx-bind");
      expect(body.delegation?.task_id).toBe("task-bind");
      expect(body.actions[0].artifacts).toEqual({ task_id: "task-bind" });
    });

    it("GET ?type=delegation rejects invalid status filters", async () => {
      const { GET } = await import("../hive/route");
      const res = await GET(asReq(`${LOOPBACK}/api/hive?type=delegation&status=unknown`));
      expect(res.status).toBe(400);
    });

    it("GET ?type=delegation filters by status only", async () => {
      testDb
        .prepare(
          `INSERT INTO hive_delegations(task_id, from_agent, to_agent, task_summary, priority, status)
           VALUES ('s1', 'a', 'b', 'pending task', 1, 'pending'),
                  ('s2', 'a', 'b', 'done task', 1, 'completed')`
        )
        .run();
      const { GET } = await import("../hive/route");
      const body = await (await GET(asReq(`${LOOPBACK}/api/hive?type=delegation&status=pending`))).json();
      expect(body.delegations.every((d: { status: string }) => d.status === "pending")).toBe(true);
    });

    it("GET ?type=delegation filters by to_agent and status together", async () => {
      testDb
        .prepare(
          `INSERT INTO hive_delegations(task_id, from_agent, to_agent, task_summary, priority, status)
           VALUES ('f1', 'a', 'target', 'match', 1, 'active'),
                  ('f2', 'a', 'other', 'miss agent', 1, 'active'),
                  ('f3', 'a', 'target', 'miss status', 1, 'pending')`
        )
        .run();
      const { GET } = await import("../hive/route");
      const body = await (
        await GET(asReq(`${LOOPBACK}/api/hive?type=delegation&to_agent=target&status=active`))
      ).json();
      expect(body.delegations).toHaveLength(1);
      expect(body.delegations[0].task_id).toBe("f1");
    });

    it("GET honors limit=1 when multiple rows exist for an agent", async () => {
      const agent = `limit-agent-${Date.now()}`;
      for (let i = 0; i < 3; i++) {
        testDb
          .prepare(
            `INSERT INTO hive_actions(agent_id, action_type, summary)
             VALUES (?, 'loop', ?)`
          )
          .run(agent, `row-${i}`);
      }
      const { GET } = await import("../hive/route");
      const body = await (await GET(asReq(`${LOOPBACK}/api/hive?agent=${agent}&limit=1`))).json();
      expect(body.actions.length).toBe(1);
    });

    it("POST delegation rejects invalid status values", async () => {
      const { POST } = await import("../hive/route");
      const res = await POST(
        jsonPost(`${LOOPBACK}/api/hive`, {
          type: "delegation",
          task_id: "bad-status",
          from_agent: "a",
          to_agent: "b",
          task_summary: "task",
          status: "not-a-status",
        }) as unknown as NextRequest
      );
      expect(res.status).toBe(400);
    });

    it("POST action persists session_id on hive_actions rows", async () => {
      const { POST, GET } = await import("../hive/route");
      await POST(
        jsonPost(`${LOOPBACK}/api/hive`, {
          agent_id: "session-agent",
          action_type: "checkpoint",
          summary: "session scoped action",
          session_id: "sess-42",
        }) as unknown as NextRequest
      );
      const row = (await (await GET(asReq(`${LOOPBACK}/api/hive?agent=session-agent`))).json()).actions.find(
        (a: { summary: string }) => a.summary === "session scoped action"
      );
      expect(row?.session_id).toBe("sess-42");
    });
  });

  describe("GET/POST /api/ontology", () => {
    it("GET rejects remote reads without registry authorization", async () => {
      mockAuthorizeRegistryWrite.mockReturnValueOnce(false);
      const { GET } = await import("../ontology/route");
      const res = GET(new Request("https://memroos.example/api/ontology"));
      expect(res.status).toBe(403);
    });

    it("POST rejects non-object JSON bodies", async () => {
      const { POST } = await import("../ontology/route");
      const res = await POST(
        new Request(`${LOOPBACK}/api/ontology`, { method: "POST", body: JSON.stringify([]) })
      );
      expect(res.status).toBe(400);
    });

    it("POST rejects unknown actions with invalid code", async () => {
      const { POST } = await import("../ontology/route");
      const res = await POST(jsonPost(`${LOOPBACK}/api/ontology`, { action: "nope", actor: "operator" }));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ ok: false, code: "invalid" });
    });

    it("POST ensure_canonical then GET discover returns published ontology", async () => {
      const { POST, GET } = await import("../ontology/route");
      const ensured = await POST(
        jsonPost(`${LOOPBACK}/api/ontology`, { action: "ensure_canonical", actor: "operator" })
      );
      expect(ensured.status).toBe(200);
      const discovered = await (await GET(new Request(`${LOOPBACK}/api/ontology`))).json();
      expect(discovered.ok).toBe(true);
      expect(discovered.ontology.status).toBe("published");
    });

    it("GET provenance binding returns null when record is unbound", async () => {
      const { GET } = await import("../ontology/route");
      const body = await (
        await GET(new Request(`${LOOPBACK}/api/ontology?recordType=memory&recordId=missing-bind`))
      ).json();
      expect(body.ok).toBe(true);
      expect(body.binding).toBeNull();
    });
  });

  describe("GET /api/recall", () => {
    it("returns agent-scoped messages when agent_id is set without q", async () => {
      insertMessage({ agent_id: "agent-only", content: "agent scoped listing" });
      const { GET } = await import("../recall/route");
      const body = await (await GET(asReq(`${LOOPBACK}/api/recall?agent_id=agent-only`))).json();
      expect(body.agent_id).toBe("agent-only");
      expect(body.results.length).toBeGreaterThan(0);
      expect(body.recall_scope).toBe("single");
    });

    it("returns semantic mode payload when embeddings succeed", async () => {
      insertMessage({ content: "semantic mode batch13b keyword" });
      const { GET } = await import("../recall/route");
      const body = await (
        await GET(asReq(`${LOOPBACK}/api/recall?q=semantic+mode+batch13b&mode=semantic`))
      ).json();
      expect(body.mode).toBe("semantic");
      expect(body.degraded).toBe(false);
      expect(mockEmbedText).toHaveBeenCalled();
    });

    it("returns hybrid mode payload when embeddings succeed", async () => {
      insertMessage({ content: "hybrid mode batch13b keyword" });
      const { GET } = await import("../recall/route");
      const body = await (
        await GET(asReq(`${LOOPBACK}/api/recall?q=hybrid+mode+batch13b&mode=hybrid`))
      ).json();
      expect(body.mode).toBe("hybrid");
      expect(body.degraded).toBe(false);
    });

    it("returns 400 when crossProject=true lacks allowed_project_ids", async () => {
      const { GET } = await import("../recall/route");
      const res = await GET(asReq(`${LOOPBACK}/api/recall?q=test&crossProject=true`));
      expect(res.status).toBe(400);
    });

    it("returns cross scope metadata when allowlist is provided", async () => {
      insertMessage({ project: "proj-a", content: "cross scope batch13b marker" });
      const { GET } = await import("../recall/route");
      const body = await (
        await GET(
          asReq(
            `${LOOPBACK}/api/recall?q=cross+scope+batch13b&crossProject=true&allowed_project_ids=proj-a`
          )
        )
      ).json();
      expect(body.recall_scope).toBe("cross");
      expect(body.allowed_project_ids).toEqual(["proj-a"]);
    });

    it("clamps recall limit above 100 down to 100", async () => {
      const { GET } = await import("../recall/route");
      const res = await GET(asReq(`${LOOPBACK}/api/recall?q=clamp-test&limit=999`));
      expect(res.status).toBe(200);
      expect((await res.json()).results.length).toBeLessThanOrEqual(100);
    });
  });

  describe("GET /api/skills/sync/proposals", () => {
    it("lists pending proposals by default filters", async () => {
      insertSkillSyncRow({
        skill_name: "pending-skill",
        source_harness: "claude",
        pending_proposal_id: "prop-1",
        pending_detected_hash: "bb".repeat(32),
        pending_diff_summary: "changed",
      });
      const { GET } = await import("../skills/sync/proposals/route");
      const body = await (await GET(new Request(`${LOOPBACK}/api/skills/sync/proposals`))).json();
      expect(body.ok).toBe(true);
      expect(body.items.some((i: { proposal_id: string }) => i.proposal_id === "prop-1")).toBe(true);
    });

    it("filters status=pending via SQL predicate", async () => {
      insertSkillSyncRow({
        skill_name: "pending-only",
        source_harness: "codex",
        pending_proposal_id: "prop-pending",
      });
      insertSkillSyncRow({
        skill_name: "approved-only",
        source_harness: "codex",
        pending_proposal_id: "prop-approved",
        approved_at: new Date().toISOString(),
      });
      const { GET } = await import("../skills/sync/proposals/route");
      const body = await (
        await GET(new Request(`${LOOPBACK}/api/skills/sync/proposals?status=pending`))
      ).json();
      expect(body.items.every((i: { status: string }) => i.status === "pending")).toBe(true);
    });

    it("filters status=approved and status=rejected", async () => {
      insertSkillSyncRow({
        skill_name: "approved-skill",
        source_harness: "hermes",
        pending_proposal_id: "prop-a",
        approved_at: new Date().toISOString(),
      });
      insertSkillSyncRow({
        skill_name: "rejected-skill",
        source_harness: "hermes",
        pending_proposal_id: "prop-r",
        rejected_at: new Date().toISOString(),
      });
      const { GET } = await import("../skills/sync/proposals/route");
      const approved = await (
        await GET(new Request(`${LOOPBACK}/api/skills/sync/proposals?status=approved`))
      ).json();
      const rejected = await (
        await GET(new Request(`${LOOPBACK}/api/skills/sync/proposals?status=rejected`))
      ).json();
      expect(approved.items.some((i: { status: string }) => i.status === "approved")).toBe(true);
      expect(rejected.items.some((i: { status: string }) => i.status === "rejected")).toBe(true);
    });

    it("filters status=no_change rows", async () => {
      insertSkillSyncRow({
        skill_name: "steady-skill",
        source_harness: "opencode",
        pending_proposal_id: null,
      });
      const { GET } = await import("../skills/sync/proposals/route");
      const body = await (
        await GET(new Request(`${LOOPBACK}/api/skills/sync/proposals?status=no_change`))
      ).json();
      expect(body.items.some((i: { skill_name: string }) => i.skill_name === "steady-skill")).toBe(true);
    });

    it("returns 400 for invalid status filters", async () => {
      const { GET } = await import("../skills/sync/proposals/route");
      const res = await GET(new Request(`${LOOPBACK}/api/skills/sync/proposals?status=bogus`));
      expect(res.status).toBe(400);
    });

    it("parses diff payload metadata and applies harness/name filters", async () => {
      insertSkillSyncRow({
        skill_name: "filter-me",
        source_harness: "claude",
        pending_proposal_id: "prop-diff",
        pending_diff_payload: JSON.stringify({
          detected_hash: "cc".repeat(32),
          current_hash: "dd".repeat(32),
          detected_version: "2.0.0",
          current_version: "1.0.0",
          source_file_path: "/tmp/filter-me.md",
          source_root: "/tmp/skills",
        }),
      });
      insertSkillSyncRow({
        skill_name: "other-skill",
        source_harness: "codex",
        pending_proposal_id: "prop-other",
      });
      const { GET } = await import("../skills/sync/proposals/route");
      const body = await (
        await GET(
          new Request(
            `${LOOPBACK}/api/skills/sync/proposals?source_harness=claude&skill_name=filter-me&limit=5&offset=0`
          )
        )
      ).json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].diff).toMatchObject({
        detected_hash: "cc".repeat(32),
        source_root: "/tmp/skills",
      });
      expect(body.filters).toMatchObject({ source_harness: "claude", skill_name: "filter-me" });
    });
  });

  describe("GET/POST /api/agents/proposals", () => {
    it("GET lists agent proposal types", async () => {
      const { GET } = await import("../agents/proposals/route");
      const body = await (await GET(asReq(`${LOOPBACK}/api/agents/proposals`))).json();
      expect(Array.isArray(body.proposals)).toBe(true);
      expect(body.timestamp).toEqual(expect.any(String));
    });

    it("GET honors status query filter", async () => {
      const { GET } = await import("../agents/proposals/route");
      const res = await GET(asReq(`${LOOPBACK}/api/agents/proposals?status=pending`));
      expect(res.status).toBe(200);
    });

    it("POST reflect requires traceId and runId", async () => {
      const { POST } = await import("../agents/proposals/route");
      const res = await POST(
        jsonPost(`${LOOPBACK}/api/agents/proposals`, { action: "reflect", agentId: "agent-1" }) as unknown as NextRequest
      );
      expect(res.status).toBe(400);
    });

    it("POST reflect rejects remote hosts without registry write", async () => {
      mockAuthorizeRegistryWrite.mockReturnValueOnce(false);
      const { POST } = await import("../agents/proposals/route");
      const res = await POST(
        jsonPost("https://memroos.example/api/agents/proposals", {
          action: "reflect",
          agentId: "agent-1",
          traceId: "t1",
          runId: "r1",
        }) as unknown as NextRequest
      );
      expect(res.status).toBe(403);
    });
  });

  describe("GET /api/knowledge/trends", () => {
    it("returns day window trends for collections", async () => {
      const { GET } = await import("../knowledge/trends/route");
      const body = await (await GET(asReq(`${LOOPBACK}/api/knowledge/trends?window=day&limit=5`))).json();
      expect(body.window).toBe("day");
      expect(Array.isArray(body.collections)).toBe(true);
      expect(body.collections[0].points.length).toBeGreaterThan(0);
    });

    it("returns week window trends", async () => {
      const { GET } = await import("../knowledge/trends/route");
      const body = await (await GET(asReq(`${LOOPBACK}/api/knowledge/trends?window=week`))).json();
      expect(body.window).toBe("week");
      expect(body.buckets.length).toBe(7);
    });

    it("returns 400 for invalid window values", async () => {
      const { GET } = await import("../knowledge/trends/route");
      const res = await GET(asReq(`${LOOPBACK}/api/knowledge/trends?window=year`));
      expect(res.status).toBe(400);
    });
  });

  describe("GET/PATCH /api/skillforge/proposals", () => {
    it("GET requires authentication on remote hosts", async () => {
      mockAuthorizeRegistryWrite.mockReturnValueOnce(false);
      const { GET } = await import("../skillforge/proposals/route");
      const res = await GET(asReq("https://memroos.example/api/skillforge/proposals"));
      expect(res.status).toBe(401);
    });

    it("GET returns proposal queue on loopback", async () => {
      const { GET } = await import("../skillforge/proposals/route");
      const res = await GET(asReq(`${LOOPBACK}/api/skillforge/proposals`));
      expect(res.status).toBe(200);
    });

    it("PATCH validates required proposalId and action fields", async () => {
      const { PATCH } = await import("../skillforge/proposals/route");
      const res = await PATCH(
        jsonPost(`${LOOPBACK}/api/skillforge/proposals`, { action: "approve" }) as unknown as NextRequest
      );
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/skills/import", () => {
    it("returns paginated registry rows", async () => {
      const { GET } = await import("../skills/import/route");
      const body = await (await GET(new Request(`${LOOPBACK}/api/skills/import?limit=10&offset=0`))).json();
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.limit).toBe(10);
    });

    it("applies source_harness and dispatch_status filters", async () => {
      testDb
        .prepare(
          `INSERT INTO skill_registry (
            name, description, owner, source_harness, risk_tier, dispatch_status,
            version, preconditions, allowed_tools, verification_checks, rollback_behavior,
            raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
            evidence_examples, content_hash, signature, signed_by, signed_at, trust_level,
            public_key_fingerprint
          ) VALUES (
            'import-filter', 'd', 'ops', 'claude', 'low', 'enabled',
            '1.0.0', 'none', 'read', '[]', 'revert',
            'body', 100, '[]', 'operator', ?, '[]', ?, NULL, NULL, NULL, 'unsigned', NULL
          )`
        )
        .run(new Date().toISOString(), "ee".repeat(32));
      const { GET } = await import("../skills/import/route");
      const body = await (
        await GET(
          new Request(`${LOOPBACK}/api/skills/import?source_harness=claude&dispatch_status=enabled`)
        )
      ).json();
      expect(body.items.some((row: { name: string }) => row.name === "import-filter")).toBe(true);
    });
  });
});
