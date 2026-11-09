// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DIR = path.join(os.tmpdir(), `operations-noc-b30-${crypto.randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DIR, "noc.db");
const REPO_ROOT = path.resolve(process.cwd(), "../..");
const OPERATOR_LOAD_DIR = path.join(REPO_ROOT, "reports", "operator-load");
const OPERATOR_LOAD_FILE = path.join(OPERATOR_LOAD_DIR, "latest.json");
const OPERATOR_LOAD_BACKUP = path.join(OPERATOR_LOAD_DIR, "latest.json.bak-b30");

async function loadRoute() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  vi.resetModules();
  const route = await import("../route");
  const dbModule = await import("@/lib/db");
  return { ...route, ...dbModule };
}

describe("GET /api/operations/noc batch30 — operator load branches", () => {
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

  it("maps baseline and unreachable operator load statuses", async () => {
    fs.mkdirSync(OPERATOR_LOAD_DIR, { recursive: true });
    if (fs.existsSync(OPERATOR_LOAD_FILE)) {
      fs.renameSync(OPERATOR_LOAD_FILE, OPERATOR_LOAD_BACKUP);
    }
    const generatedAt = new Date().toISOString();
    fs.writeFileSync(
      OPERATOR_LOAD_FILE,
      JSON.stringify({
        status: "baseline",
        p95Ms: null,
        errorRate: null,
        generatedAt,
        findings: ["synthetic baseline batch30"],
      }),
      "utf8",
    );

    const { GET } = await loadRoute();
    const baseline = await (await GET(new Request("http://localhost/api/operations/noc?window=24h&workspace=all"))).json();
    expect(baseline.operatorLoadStatus.status).toBe("baseline");
    expect(baseline.panels.operatorLoad.status).toBe("degraded");

    fs.writeFileSync(
      OPERATOR_LOAD_FILE,
      JSON.stringify({
        status: "unreachable",
        generatedAt,
        findings: ["oracle down batch30"],
        p95Ms: 1200,
        errorRate: 0.5,
      }),
      "utf8",
    );
    vi.resetModules();
    process.env.SQLITE_DB_PATH = TEST_DB_PATH;
    const route2 = await import("../route");
    const unreachable = await (
      await route2.GET(new Request("http://localhost/api/operations/noc?window=7d&workspace=remote"))
    ).json();
    expect(unreachable.operatorLoadStatus.status).toBe("unreachable");
    expect(String(unreachable.panels.operatorLoad.warnings[0])).toMatch(/unreachable/i);
  });

  it("classifies unknown operator load status as missing", async () => {
    fs.mkdirSync(OPERATOR_LOAD_DIR, { recursive: true });
    if (fs.existsSync(OPERATOR_LOAD_FILE)) {
      fs.renameSync(OPERATOR_LOAD_FILE, OPERATOR_LOAD_BACKUP);
    }
    fs.writeFileSync(
      OPERATOR_LOAD_FILE,
      JSON.stringify({ status: "mystery-batch30", generatedAt: new Date().toISOString() }),
      "utf8",
    );
    const { GET } = await loadRoute();
    const body = await (await GET(new Request("http://localhost/api/operations/noc?window=24h&workspace=local"))).json();
    expect(body.operatorLoadStatus.status).toBe("missing");
  });
});
