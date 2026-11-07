// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const mockAuthenticateUser = vi.fn();
const mockClassifyLiveness = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => mockAuthenticateUser(...args),
}));

vi.mock("@/lib/auth/middleware-roles", () => ({
  requireRole: () => null,
}));

vi.mock("@/lib/agent-liveness", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent-liveness")>();
  return {
    ...actual,
    classifyLiveness: (...args: unknown[]) => mockClassifyLiveness(...args),
  };
});

const LOOPBACK = "http://localhost";

function asReq(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as unknown as NextRequest;
}

function jsonBody(url: string, body: unknown, method = "POST"): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockAuthenticateUser.mockReset();
  mockClassifyLiveness.mockReset();
  mockAuthenticateUser.mockResolvedValue({
    userId: "op-b19c",
    role: "operator",
    email: "op@example.com",
    displayName: "Op",
    tenantId: "default-tenant",
  });
  delete process.env.PAPERCLIP_BASE_URL;
  vi.resetModules();
});

describe("api routes batch19c — paperclip dispatch and fleet", () => {
  it("POST /api/paperclip returns 503 when upstream is not configured", async () => {
    const { POST } = await import("../paperclip/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/paperclip`, {
        taskSummary: "Run fleet check",
        requestedBy: "operator",
      }) as NextRequest,
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/not configured/i);
  });

  it("POST /api/paperclip validates taskSummary and requestedBy", async () => {
    process.env.PAPERCLIP_BASE_URL = "http://paperclip-upstream.test";
    const { POST } = await import("../paperclip/route");
    const missingSummary = await POST(
      jsonBody(`${LOOPBACK}/api/paperclip`, { requestedBy: "op" }) as NextRequest,
    );
    expect(missingSummary.status).toBe(400);

    const missingRequester = await POST(
      jsonBody(`${LOOPBACK}/api/paperclip`, { taskSummary: "  " }) as NextRequest,
    );
    expect(missingRequester.status).toBe(400);
  });

  it("POST /api/paperclip forwards dispatch and writes hive delegation rows", async () => {
    process.env.PAPERCLIP_BASE_URL = "http://paperclip-upstream.test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    const { POST } = await import("../paperclip/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/paperclip`, {
        taskSummary: "Batch19c dispatch",
        requestedBy: "codex-cli-agent",
        sessionId: `sess-${randomUUID().slice(0, 8)}`,
      }) as NextRequest,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.taskId).toBeTruthy();
    const row = testDb
      .prepare(`SELECT task_summary FROM hive_delegations WHERE task_id = ?`)
      .get(body.taskId) as { task_summary: string };
    expect(row.task_summary).toBe("Batch19c dispatch");
    vi.unstubAllGlobals();
  });

  it("GET /api/paperclip tolerates upstream fetch failures and malformed checkpoints", async () => {
    process.env.PAPERCLIP_BASE_URL = "http://paperclip-upstream.test";
    testDb
      .prepare(
        `INSERT INTO hive_delegations(task_id, from_agent, to_agent, task_summary, priority, status, checkpoint, updated_at)
         VALUES (?, 'op', 'paperclip', 'bad checkpoint', 5, 'paused', '{not-json', datetime('now'))`,
      )
      .run(`task-${randomUUID().slice(0, 8)}`);

    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("network down"))));
    const { GET } = await import("../paperclip/route");
    const body = await (await GET()).json();
    expect(body.summary.fleetStatus).toBe("offline");
    expect(body.operations[0]?.completedSteps).toEqual([]);
    vi.unstubAllGlobals();
  });

  it("GET /api/paperclip normalizes continuous and autonomous autonomy modes", async () => {
    process.env.PAPERCLIP_BASE_URL = "http://paperclip-upstream.test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            agents: [
              { id: "a1", name: "Auto", status: "active", autonomyMode: "autonomous" },
              { id: "a2", name: "Loop", status: "dormant", autonomyMode: "continuous" },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const { GET } = await import("../paperclip/route");
    const body = await (await GET()).json();
    expect(body.summary.fleetStatus).toBe("active");
    expect(body.agents.find((a: { id: string }) => a.id === "a1")?.autonomyMode).toBe("Autonomous");
    expect(body.agents.find((a: { id: string }) => a.id === "a2")?.autonomyMode).toBe("Continuous");
    vi.unstubAllGlobals();
  });
});

describe("api routes batch19c — chat and escalations resolve", () => {
  it("POST /api/chat returns memory doctor SSE for /memory-doctor command", async () => {
    const { POST } = await import("../chat/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/chat`, { message: "/doctor memory", agentId: "ceo" }) as NextRequest,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("data:");
  });

  it("POST /api/chat rejects blank messages", async () => {
    const { POST } = await import("../chat/route");
    const res = await POST(jsonBody(`${LOOPBACK}/api/chat`, { message: "   " }) as NextRequest);
    expect(res.status).toBe(400);
  });

  it("POST /api/escalations/:id/resolve returns 500 when auth throws unexpectedly", async () => {
    mockAuthenticateUser.mockRejectedValue(new Error("auth subsystem offline"));
    const id = `esc-${randomUUID().slice(0, 8)}`;
    const { POST } = await import("../escalations/[id]/resolve/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/escalations/${id}/resolve`, { method: "POST" }) as NextRequest,
      { params: Promise.resolve({ id }) } as never,
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("auth subsystem offline");
  });

  it("GET /api/recall supports hybrid mode envelope", async () => {
    testDb
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES (?, 'default', 'agent-hybrid', 'user', 'batch19c hybrid recall marker', datetime('now'), 'public_approved', 'indexable')`,
      )
      .run(`sess-${randomUUID().slice(0, 8)}`);

    const { GET } = await import("../recall/route");
    const res = await GET(asReq(`${LOOPBACK}/api/recall?q=hybrid+recall&mode=hybrid&limit=5`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("hybrid");
    expect(Array.isArray(body.results)).toBe(true);
  });
});
