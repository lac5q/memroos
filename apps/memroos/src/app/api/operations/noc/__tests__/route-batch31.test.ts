// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DIR = path.join(os.tmpdir(), `operations-noc-b31-${crypto.randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DIR, "noc.db");
const REPO_ROOT = path.resolve(process.cwd(), "../..");
const OPERATOR_LOAD_DIR = path.join(REPO_ROOT, "reports", "operator-load");
const OPERATOR_LOAD_FILE = path.join(OPERATOR_LOAD_DIR, "latest.json");
const OPERATOR_LOAD_BACKUP = path.join(OPERATOR_LOAD_DIR, "latest.json.bak-b31");

async function loadRoute() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  vi.resetModules();
  const route = await import("../route");
  const dbModule = await import("@/lib/db");
  return { ...route, ...dbModule };
}

describe("GET /api/operations/noc batch31 — panel envelope and operator pass branches", () => {
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
    if (fs.existsSync(OPERATOR_LOAD_BACKUP)) {
      fs.renameSync(OPERATOR_LOAD_BACKUP, OPERATOR_LOAD_FILE);
    } else if (fs.existsSync(OPERATOR_LOAD_FILE)) {
      fs.unlinkSync(OPERATOR_LOAD_FILE);
    }
  });

  it("operator load pass yields live panel without warnings", async () => {
    fs.mkdirSync(OPERATOR_LOAD_DIR, { recursive: true });
    if (fs.existsSync(OPERATOR_LOAD_FILE)) {
      fs.renameSync(OPERATOR_LOAD_FILE, OPERATOR_LOAD_BACKUP);
    }
    fs.writeFileSync(
      OPERATOR_LOAD_FILE,
      JSON.stringify({
        status: "pass",
        p95Ms: 80,
        errorRate: 0,
        generatedAt: new Date().toISOString(),
        findings: [],
      }),
      "utf8",
    );
    const { GET } = await loadRoute();
    const body = await (await GET(new Request("http://localhost/api/operations/noc?window=24h&workspace=all"))).json();
    expect(body.operatorLoadStatus.status).toBe("pass");
    expect(body.panels.operatorLoad.status).toBe("live");
    expect(body.panels.operatorLoad.warnings).toEqual([]);
  });

  it("degrades skills panel when skill_registry latest probe fails", async () => {
    const { GET, getDb } = await loadRoute();
    const db = getDb();
    db.exec("ALTER TABLE skill_registry RENAME TO skill_registry_archived_b31");
    const res = await GET(new Request("http://localhost/api/operations/noc?window=24h&workspace=all"));
    if (res.ok) {
      const body = await res.json();
      expect(body.metrics.enabledSkills.status).not.toBe("live");
      expect(body.panels.skills.status).toMatch(/degraded|missing|empty/);
      expect(body.panels.skills.warnings.length).toBeGreaterThan(0);
    } else {
      expect(res.status).toBeGreaterThanOrEqual(500);
    }
  });
});
