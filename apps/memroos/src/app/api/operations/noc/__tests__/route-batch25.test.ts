// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DIR = path.join(os.tmpdir(), `operations-noc-b25-${crypto.randomUUID()}`);
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

describe("GET /api/operations/noc batch25", () => {
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

  it("normalizes operator load unreachable reports and invalid timestamps", async () => {
    writeReport({
      status: "unreachable",
      p95Ms: "slow",
      errorRate: "high",
      generatedAt: "not-a-date",
      findings: "not-an-array",
    });
    const { GET } = await loadRoute(REPO_ROOT);
    const body = await (await GET(new Request("http://localhost/api/operations/noc?window=24h&workspace=all"))).json();

    expect(body.operatorLoadStatus.status).toBe("unreachable");
    expect(body.operatorLoadStatus.ageHours).toBeNull();
    expect(body.operatorLoadStatus.p95Ms).toBeNull();
    expect(body.operatorLoadStatus.findings).toEqual([]);
    expect(body.panels.operatorLoad.status).toBe("degraded");
  });

  it("maps unknown operator load status to missing", async () => {
    writeReport({
      status: "mystery-batch25",
      generatedAt: new Date().toISOString(),
    });
    vi.resetModules();
    const { GET } = await loadRoute(REPO_ROOT);
    const body = await (await GET(new Request("http://localhost/api/operations/noc?window=7d&workspace=remote"))).json();
    expect(body.operatorLoadStatus.status).toBe("missing");
  });

  it("builds security and open HIL attention items from sqlite", async () => {
    const { GET, getDb } = await loadRoute(REPO_ROOT);
    const db = getDb();
    const timestamp = new Date().toISOString();

    db.prepare(
      `INSERT INTO hil_escalations(id, tenant_id, entity_type, entity_id, escalation_type, sla_seconds, sla_deadline, status, opened_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("hil-open-b25", "default-tenant", "task", "task-b25", "agent_escalate", 120, timestamp, "open", "operator", timestamp);

    db.prepare(
      `INSERT INTO audit_log(actor, action, target, severity, timestamp)
       VALUES (?, ?, ?, ?, ?)`,
    ).run("operator", "policy blocked", "ingress route", "high", timestamp);

    const body = await (await GET(new Request("http://localhost/api/operations/noc?window=24h&workspace=local"))).json();

    expect(body.attention).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "hil:hil-open-b25",
          severity: "warning",
          title: expect.stringContaining("Pending HIL review"),
        }),
        expect.objectContaining({
          id: expect.stringMatching(/^security:/),
          severity: "critical",
          title: expect.stringContaining("Security finding"),
        }),
      ]),
    );
  });

  it("surfaces stale context sources as info attention items", async () => {
    vi.doMock("@/lib/context-sources", () => ({
      loadContextSourceContracts: () => ({ sources: [] }),
      evaluateContextSources: () => ({
        sources: [
          {
            id: "batch25-source",
            status: "stale",
            lastError: null,
            repairHint: "Reindex batch25",
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

    const body = await (await route.GET(new Request("http://localhost/api/operations/noc?window=24h&workspace=all"))).json();
    expect(body.attention).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "source:batch25-source",
          severity: "info",
          detail: "Reindex batch25",
        }),
      ]),
    );
    dbModule.closeDb();
  });
});
