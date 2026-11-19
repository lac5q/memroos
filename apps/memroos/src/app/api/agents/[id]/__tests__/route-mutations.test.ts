// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DB_DIR = path.join(os.tmpdir(), `agents-id-mut-${crypto.randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "agent-mut.db");

async function loadRoutes() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  process.env.MEMROOS_OPERATOR_API_KEY = "operator-secret";
  vi.resetModules();
  const registerRoute = await import("../../register/route");
  const agentRoute = await import("../route");
  const dbModule = await import("@/lib/db");
  return { registerRoute, agentRoute, closeDb: dbModule.closeDb };
}

describe("PATCH/DELETE /api/agents/[id]", () => {
  beforeEach(() => {
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  });

  afterEach(async () => {
    const { closeDb } = await loadRoutes();
    closeDb();
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    delete process.env.SQLITE_DB_PATH;
    delete process.env.MEMROOS_OPERATOR_API_KEY;
  });

  async function seedAgent(registerRoute: { POST: (req: Request) => Promise<Response> }, id: string) {
    const res = await registerRoute.POST(
      new Request("http://localhost/api/agents/register", {
        method: "POST",
        body: JSON.stringify({
          id,
          name: `Agent ${id}`,
          role: "Test",
          platform: "codex",
          protocol: "rest",
          issueApiKey: false,
        }),
      })
    );
    expect(res.status).toBe(200);
  }

  it("PATCH requires operator authorization on non-loopback hosts", async () => {
    const { agentRoute } = await loadRoutes();
    const res = await agentRoute.PATCH(
      new Request("https://memroos.example.test/api/agents/x", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "New" }),
      }),
      { params: Promise.resolve({ id: "x" }) }
    );
    expect(res.status).toBe(403);
  });

  it("PATCH validates JSON and field types", async () => {
    const { registerRoute, agentRoute } = await loadRoutes();
    await seedAgent(registerRoute, "patch-target");

    const invalidJson = await agentRoute.PATCH(
      new Request("http://localhost/api/agents/patch-target", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-memroos-operator-key": "operator-secret",
        },
        body: "not-json",
      }),
      { params: Promise.resolve({ id: "patch-target" }) }
    );
    expect(invalidJson.status).toBe(400);

    const badType = await agentRoute.PATCH(
      new Request("http://localhost/api/agents/patch-target", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-memroos-operator-key": "operator-secret",
        },
        body: JSON.stringify({ name: 123 }),
      }),
      { params: Promise.resolve({ id: "patch-target" }) }
    );
    expect(badType.status).toBe(400);
    expect(await badType.json()).toMatchObject({ error: "name must be a string" });
  });

  it("PATCH updates display fields for a registered agent", async () => {
    const { registerRoute, agentRoute } = await loadRoutes();
    await seedAgent(registerRoute, "patch-ok");

    const res = await agentRoute.PATCH(
      new Request("http://localhost/api/agents/patch-ok", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-memroos-operator-key": "operator-secret",
        },
        body: JSON.stringify({ name: "Renamed", role: "Updated role", company: null }),
      }),
      { params: Promise.resolve({ id: "patch-ok" }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.agent).toMatchObject({ id: "patch-ok", name: "Renamed", role: "Updated role" });
  });

  it("DELETE deregisters an agent with operator authorization", async () => {
    const { registerRoute, agentRoute } = await loadRoutes();
    await seedAgent(registerRoute, "delete-me");

    const del = await agentRoute.DELETE(
      new Request("http://localhost/api/agents/delete-me", {
        method: "DELETE",
        headers: { "x-memroos-operator-key": "operator-secret" },
      }),
      { params: Promise.resolve({ id: "delete-me" }) }
    );
    expect(del.status).toBe(200);

    const get = await agentRoute.GET(
      new Request("http://localhost/api/agents/delete-me") as never,
      { params: Promise.resolve({ id: "delete-me" }) }
    );
    expect(get.status).toBe(404);
  });

  it("DELETE returns 404 for unknown agents", async () => {
    const { agentRoute } = await loadRoutes();
    const res = await agentRoute.DELETE(
      new Request("http://localhost/api/agents/missing", {
        method: "DELETE",
        headers: { "x-memroos-operator-key": "operator-secret" },
      }),
      { params: Promise.resolve({ id: "missing" }) }
    );
    expect(res.status).toBe(404);
  });
});
