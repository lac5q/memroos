// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DIR = path.join(os.tmpdir(), `operations-noc-b37-${randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DIR, "noc.db");
const REPO_ROOT = path.resolve(process.cwd(), "../..");
const OPERATOR_LOAD_DIR = path.join(REPO_ROOT, "reports", "operator-load");
const OPERATOR_LOAD_FILE = path.join(OPERATOR_LOAD_DIR, "latest.json");
const OPERATOR_LOAD_BACKUP = path.join(OPERATOR_LOAD_DIR, `latest.json.bak-b37-${randomUUID()}`);

async function loadRoute() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  vi.resetModules();
  const route = await import("../route");
  const dbModule = await import("@/lib/db");
  return { ...route, ...dbModule };
}

describe("GET /api/operations/noc batch37", () => {
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

  it("operator load pass status is preserved (62-65)", async () => {
    fs.mkdirSync(OPERATOR_LOAD_DIR, { recursive: true });
    if (fs.existsSync(OPERATOR_LOAD_FILE)) {
      fs.renameSync(OPERATOR_LOAD_FILE, OPERATOR_LOAD_BACKUP);
    }
    fs.writeFileSync(
      OPERATOR_LOAD_FILE,
      JSON.stringify({
        status: "pass",
        generatedAt: new Date().toISOString(),
        findings: ["batch37 pass"],
        p95Ms: 120,
        errorRate: 0.01,
      }),
      "utf8",
    );
    const { GET } = await loadRoute();
    const body = await (await GET(new Request("http://localhost/api/operations/noc?window=24h&workspace=all"))).json();
    expect(body.operatorLoadStatus.status).toBe("pass");
    expect(body.operatorLoadStatus.p95Ms).toBe(120);
  });

  it("operator load missing when report file absent", async () => {
    fs.mkdirSync(OPERATOR_LOAD_DIR, { recursive: true });
    if (fs.existsSync(OPERATOR_LOAD_FILE)) {
      fs.renameSync(OPERATOR_LOAD_FILE, OPERATOR_LOAD_BACKUP);
    }
    const { GET } = await loadRoute();
    const body = await (await GET(new Request("http://localhost/api/operations/noc?window=24h&workspace=local"))).json();
    expect(body.operatorLoadStatus.status).toBe("missing");
  });

  it("unknown operator load status maps to missing (62-65)", async () => {
    fs.mkdirSync(OPERATOR_LOAD_DIR, { recursive: true });
    if (fs.existsSync(OPERATOR_LOAD_FILE)) {
      fs.renameSync(OPERATOR_LOAD_FILE, OPERATOR_LOAD_BACKUP);
    }
    fs.writeFileSync(
      OPERATOR_LOAD_FILE,
      JSON.stringify({ status: "mystery-b37", generatedAt: new Date().toISOString() }),
      "utf8",
    );
    const { GET } = await loadRoute();
    const body = await (await GET(new Request("http://localhost/api/operations/noc?window=24h&workspace=remote"))).json();
    expect(body.operatorLoadStatus.status).toBe("missing");
  });
});