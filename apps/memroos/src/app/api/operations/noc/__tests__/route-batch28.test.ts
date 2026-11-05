// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DIR = path.join(os.tmpdir(), `operations-noc-b28-${crypto.randomUUID()}`);
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

describe("GET /api/operations/noc batch28", () => {
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

  it("lists deprecated skills in the skills panel payload", async () => {
    const { GET, getDb } = await loadRoute(REPO_ROOT);
    const db = getDb();
    const ts = new Date().toISOString();
    db.prepare(
      `INSERT INTO skill_registry
         (name, description, owner, source_harness, risk_tier, dispatch_status, version,
          preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level, lifecycle_state, signature)
       VALUES (?, '', 'ops', 'claude', 'low', 'disabled', '1.0.0',
          '', '', '', '', ?, 100, '[]', 'batch28', ?, '', ?, 'unsigned', 'deprecated', NULL)`,
    ).run(`deprecated-batch28-${crypto.randomUUID().slice(0, 6)}`, "body batch28", ts, "hash-b28");

    const body = await (await GET(new Request("http://localhost/api/operations/noc?window=7d&workspace=local"))).json();
    expect(body.skills.deprecated.length).toBeGreaterThan(0);
    expect(body.skills.deprecated[0].name).toMatch(/deprecated-batch28/);
  });

  it("returns missing operator load when report file is absent", async () => {
    const { GET } = await loadRoute(REPO_ROOT);
    const body = await (await GET(new Request("http://localhost/api/operations/noc?window=30d&workspace=all"))).json();
    expect(body.operatorLoadStatus.status).toBe("missing");
    expect(body.panels.operatorLoad.status).toBe("degraded");
  });
});
