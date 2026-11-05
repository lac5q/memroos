// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DIR = path.join(os.tmpdir(), `operations-noc-b27-${crypto.randomUUID()}`);
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

describe("GET /api/operations/noc batch27", () => {
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

  it("computes operator load ageHours and preserves manifest gitSha", async () => {
    const generatedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    writeReport({
      status: "pass",
      p95Ms: 44,
      errorRate: 0,
      generatedAt,
      targetHost: "localhost",
      endpoint: "http://localhost/api/operations/noc",
      findings: ["batch27 ok"],
      manifest: { gitSha: "sha-batch27" },
    });
    const { GET } = await loadRoute(REPO_ROOT);
    const body = await (await GET(new Request("http://localhost/api/operations/noc?window=24h&workspace=all"))).json();

    expect(body.operatorLoadStatus.ageHours).not.toBeNull();
    expect(Number(body.operatorLoadStatus.ageHours)).toBeGreaterThan(1.5);
    expect(body.operatorLoadStatus.gitSha).toBe("sha-batch27");
    expect(body.operatorLoadStatus.findings).toEqual(["batch27 ok"]);
  });

  it("returns missing operator load when the report file is unreadable JSON", async () => {
    fs.writeFileSync(path.join(REPORT_DIR, "latest.json"), "{broken-batch27", "utf8");
    const { GET } = await loadRoute(REPO_ROOT);
    const body = await (await GET(new Request("http://localhost/api/operations/noc?window=7d&workspace=local"))).json();
    expect(body.operatorLoadStatus.status).toBe("missing");
    expect(body.panels.operatorLoad.status).toBe("degraded");
  });

  it("maps fail operator load reports to degraded panels with warnings", async () => {
    writeReport({
      status: "fail",
      p95Ms: 640,
      errorRate: 0.18,
      generatedAt: new Date().toISOString(),
      findings: ["batch27 latency"],
    });
    vi.resetModules();
    const { GET } = await loadRoute(REPO_ROOT);
    const body = await (await GET(new Request("http://localhost/api/operations/noc?window=24h&workspace=remote"))).json();
    expect(body.operatorLoadStatus.status).toBe("fail");
    expect(body.panels.operatorLoad.status).toBe("degraded");
    expect(body.panels.operatorLoad.warnings.join(" ")).toMatch(/fail|batch27/i);
  });
});
