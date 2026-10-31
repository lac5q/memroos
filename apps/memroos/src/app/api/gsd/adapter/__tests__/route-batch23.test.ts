// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DB_DIR = path.join(os.tmpdir(), `gsd-adapter-b23-${crypto.randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "adapter.db");
const LOOPBACK = "http://localhost";

vi.mock("@/lib/gsd/adapters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gsd/adapters")>();
  return {
    ...actual,
    executeGsdAdapterAction: vi.fn(() => {
      throw new Error("adapter execution batch23");
    }),
  };
});

async function loadRoute() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  process.env.MEMROOS_ALLOW_LEGACY_UNDECLARED_CAPABILITIES = "on";
  vi.resetModules();
  const registry = await import("@/lib/agent-registry");
  const route = await import("../route");
  const dbModule = await import("@/lib/db");
  return { ...registry, route, closeDb: dbModule.closeDb };
}

describe("POST /api/gsd/adapter batch23", () => {
  beforeEach(() => {
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  });

  afterEach(async () => {
    const { closeDb } = await loadRoute();
    closeDb();
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    delete process.env.SQLITE_DB_PATH;
  });

  it("returns 401 without agent auth and 400 when adapter execution throws", async () => {
    const { route } = await loadRoute();
    const unauth = await route.POST(
      new Request(`${LOOPBACK}/api/gsd/adapter`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }) as never
    );
    expect(unauth.status).toBe(401);

    const { route: route2, registerAgent } = await loadRoute();
    const agent = registerAgent({
      id: "agent-b23",
      name: "Agent B23",
      role: "Worker",
      platform: "codex",
      protocol: "rest",
      issueApiKey: true,
    });
    const res = await route2.POST(
      new Request(`${LOOPBACK}/api/gsd/adapter`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${agent.apiKey}`,
        },
        body: JSON.stringify({
          adapterId: "hermes",
          action: "create_task",
          payload: { title: "fail", goalId: "goal-b23" },
        }),
      }) as never
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "adapter execution batch23" });
  });
});
