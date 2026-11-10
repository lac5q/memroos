// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DB_DIR = path.join(os.tmpdir(), `memory-add-b32-${randomUUID()}`);

async function loadRoute() {
  process.env.SQLITE_DB_PATH = path.join(TEST_DB_DIR, "routes.db");
  process.env.MEM0_URL = "http://mem0.test";
  vi.resetModules();
  const registry = await import("@/lib/agent-registry");
  const route = await import("../add/route");
  const dbModule = await import("@/lib/db");
  return { ...registry, ...route, closeDb: dbModule.closeDb };
}

describe("POST /api/memory/add batch32", () => {
  beforeEach(() => {
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(async () => {
    const { closeDb } = await loadRoute();
    closeDb();
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.restoreAllMocks();
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    delete process.env.SQLITE_DB_PATH;
    delete process.env.MEM0_URL;
  });

  it("continues when classification module throws (line 98)", async () => {
    vi.doMock("@/lib/classification/cascade", () => ({
      classifyText: () => {
        throw new Error("classifier offline");
      },
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ id: `mem-${randomUUID().slice(0, 8)}` }, { status: 200 }),
      ),
    );

    const { POST, registerAgent } = await loadRoute();
    const { apiKey } = registerAgent({
      id: `memory-agent-b32-${randomUUID().slice(0, 6)}`,
      name: "Memory Agent",
      role: "Writes memory",
      platform: "codex",
      protocol: "rest",
      issueApiKey: true,
    });

    const res = await POST(
      new Request("http://localhost/api/memory/add", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ content: "batch32 classification bypass", type: "episodic" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(console.warn).toHaveBeenCalledWith(
      "Could not run classification before indexing:",
      expect.any(Error),
    );
  });
});
