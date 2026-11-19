// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DIR = path.join(os.tmpdir(), `operations-noc-b22-${crypto.randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DIR, "noc.db");
const DEEP_CWD = path.join(TEST_DIR, "deep", "nested", "app");

async function loadRoute(cwd: string) {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  vi.spyOn(process, "cwd").mockReturnValue(cwd);
  vi.resetModules();
  const route = await import("../route");
  const dbModule = await import("@/lib/db");
  return { ...route, ...dbModule };
}

describe("GET /api/operations/noc batch22 — findRepoRoot fallback", () => {
  beforeEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    fs.mkdirSync(DEEP_CWD, { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    const { closeDb } = await loadRoute(DEEP_CWD);
    closeDb();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.SQLITE_DB_PATH;
    vi.resetModules();
  });

  it("returns missing operator load when cwd has no reports/operator-load ancestor", async () => {
    const { GET } = await loadRoute(DEEP_CWD);
    const body = await (await GET(new Request("http://localhost/api/operations/noc?window=24h"))).json();
    expect(body.ok).toBe(true);
    expect(body.operatorLoadStatus.status).toBe("missing");
    expect(body.panels.operatorLoad.status).toBe("degraded");
  });
});
