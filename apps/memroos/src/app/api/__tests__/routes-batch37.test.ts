// @vitest-environment node
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const authorizeRegistryWrite = vi.hoisted(() => vi.fn(() => true));
const authenticateAgentHeaders = vi.hoisted(() => vi.fn());
const acknowledgeAgentContextMessage = vi.hoisted(() => vi.fn());
const updateDocumentDirectoryEntry = vi.hoisted(() => vi.fn());
const deleteDocumentDirectoryEntry = vi.hoisted(() => vi.fn());
const postOrchestrationTask = vi.hoisted(() => vi.fn());
const resolveOrchestrationHil = vi.hoisted(() => vi.fn());
const executeOrchestrationPlan = vi.hoisted(() => vi.fn());
const resumeOrchestrationRun = vi.hoisted(() => vi.fn());
const rollbackOrchestrationRun = vi.hoisted(() => vi.fn());
const listRegisteredAgents = vi.hoisted(() => vi.fn(() => []));
const runBoundedDiscussCouncil = vi.hoisted(() => vi.fn());
const getRemoteAgents = vi.hoisted(() => vi.fn(() => []));

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: (...args: unknown[]) => authorizeRegistryWrite(...args),
  registryWriteUnauthorizedResponse: () =>
    Response.json({ ok: false, error: "unauthorized" }, { status: 401 }),
}));

vi.mock("@/lib/agent-registry", () => ({
  authenticateAgentHeaders: (...args: unknown[]) => authenticateAgentHeaders(...args),
  listRegisteredAgents: (...args: unknown[]) => listRegisteredAgents(...args),
  getRemoteAgents: (...args: unknown[]) => getRemoteAgents(...args),
  getRegisteredAgent: vi.fn(),
  updateAgentDetails: vi.fn(),
  deregisterAgent: vi.fn(),
}));

vi.mock("@/lib/write-rules", () => ({
  updateDocumentDirectoryEntry: (...args: unknown[]) => updateDocumentDirectoryEntry(...args),
  deleteDocumentDirectoryEntry: (...args: unknown[]) => deleteDocumentDirectoryEntry(...args),
}));

vi.mock("@/lib/agent-context-bus", () => ({
  acknowledgeAgentContextMessage: (...args: unknown[]) => acknowledgeAgentContextMessage(...args),
}));

vi.mock("@/lib/audit", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("@/lib/orchestration/client", () => ({
  postOrchestrationTask: (...args: unknown[]) => postOrchestrationTask(...args),
  resolveOrchestrationHil: (...args: unknown[]) => resolveOrchestrationHil(...args),
  executeOrchestrationPlan: (...args: unknown[]) => executeOrchestrationPlan(...args),
  resumeOrchestrationRun: (...args: unknown[]) => resumeOrchestrationRun(...args),
  rollbackOrchestrationRun: (...args: unknown[]) => rollbackOrchestrationRun(...args),
  registeredAgentToOrchestrationAgent: (agent: { id: string }) => agent,
}));

vi.mock("@/lib/gsd/discuss", () => ({
  runBoundedDiscussCouncil: (...args: unknown[]) => runBoundedDiscussCouncil(...args),
}));

vi.mock("@/app/api/chat/chat-runtime", () => ({
  buildAgentContext: vi.fn(async () => ({
    systemPrompt: "x",
    source: "test",
    dir: null,
    agentInstructions: null,
  })),
  chatRuntimeStatus: vi.fn(() => ({ status: "ready", detail: "ready" })),
  resolveChatRuntimePlan: vi.fn(async () => ({
    primary: { runner: "anthropic", model: "claude-test", source: "env", detail: "env" },
    candidates: [],
  })),
}));

vi.mock("@/lib/dispatch/adapter-factory", () => ({
  selectAdapter: vi.fn(() => ({ name: "a2a", platform: ["codex"], dispatch: vi.fn() })),
}));

const LOOPBACK = "http://localhost";

function badJsonRequest(path: string, method = "POST"): Request {
  return new Request(`${LOOPBACK}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: `{not-json-b37-${randomUUID().slice(0, 6)}`,
  });
}

beforeEach(() => {
  authorizeRegistryWrite.mockReturnValue(true);
  const agentId = `agent-b37-${randomUUID().slice(0, 6)}`;
  authenticateAgentHeaders.mockReturnValue({ id: agentId, tenantId: "default-tenant" });
  acknowledgeAgentContextMessage.mockReturnValue({
    id: "msg-b37",
    toAgent: agentId,
    threadId: "thread-b37",
  });
  listRegisteredAgents.mockReturnValue([]);
  getRemoteAgents.mockReturnValue([]);
  runBoundedDiscussCouncil.mockReturnValue({
    blockedReasons: [],
    verdict: { validatorPass: true },
  });
  vi.resetModules();
});

describe("api routes batch37 — json().catch handlers", () => {
  it("PATCH /api/document-directory/[id] tolerates invalid JSON (12)", async () => {
    const { PATCH } = await import("../document-directory/[id]/route");
    const res = await PATCH(badJsonRequest("/api/document-directory/1", "PATCH") as never, {
      params: Promise.resolve({ id: "1" }),
    });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "expectedVersion is required" });
  });

  it("DELETE /api/document-directory/[id] tolerates invalid JSON (45)", async () => {
    const { DELETE } = await import("../document-directory/[id]/route");
    const res = await DELETE(badJsonRequest("/api/document-directory/2", "DELETE") as never, {
      params: Promise.resolve({ id: "2" }),
    });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "expectedVersion is required" });
  });

  it("POST /api/shared-space tolerates invalid JSON (30)", async () => {
    const { POST } = await import("../shared-space/route");
    const res = await POST(badJsonRequest("/api/shared-space") as never);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "spaceId is required" });
  });

  it("POST /api/a2a/agents/register tolerates invalid JSON (22)", async () => {
    const { POST } = await import("../a2a/agents/register/route");
    const res = await POST(badJsonRequest("/api/a2a/agents/register"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: "INVALID_BODY" });
  });

  it("POST /api/agent-context/messages/[id]/ack tolerates invalid JSON (11)", async () => {
    const { POST } = await import("../agent-context/messages/[id]/ack/route");
    const res = await POST(badJsonRequest("/api/agent-context/messages/m1/ack") as never, {
      params: Promise.resolve({ id: "m1" }),
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });
  });

  it("POST /api/evals/config tolerates invalid JSON (53)", async () => {
    const { POST } = await import("../evals/config/route");
    const res = await POST(badJsonRequest("/api/evals/config") as never);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/active_preset/i) });
  });

  it("POST /api/orchestration tolerates invalid JSON (19)", async () => {
    const { POST } = await import("../orchestration/route");
    const res = await POST(badJsonRequest("/api/orchestration"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "taskSummary is required" });
  });

  it("POST /api/orchestration/hil/[id] tolerates invalid JSON (20)", async () => {
    const { POST } = await import("../orchestration/hil/[id]/route");
    const res = await POST(badJsonRequest("/api/orchestration/hil/hil-b37"), {
      params: Promise.resolve({ id: "hil-b37" }),
    });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/decision must be approve or reject/i) });
  });

  it("POST /api/orchestration/plans/execute tolerates invalid JSON (11)", async () => {
    const { POST } = await import("../orchestration/plans/execute/route");
    const res = await POST(badJsonRequest("/api/orchestration/plans/execute"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "JSON object body is required" });
  });

  it("POST /api/orchestration/runs/[id]/resume tolerates invalid JSON (16)", async () => {
    const { POST } = await import("../orchestration/runs/[id]/resume/route");
    const res = await POST(badJsonRequest("/api/orchestration/runs/run-b37/resume"), {
      params: Promise.resolve({ id: "run-b37" }),
    });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "JSON object body is required" });
  });

  it("POST /api/orchestration/runs/[id]/rollback tolerates invalid JSON (16)", async () => {
    const { POST } = await import("../orchestration/runs/[id]/rollback/route");
    const res = await POST(badJsonRequest("/api/orchestration/runs/run-b37/rollback"), {
      params: Promise.resolve({ id: "run-b37" }),
    });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "JSON object body is required" });
  });

  it("POST /api/agents/proposals tolerates invalid JSON (58)", async () => {
    const { POST } = await import("../agents/proposals/route");
    const res = await POST(badJsonRequest("/api/agents/proposals") as never);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/reflect/i) });
  });

  it("POST /api/engagement/test tolerates invalid JSON (125)", async () => {
    listRegisteredAgents.mockReturnValue([]);
    const { POST } = await import("../engagement/test/route");
    const res = await POST(badJsonRequest("/api/engagement/test") as never);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, results: [] });
  });

  it("POST /api/gsd/discuss tolerates invalid JSON (11)", async () => {
    authenticateAgentHeaders.mockReturnValueOnce(null);
    const { POST } = await import("../gsd/discuss/route");
    const res = await POST(badJsonRequest("/api/gsd/discuss") as never);
    expect(res.status).toBe(401);
  });
});