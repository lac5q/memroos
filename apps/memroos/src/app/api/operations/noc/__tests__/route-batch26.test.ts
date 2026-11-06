// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DIR = path.join(os.tmpdir(), `operations-noc-b26-${crypto.randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DIR, "noc.db");
const REPO_ROOT = path.join(TEST_DIR, "repo-root");
const REPORT_DIR = path.join(REPO_ROOT, "reports", "operator-load");

async function loadRoute(cwd: string) {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  vi.spyOn(process, "cwd").mockReturnValue(cwd);
  vi.resetModules();
  const route = await import("../route");
  const dbModule = await import("@/lib/db");
  const { initSchema } = await import("@/lib/db-schema");
  initSchema(dbModule.getDb());
  return { ...route, ...dbModule };
}

function writeReport(payload: Record<string, unknown>) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, "latest.json"), JSON.stringify(payload), "utf8");
}

describe("GET /api/operations/noc batch26", () => {
  beforeEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    fs.mkdirSync(REPORT_DIR, { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    try {
      const { closeDb } = await loadRoute(REPO_ROOT);
      closeDb();
    } catch {
      /* ignore */
    }
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.SQLITE_DB_PATH;
    vi.resetModules();
    vi.doUnmock("@/lib/context-sources");
  });

  it("maps operator load pass reports to live panels without warnings", async () => {
    writeReport({
      status: "pass",
      p95Ms: 88,
      errorRate: 0.01,
      generatedAt: new Date().toISOString(),
      findings: [],
    });
    const { GET } = await loadRoute(REPO_ROOT);
    const body = await (await GET(new Request("http://localhost/api/operations/noc?window=24h&workspace=all"))).json();
    expect(body.operatorLoadStatus.status).toBe("pass");
    expect(body.panels.operatorLoad.status).toBe("live");
    expect(body.panels.operatorLoad.warnings).toEqual([]);
  });

  it("builds breached HIL and medium-severity security attention items", async () => {
    const { GET, getDb } = await loadRoute(REPO_ROOT);
    const db = getDb();
    const timestamp = new Date().toISOString();

    db.prepare(
      `INSERT INTO hil_escalations(id, tenant_id, entity_type, entity_id, escalation_type, sla_seconds, sla_deadline, status, opened_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("hil-breach-b26", "default-tenant", "task", "task-b26", "agent_escalate", 120, timestamp, "sla_breached", "operator", timestamp);

    db.prepare(
      `INSERT INTO audit_log(actor, action, target, severity, timestamp)
       VALUES (?, ?, ?, ?, ?)`,
    ).run("operator", "policy review", "security ingress", "medium", timestamp);

    const body = await (await GET(new Request("http://localhost/api/operations/noc?window=24h&workspace=remote"))).json();

    expect(body.attention).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "hil:hil-breach-b26",
          severity: "critical",
          title: expect.stringContaining("HIL SLA breached"),
        }),
        expect.objectContaining({
          id: expect.stringMatching(/^security:/),
          severity: "warning",
          title: expect.stringContaining("Security finding"),
        }),
      ]),
    );
  });

  it("surfaces degraded context sources with lastError detail", async () => {
    vi.doMock("@/lib/context-sources", () => ({
      loadContextSourceContracts: () => ({ sources: [] }),
      evaluateContextSources: () => ({
        sources: [
          {
            id: "batch26-degraded",
            status: "degraded",
            lastError: "batch26 source stale",
            repairHint: "Reindex batch26",
            lastRun: "2026-07-01T00:00:00.000Z",
          },
        ],
        timestamp: "2026-07-20T12:00:00.000Z",
      }),
    }));

    process.env.SQLITE_DB_PATH = TEST_DB_PATH;
    vi.spyOn(process, "cwd").mockReturnValue(REPO_ROOT);
    vi.resetModules();
    const route = await import("../route");
    const dbModule = await import("@/lib/db");
    const { initSchema } = await import("@/lib/db-schema");
    initSchema(dbModule.getDb());

    const body = await (await route.GET(new Request("http://localhost/api/operations/noc?window=7d&workspace=local"))).json();
    expect(body.attention).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "source:batch26-degraded",
          severity: "info",
          detail: "batch26 source stale",
        }),
      ]),
    );
    dbModule.closeDb();
  });
});
