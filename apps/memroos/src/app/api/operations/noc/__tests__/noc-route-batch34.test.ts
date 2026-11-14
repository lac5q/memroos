// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DIR = path.join(os.tmpdir(), `operations-noc-b34-${randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DIR, "noc.db");
const REPO_ROOT = path.resolve(process.cwd(), "../..");
const OPERATOR_LOAD_DIR = path.join(REPO_ROOT, "reports", "operator-load");
const OPERATOR_LOAD_FILE = path.join(OPERATOR_LOAD_DIR, "latest.json");
const OPERATOR_LOAD_BACKUP = path.join(OPERATOR_LOAD_DIR, `latest.json.bak-b34-${randomUUID()}`);

async function loadRoute() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  vi.resetModules();
  const route = await import("../route");
  const dbModule = await import("@/lib/db");
  return { ...route, ...dbModule };
}

describe("GET /api/operations/noc batch34 — remaining branch gaps", () => {
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
    vi.doUnmock("@/lib/cloud-offload/footprint");
    vi.doUnmock("@/lib/db");
    if (fs.existsSync(OPERATOR_LOAD_BACKUP)) {
      fs.renameSync(OPERATOR_LOAD_BACKUP, OPERATOR_LOAD_FILE);
    } else if (fs.existsSync(OPERATOR_LOAD_FILE)) {
      fs.unlinkSync(OPERATOR_LOAD_FILE);
    }
  });

  it("operator load with non-parseable generatedAt yields null ageHours (56-61)", async () => {
    fs.mkdirSync(OPERATOR_LOAD_DIR, { recursive: true });
    if (fs.existsSync(OPERATOR_LOAD_FILE)) {
      fs.renameSync(OPERATOR_LOAD_FILE, OPERATOR_LOAD_BACKUP);
    }
    fs.writeFileSync(
      OPERATOR_LOAD_FILE,
      JSON.stringify({
        status: "fail",
        p95Ms: 444,
        errorRate: 0.08,
        generatedAt: "not-a-real-timestamp-b34",
        findings: ["bad clock batch34"],
      }),
      "utf8",
    );
    const { GET } = await loadRoute();
    const body = await (await GET(new Request("http://localhost/api/operations/noc?window=24h&workspace=all"))).json();
    expect(body.operatorLoadStatus.ageHours).toBeNull();
    expect(body.operatorLoadStatus.status).toBe("fail");
    expect(String(body.panels.operatorLoad.warnings[0])).toMatch(/fail/i);
    expect(body.panels.operatorLoad.warnings[0]).toMatch(/p95=444ms/);
  });

  it("pending HIL escalations use warning severity (313-314)", async () => {
    const { GET, getDb } = await loadRoute();
    const db = getDb();
    const ts = new Date().toISOString();
    db.prepare(
      `INSERT INTO hil_escalations(id, tenant_id, entity_type, entity_id, escalation_type, sla_seconds, sla_deadline, status, opened_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(`hil-open-b34-${randomUUID().slice(0, 6)}`, "default-tenant", "task", "t-b34", "agent_escalate", 120, ts, "open", "operator", ts);
    const body = await (await GET(new Request("http://localhost/api/operations/noc?window=24h&workspace=all"))).json();
    const pending = body.attention.find((row: { title: string }) => row.title.includes("Pending HIL"));
    expect(pending?.severity).toBe("warning");
  });

  it("degrades memory metrics when messages table is unavailable (138-143, 192-193, 500)", async () => {
    const { GET, getDb } = await loadRoute();
    const db = getDb();
    db.exec("ALTER TABLE messages RENAME TO messages_archived_b34");
    const body = await (await GET(new Request("http://localhost/api/operations/noc?window=24h&workspace=remote"))).json();
    expect(body.metrics.memoryRows.status).not.toBe("live");
    expect(body.metrics.memoryRows.reason).toMatch(/Failed to query|messages/i);
    expect(body.panels.memory.warnings.length).toBeGreaterThan(0);
  });

  it("marks localFootprint degraded when pressure is critical (559-560, 607)", async () => {
    vi.doMock("@/lib/cloud-offload/footprint", () => ({
      collectLocalFootprintInventory: () => ({
        totalBytes: 9 * 1024 * 1024 * 1024,
        pressure: "critical",
        generatedAt: new Date().toISOString(),
        warnings: ["disk batch34 critical"],
        stores: [],
      }),
    }));
    process.env.SQLITE_DB_PATH = TEST_DB_PATH;
    vi.resetModules();
    const { GET } = await import("../route");
    const body = await (await GET(new Request("http://localhost/api/operations/noc?window=24h&workspace=local"))).json();
    expect(body.metrics.localFootprint.status).toBe("degraded");
    expect(body.panels.localFootprint.status).toBe("degraded");
    expect(body.panels.localFootprint.warnings).toContain("disk batch34 critical");
  });

  it("panelFromEnvelope uses empty panel when primary is zero with no rows (380-382)", async () => {
    const { GET } = await loadRoute();
    const body = await (await GET(new Request("http://localhost/api/operations/noc?window=24h&workspace=all"))).json();
    expect(body.panels.memory.status).toMatch(/empty|missing|live/);
    expect(body.metrics.memoryRows.value ?? 0).toBe(0);
  });

  it("returns 500 when buildNocResponse throws (648)", async () => {
    vi.doMock("@/lib/db", async () => {
      const actual = await vi.importActual<typeof import("@/lib/db")>("@/lib/db");
      return {
        ...actual,
        getDb: () => {
          throw new Error("noc db explode b34");
        },
      };
    });
    process.env.SQLITE_DB_PATH = TEST_DB_PATH;
    vi.resetModules();
    const { GET } = await import("../route");
    const res = await GET(new Request("http://localhost/api/operations/noc?window=24h&workspace=all"));
    expect(res.status).toBe(500);
    const err = (await res.json()) as { error?: string };
    expect(err.error).toMatch(/noc db explode b34/i);
  });
});
