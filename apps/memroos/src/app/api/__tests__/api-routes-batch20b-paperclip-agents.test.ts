// @vitest-environment node
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const mockAuthorizeRegistryWrite = vi.fn();
const mockClassifyLiveness = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/operator-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/operator-auth")>();
  return {
    ...actual,
    authorizeRegistryWrite: (...args: unknown[]) => mockAuthorizeRegistryWrite(...args),
  };
});

vi.mock("@/lib/agent-liveness", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent-liveness")>();
  return {
    ...actual,
    classifyLiveness: (...args: unknown[]) => mockClassifyLiveness(...args),
  };
});

const LOOPBACK = "http://localhost";
const SIGNING_KEY = path.join(process.cwd(), "data", "skill-signing-key.json");

function jsonBody(url: string, body: unknown, method = "POST"): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function asReq(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as unknown as NextRequest;
}

beforeEach(() => {
  mockAuthorizeRegistryWrite.mockReset();
  mockClassifyLiveness.mockReset();
  mockAuthorizeRegistryWrite.mockReturnValue(true);
  delete process.env.PAPERCLIP_BASE_URL;
  vi.resetModules();
  vi.unstubAllGlobals();
});

afterEach(() => {
  if (existsSync(SIGNING_KEY)) unlinkSync(SIGNING_KEY);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("api routes batch20b — paperclip sticky branches", () => {
  it("GET /api/paperclip tolerates upstream abort and bad checkpoint JSON", async () => {
    process.env.PAPERCLIP_BASE_URL = "http://localhost:9199";
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((_resolve, reject) => {
            setTimeout(() => {
              const err = new Error("Aborted");
              err.name = "AbortError";
              reject(err);
            }, 5100);
          }),
      ),
    );

    testDb
      .prepare(
        `INSERT INTO hive_delegations(task_id, from_agent, to_agent, task_summary, priority, status, checkpoint, updated_at)
         VALUES (?, 'op', 'paperclip', 'bad checkpoint', 2, 'paused', '{not-json', datetime('now'))`,
      )
      .run(`task-${randomUUID().slice(0, 8)}`);

    const { GET } = await import("../paperclip/route");
    const pending = GET();
    await vi.advanceTimersByTimeAsync(5100);
    const res = await pending;
    const body = await res.json();
    expect(body.summary.fleetStatus).toBe("offline");
    expect(body.operations.some((row: { summary: string }) => row.summary === "bad checkpoint")).toBe(
      true,
    );
  });

  it("POST /api/paperclip validates taskSummary and missing upstream env", async () => {
    const { POST } = await import("../paperclip/route");
    const missingSummary = await POST(
      jsonBody(`${LOOPBACK}/api/paperclip`, { requestedBy: "operator" }) as NextRequest,
    );
    expect(missingSummary.status).toBe(400);
    expect((await missingSummary.json()).error).toMatch(/taskSummary/i);

    process.env.PAPERCLIP_BASE_URL = "http://localhost:9199";
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((_resolve, reject) => {
            setTimeout(() => {
              const err = new Error("Aborted");
              err.name = "AbortError";
              reject(err);
            }, 10_100);
          }),
      ),
    );
    const pending = POST(
      jsonBody(`${LOOPBACK}/api/paperclip`, {
        taskSummary: "Dispatch with timeout",
        requestedBy: "operator",
      }) as NextRequest,
    );
    await vi.advanceTimersByTimeAsync(10_100);
    const aborted = await pending;
    expect(aborted.status).toBe(502);
    expect((await aborted.json()).error).toMatch(/Aborted|unreachable/i);

    delete process.env.PAPERCLIP_BASE_URL;
    vi.resetModules();
    const { POST: postNoEnv } = await import("../paperclip/route");
    const unconfigured = await postNoEnv(
      jsonBody(`${LOOPBACK}/api/paperclip`, {
        taskSummary: "Need config",
        requestedBy: "operator",
      }) as NextRequest,
    );
    expect(unconfigured.status).toBe(503);
  });
});

describe("api routes batch20b — agents/[id] liveness and registry auth", () => {
  it("maps stale, error, and empty liveness envelopes on GET", async () => {
    const agentId = `agent-b20b-${randomUUID().slice(0, 8)}`;
    testDb
      .prepare(
        `INSERT INTO registered_agents(id, name, role, platform, protocol, status, created_at, updated_at)
         VALUES (?, 'Batch20b', 'test', 'codex', 'rest', 'idle', datetime('now'), datetime('now'))`,
      )
      .run(agentId);

    mockClassifyLiveness.mockReturnValueOnce({
      state: "stale",
      observedAt: "2026-02-01T00:00:00.000Z",
      freshnessMs: 120_000,
      source: "sqlite://registered_agents.last_heartbeat_at",
      reason: "heartbeat stale",
    });
    const { GET } = await import("../agents/[id]/route");
    const staleRes = await GET(asReq(`${LOOPBACK}/api/agents/${agentId}`), {
      params: Promise.resolve({ id: agentId }),
    } as never);
    expect((await staleRes.json()).liveness.heartbeat.status).toBe("stale");

    mockClassifyLiveness.mockReturnValueOnce({
      state: "error",
      observedAt: "2026-02-01T00:00:00.000Z",
      freshnessMs: null,
      source: "sqlite://registered_agents.last_heartbeat_at",
      reason: "parse failure",
    });
    const errorRes = await GET(asReq(`${LOOPBACK}/api/agents/${agentId}`), {
      params: Promise.resolve({ id: agentId }),
    } as never);
    expect((await errorRes.json()).liveness.heartbeat.status).toBe("error");

    mockClassifyLiveness.mockReturnValueOnce({
      state: "never",
      observedAt: null,
      freshnessMs: null,
      source: "sqlite://registered_agents.last_heartbeat_at",
      reason: "never seen",
    });
    const emptyRes = await GET(asReq(`${LOOPBACK}/api/agents/${agentId}`), {
      params: Promise.resolve({ id: agentId }),
    } as never);
    expect((await emptyRes.json()).liveness.heartbeat.status).toBe("empty");
  });

  it("PATCH and DELETE enforce registry auth and validation edges", async () => {
    const agentId = `agent-b20b-${randomUUID().slice(0, 8)}`;
    testDb
      .prepare(
        `INSERT INTO registered_agents(id, name, role, platform, protocol, status, created_at, updated_at)
         VALUES (?, 'Before', 'test', 'codex', 'rest', 'idle', datetime('now'), datetime('now'))`,
      )
      .run(agentId);

    mockAuthorizeRegistryWrite.mockReturnValue(false);
    const { PATCH, DELETE } = await import("../agents/[id]/route");
    expect((await PATCH(asReq(`${LOOPBACK}/api/agents/${agentId}`), { params: Promise.resolve({ id: agentId }) } as never)).status).toBe(403);
    expect((await DELETE(asReq(`${LOOPBACK}/api/agents/${agentId}`), { params: Promise.resolve({ id: agentId }) } as never)).status).toBe(403);

    mockAuthorizeRegistryWrite.mockReturnValue(true);
    const badJson = await PATCH(
      new Request(`${LOOPBACK}/api/agents/${agentId}`, {
        method: "PATCH",
        body: "not-json",
      }),
      { params: Promise.resolve({ id: agentId }) } as never,
    );
    expect(badJson.status).toBe(400);

    const notObject = await PATCH(
      jsonBody(`${LOOPBACK}/api/agents/${agentId}`, null, "PATCH"),
      { params: Promise.resolve({ id: agentId }) } as never,
    );
    expect(notObject.status).toBe(400);
    expect((await notObject.json()).error).toMatch(/object/i);

    const badName = await PATCH(
      jsonBody(`${LOOPBACK}/api/agents/${agentId}`, { name: 42 }, "PATCH"),
      { params: Promise.resolve({ id: agentId }) } as never,
    );
    expect(badName.status).toBe(400);

    const missingId = `missing-${randomUUID()}`;
    const missing = await PATCH(
      jsonBody(`${LOOPBACK}/api/agents/${missingId}`, { name: "Nope" }, "PATCH"),
      { params: Promise.resolve({ id: missingId }) } as never,
    );
    expect(missing.status).toBe(404);

    const deleted = await DELETE(asReq(`${LOOPBACK}/api/agents/${agentId}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: agentId }),
    } as never);
    expect(deleted.status).toBe(200);
    expect((await deleted.json()).agent.deregisteredAt).toBeTruthy();
  });
});
