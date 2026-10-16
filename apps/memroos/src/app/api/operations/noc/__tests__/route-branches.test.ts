// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DIR = path.join(os.tmpdir(), `operations-noc-branches-${crypto.randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DIR, "noc.db");
const REPO_ROOT = path.resolve(process.cwd(), "../..");
const OPERATOR_LOAD_DIR = path.join(REPO_ROOT, "reports", "operator-load");
const OPERATOR_LOAD_FILE = path.join(OPERATOR_LOAD_DIR, "latest.json");
const OPERATOR_LOAD_BACKUP = path.join(OPERATOR_LOAD_DIR, "latest.json.bak-test");

async function loadRoute() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  vi.resetModules();
  const route = await import("../route");
  const dbModule = await import("@/lib/db");
  return { ...route, ...dbModule };
}

describe("GET /api/operations/noc branch coverage", () => {
  beforeEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    const { closeDb } = await loadRoute();
    closeDb();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.SQLITE_DB_PATH;
    vi.resetModules();
    vi.doUnmock("@/lib/context-sources");
    if (fs.existsSync(OPERATOR_LOAD_BACKUP)) {
      fs.renameSync(OPERATOR_LOAD_BACKUP, OPERATOR_LOAD_FILE);
    } else if (fs.existsSync(OPERATOR_LOAD_FILE)) {
      fs.unlinkSync(OPERATOR_LOAD_FILE);
    }
  });

  it("returns null operator load status when latest.json is malformed", async () => {
    fs.mkdirSync(OPERATOR_LOAD_DIR, { recursive: true });
    if (fs.existsSync(OPERATOR_LOAD_FILE)) {
      fs.renameSync(OPERATOR_LOAD_FILE, OPERATOR_LOAD_BACKUP);
    }
    fs.writeFileSync(OPERATOR_LOAD_FILE, "{ not valid json", "utf8");

    const { GET } = await loadRoute();
    const body = await (await GET(new Request("http://localhost/api/operations/noc?window=24h&workspace=all"))).json();
    expect(body.operatorLoadStatus?.status).toBe("missing");
    expect(body.panels.operatorLoad.status).toBe("degraded");
  });

  it("labels agent activity window_empty when history exists outside the window", async () => {
    const { GET, getDb } = await loadRoute();
    const db = getDb();
    const oldTimestamp = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    db.prepare(
      `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("old-session", "operator", "codex", "assistant", "stale", oldTimestamp, "internal", "indexable");

    const body = await (await GET(new Request("http://localhost/api/operations/noc?window=24h&workspace=all"))).json();
    expect(body.agentActivity.sourceState).toBe("window_empty");
    expect(body.agentActivity.agents).toEqual([]);
  });

  it("surfaces operator load status from reports/operator-load/latest.json", async () => {
    fs.mkdirSync(OPERATOR_LOAD_DIR, { recursive: true });
    if (fs.existsSync(OPERATOR_LOAD_FILE)) {
      fs.renameSync(OPERATOR_LOAD_FILE, OPERATOR_LOAD_BACKUP);
    }
    const generatedAt = new Date().toISOString();
    fs.writeFileSync(
      OPERATOR_LOAD_FILE,
      JSON.stringify({
        status: "pass",
        p95Ms: 120,
        errorRate: 0.01,
        generatedAt,
        targetHost: "oracle-1",
        endpoint: "/health",
        findings: [],
        manifest: { gitSha: "abc123" },
      }),
      "utf8"
    );

    const { GET } = await loadRoute();
    const response = await GET(new Request("http://localhost/api/operations/noc?window=24h&workspace=all"));
    const body = await response.json();

    expect(body.operatorLoadStatus).toMatchObject({
      status: "pass",
      p95Ms: 120,
      errorRate: 0.01,
      generatedAt,
      targetHost: "oracle-1",
      gitSha: "abc123",
    });
    expect(body.panels.operatorLoad.status).toBe("live");
    expect(body.panels.operatorLoad.warnings).toEqual([]);
  });

  it("degrades operator load panel when the report status is fail", async () => {
    fs.mkdirSync(OPERATOR_LOAD_DIR, { recursive: true });
    if (fs.existsSync(OPERATOR_LOAD_FILE)) {
      fs.renameSync(OPERATOR_LOAD_FILE, OPERATOR_LOAD_BACKUP);
    }
    fs.writeFileSync(
      OPERATOR_LOAD_FILE,
      JSON.stringify({
        status: "fail",
        p95Ms: 900,
        errorRate: 0.2,
        generatedAt: new Date().toISOString(),
      }),
      "utf8"
    );

    const { GET } = await loadRoute();
    const body = await (await GET(new Request("http://localhost/api/operations/noc?window=24h&workspace=all"))).json();

    expect(body.operatorLoadStatus.status).toBe("fail");
    expect(body.panels.operatorLoad.status).toBe("degraded");
    expect(body.panels.operatorLoad.warnings[0]).toMatch(/fail/i);
  });

  it("includes hive delegations in agent activity when present", async () => {
    const { GET, getDb } = await loadRoute();
    const db = getDb();
    const timestamp = new Date().toISOString();
    db.prepare(
      `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy, request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("deleg-session", "operator", "codex", "assistant", "live", timestamp, "internal", "indexable", "deleg-1");
    db.prepare(
      `INSERT INTO hive_delegations(task_id, from_agent, to_agent, task_summary, priority, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("task-deleg", "codex", "claude", "review patch", 1, "active", timestamp, timestamp);

    const body = await (await GET(new Request("http://localhost/api/operations/noc?window=24h&workspace=local"))).json();

    expect(body.agentActivity.delegations).toEqual([
      expect.objectContaining({
        taskId: "task-deleg",
        fromAgent: "codex",
        toAgent: "claude",
        status: "active",
      }),
    ]);
  });

  it("marks HIL SLA breaches as critical attention items", async () => {
    const { GET, getDb } = await loadRoute();
    const db = getDb();
    const timestamp = new Date().toISOString();
    db.prepare(
      `INSERT INTO hil_escalations(id, tenant_id, entity_type, entity_id, escalation_type, sla_seconds, sla_deadline, status, opened_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("hil-breach", "default-tenant", "task", "task-b", "agent_escalate", 60, timestamp, "sla_breached", "operator", timestamp);

    const body = await (await GET(new Request("http://localhost/api/operations/noc?window=24h&workspace=all"))).json();
    const item = body.attention.find((row: { id: string }) => row.id === "hil:hil-breach");

    expect(item).toMatchObject({
      severity: "critical",
      title: expect.stringContaining("SLA breached"),
      target: "/escalations",
    });
  });

  it("surfaces degraded context sources as info attention items", async () => {
    vi.resetModules();
    vi.doMock("@/lib/context-sources", () => ({
      loadContextSourceContracts: () => ({ sources: [] }),
      evaluateContextSources: () => ({
        sources: [
          {
            id: "qmd",
            status: "degraded",
            lastError: "partial index rebuild",
            repairHint: "Run QMD repair",
            lastRun: "2026-07-01T00:00:00.000Z",
          },
        ],
        timestamp: "2026-07-20T12:00:00.000Z",
      }),
    }));
    process.env.SQLITE_DB_PATH = TEST_DB_PATH;
    const route = await import("../route");
    const dbModule = await import("@/lib/db");
    const body = await (await route.GET(new Request("http://localhost/api/operations/noc?window=24h&workspace=all"))).json();
    const degraded = body.attention.filter((item: { id: string }) => item.id.startsWith("source:"));

    expect(degraded).toEqual([
      expect.objectContaining({
        id: "source:qmd",
        severity: "info",
        detail: "partial index rebuild",
        target: "/library",
      }),
    ]);
    dbModule.closeDb();
  });

  it("returns deprecated skills and live cron warnings panel when jobs need attention", async () => {
    const { GET, getDb } = await loadRoute();
    const db = getDb();
    const timestamp = new Date().toISOString();
    db.prepare(
      `INSERT INTO cron_health_jobs(id, name, source_family, schedule, status, expected_interval_minutes, warning, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("cron-warn", "Embed backlog", "memory", "hourly", "active", 60, "stalled", timestamp);
    db.prepare(
      `INSERT INTO skill_registry (
        name, description, owner, source_harness, risk_tier, dispatch_status,
        version, preconditions, allowed_tools, verification_checks, rollback_behavior,
        raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
        evidence_examples, content_hash, signature, signed_by, signed_at, trust_level,
        public_key_fingerprint, lifecycle_state
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?
      )`
    ).run(
      "deprecated-skill",
      "Deprecated skill",
      "ops",
      "claude",
      "low",
      "enabled",
      "1.0.0",
      "none",
      "read_file",
      "verify",
      "revert",
      "## body",
      100,
      "[]",
      "operator",
      timestamp,
      "evidence",
      null,
      null,
      null,
      null,
      "unsigned",
      null,
      "deprecated"
    );

    const body = await (await GET(new Request("http://localhost/api/operations/noc?window=24h&workspace=all"))).json();

    expect(body.metrics.cronWarnings.value).toBeGreaterThanOrEqual(1);
    expect(body.panels.cron.status).toBe("live");
    expect(body.skills.deprecated.some((row: { name: string }) => row.name === "deprecated-skill")).toBe(true);
  });
});
