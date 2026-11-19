// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DIR = path.join(os.tmpdir(), `operations-noc-b24-${crypto.randomUUID()}`);
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

describe("GET /api/operations/noc batch24", () => {
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
  });

  it("maps operator load report statuses and unreadable JSON to missing", async () => {
    writeReport({
      status: "pass",
      p95Ms: 120,
      errorRate: 0.01,
      generatedAt: new Date().toISOString(),
      targetHost: "localhost",
      endpoint: "/api/operations/noc",
      findings: [],
      manifest: { gitSha: "abc123" },
    });
    const { GET: getPass } = await loadRoute(REPO_ROOT);
    const passBody = await (await getPass(new Request("http://localhost/api/operations/noc?window=24h&workspace=all"))).json();
    expect(passBody.operatorLoadStatus.status).toBe("pass");
    expect(passBody.panels.operatorLoad.status).toBe("live");

    writeReport({
      status: "fail",
      p95Ms: 900,
      errorRate: 0.2,
      generatedAt: new Date().toISOString(),
      findings: ["slow batch24"],
    });
    vi.resetModules();
    const { GET: getFail } = await loadRoute(REPO_ROOT);
    const failBody = await (await getFail(new Request("http://localhost/api/operations/noc?window=24h&workspace=remote"))).json();
    expect(failBody.operatorLoadStatus.status).toBe("fail");
    expect(failBody.panels.operatorLoad.warnings[0]).toMatch(/fail/i);

    fs.writeFileSync(path.join(REPORT_DIR, "latest.json"), "{not-json", "utf8");
    vi.resetModules();
    const { GET: getBroken } = await loadRoute(REPO_ROOT);
    const brokenBody = await (await getBroken(new Request("http://localhost/api/operations/noc?window=7d&workspace=local"))).json();
    expect(brokenBody.operatorLoadStatus.status).toBe("missing");
  });

  it("returns baseline operator load status when report marks baseline", async () => {
    writeReport({
      status: "baseline",
      p95Ms: null,
      errorRate: null,
      generatedAt: new Date().toISOString(),
      findings: ["baseline batch24"],
    });
    const { GET } = await loadRoute(REPO_ROOT);
    const body = await (await GET(new Request("http://localhost/api/operations/noc?window=24h&workspace=all"))).json();
    expect(body.operatorLoadStatus.status).toBe("baseline");
    expect(body.panels.operatorLoad.status).toBe("degraded");
  });
});
