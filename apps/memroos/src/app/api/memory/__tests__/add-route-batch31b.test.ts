// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";


const TEST_DB_DIR = path.join(os.tmpdir(), `memory-add-b31b-${randomUUID()}`);

async function loadRoute() {
  process.env.SQLITE_DB_PATH = path.join(TEST_DB_DIR, "routes.db");
  process.env.MEM0_URL = "http://mem0.test";
  vi.resetModules();
  const registry = await import("@/lib/agent-registry");
  const route = await import("../add/route");
  const dbModule = await import("@/lib/db");
  return { ...registry, ...route, closeDb: dbModule.closeDb };
}

describe("POST /api/memory/add batch31b", () => {
  beforeEach(() => {
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  });

  afterEach(async () => {
    const { closeDb } = await loadRoute();
    closeDb();
    vi.unstubAllGlobals();
    vi.resetModules();
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    delete process.env.SQLITE_DB_PATH;
    delete process.env.MEM0_URL;
  });

  it("treats non-JSON mem0 responses as empty objects (line 108)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not-json", { status: 200, headers: { "content-type": "text/plain" } })),
    );

    const { POST, registerAgent } = await loadRoute();
    const { apiKey } = registerAgent({
      id: "memory-agent-json-b31b",
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
        body: JSON.stringify({ content: "batch31b plain mem0 body", type: "episodic" }),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.result).toEqual({});
  });
});
