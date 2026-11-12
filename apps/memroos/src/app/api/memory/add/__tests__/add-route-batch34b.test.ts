// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DB_DIR = path.join(os.tmpdir(), `memory-add-b34b-${randomUUID()}`);

async function loadRoute() {
  process.env.SQLITE_DB_PATH = path.join(TEST_DB_DIR, "routes.db");
  process.env.MEM0_URL = "http://mem0.test";
  vi.resetModules();
  const registry = await import("@/lib/agent-registry");
  const route = await import("../route");
  const dbModule = await import("@/lib/db");
  return { ...registry, ...route, closeDb: dbModule.closeDb };
}

describe("POST /api/memory/add batch34b", () => {
  beforeEach(() => {
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: true, id: "mem-b34b" }, { status: 200 })),
    );
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
    delete process.env.MEMROOS_MEMORY_WRITE_TIMEOUT_MS;
  });

  it("falls back to default timeout when env is not a positive integer", async () => {
    process.env.MEMROOS_MEMORY_WRITE_TIMEOUT_MS = "not-a-number";
    const { memoryWriteTimeoutMs } = await loadRoute();
    expect(memoryWriteTimeoutMs()).toBe(30_000);
  });

  it("denies graph writes for episodic-only agents using body.text", async () => {
    const { POST, registerAgent } = await loadRoute();
    const { apiKey } = registerAgent({
      id: `mem-b34b-${randomUUID().slice(0, 6)}`,
      name: "Text Field Agent",
      role: "Writes memory",
      platform: "codex",
      protocol: "rest",
      capabilities: [{ id: "memory:write:episodic", name: "Episodic", description: "", tags: [] }],
      issueApiKey: true,
    });

    const denied = await POST(
      new Request("http://localhost/api/memory/add", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ text: "from text field", type: "graph" }),
      }),
    );
    expect(denied.status).toBe(403);
    const deniedJson = await denied.json();
    expect(deniedJson.code).toBe("POLICY_DENIED");
    expect(deniedJson.detail).toEqual({ code: "MISSING_CAPABILITY" });
  });

  it("rejects memory when classification requires human review", async () => {
    const loaded = await loadRoute();
    const cascade = await import("@/lib/classification/cascade");
    vi.spyOn(cascade, "classifyText").mockReturnValue({
      requiresReview: true,
      label: "restricted",
      reasons: ["human review"],
    } as ReturnType<typeof cascade.classifyText>);
    const { POST, registerAgent } = loaded;
    const { apiKey } = registerAgent({
      id: `mem-cls-b34b-${randomUUID().slice(0, 6)}`,
      name: "Classify Agent",
      role: "Writes memory",
      platform: "codex",
      protocol: "rest",
      issueApiKey: true,
    });
    const classified = await POST(
      new Request("http://localhost/api/memory/add", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ content: "needs review", type: "episodic", metadata: { lane: "b34b" } }),
      }),
    );
    expect(classified.status).toBe(403);
    expect((await classified.json()).code).toBe("CLASSIFICATION_DENIED");
  });

  it("records writes using forwarded content when mem0 accepts the payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const forwarded = JSON.parse(String(init?.body));
        return Response.json({ ok: true, mirrored: forwarded.text }, { status: 200 });
      }),
    );
    const { POST, registerAgent } = await loadRoute();
    const dbModule = await import("@/lib/db");
    const { apiKey } = registerAgent({
      id: `mem-ok-b34b-${randomUUID().slice(0, 6)}`,
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
        body: JSON.stringify({ text: "persist via text key", type: "episodic" }),
      }),
    );
    expect(res.status).toBe(200);
    const rows = dbModule.getDb().prepare("SELECT memory_type FROM agent_memory_writes").all();
    expect(rows).toHaveLength(1);
  });
});
