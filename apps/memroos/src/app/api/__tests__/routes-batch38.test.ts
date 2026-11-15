// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const authorizeRegistryWrite = vi.hoisted(() => vi.fn(() => true));
const authenticateAgentHeaders = vi.hoisted(() => vi.fn());
const authenticateTenantRequest = vi.hoisted(() => vi.fn());
const mockAuthenticateUser = vi.hoisted(() => vi.fn());
const runGraphCatchup = vi.hoisted(() => vi.fn());

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
  registerAgent: vi.fn(() => ({ agent: { id: "agent-b38" }, apiKey: "key-b38" })),
  recordSkillReport: vi.fn(),
  recordToolOutcome: vi.fn(),
  listRegisteredAgents: vi.fn(() => []),
  getRemoteAgents: vi.fn(() => []),
}));

vi.mock("@/lib/public-api/auth", () => ({
  authenticateTenantRequest: (...args: unknown[]) => authenticateTenantRequest(...args),
}));

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => mockAuthenticateUser(...args),
}));

vi.mock("@/lib/tool-attention", () => ({
  appendToolAttentionOutcome: vi.fn(),
}));

vi.mock("@/lib/cron-health", () => ({
  ensureDefaultCronJobs: vi.fn(),
  isCronJobRunnable: vi.fn(() => true),
  recordCronHealthRun: vi.fn(),
}));

vi.mock("@/lib/memory/graph-catchup", () => ({
  GRAPH_CATCHUP_CRON_ID: "graph-catchup",
  runGraphCatchup: (...args: unknown[]) => runGraphCatchup(...args),
}));

const LOOPBACK = "http://localhost";

function badJsonRequest(path: string, method = "POST"): Request {
  return new Request(`${LOOPBACK}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: `{not-json-b38-${randomUUID().slice(0, 6)}`,
  });
}

beforeEach(() => {
  authorizeRegistryWrite.mockReturnValue(true);
  const agentId = `agent-b38-${randomUUID().slice(0, 6)}`;
  authenticateAgentHeaders.mockReturnValue({ id: agentId, tenantId: "default-tenant" });
  authenticateTenantRequest.mockReturnValue({ tenantId: "default-tenant", apiKeyId: "key-b38" });
  mockAuthenticateUser.mockResolvedValue({
    userId: `user-b38-${randomUUID().slice(0, 6)}`,
    tenantId: "default-tenant",
    role: "admin",
    email: "admin-b38@test.local",
  });
  runGraphCatchup.mockResolvedValue({
    status: "completed",
    considered: 0,
    projected: 0,
    errors: 0,
    dryRun: false,
  });
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api routes batch38 — json().catch handlers", () => {
  it("POST /api/cache/purge tolerates invalid JSON (8)", async () => {
    const { POST } = await import("../cache/purge/route");
    const res = await POST(badJsonRequest("/api/cache/purge") as never);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });
  });

  it("POST /api/finance-reconciliation tolerates invalid JSON (25)", async () => {
    const { POST } = await import("../finance-reconciliation/route");
    const res = await POST(badJsonRequest("/api/finance-reconciliation") as never);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "JSON body required" });
  });

  it("POST /api/public/v1/traces tolerates invalid JSON (78)", async () => {
    const { POST } = await import("../public/v1/traces/route");
    const res = await POST(badJsonRequest("/api/public/v1/traces") as never);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "Request body is required" });
  });

  it("POST /api/seal/proposals tolerates invalid JSON (32)", async () => {
    const { POST } = await import("../seal/proposals/route");
    const res = await POST(badJsonRequest("/api/seal/proposals") as never);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "traceId and runId are required" });
  });

  it("POST /api/seal/proposals/[id] tolerates invalid JSON (36)", async () => {
    const { POST } = await import("../seal/proposals/[id]/route");
    const res = await POST(badJsonRequest("/api/seal/proposals/p-b38") as never, {
      params: Promise.resolve({ id: "p-b38" }),
    });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "action must be approve, reject, or apply",
    });
  });

  it("POST /api/orchestration/federated/execute tolerates invalid JSON (40)", async () => {
    const { POST } = await import("../orchestration/federated/execute/route");
    const res = await POST(badJsonRequest("/api/orchestration/federated/execute"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ reason: "federation_bridge_input_invalid" });
  });

  it("PATCH /api/orchestration/hil/[id]/edit tolerates invalid JSON (21)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ ok: false, error: "validation" }, { status: 422 })
      )
    );
    const { PATCH } = await import("../orchestration/hil/[id]/edit/route");
    const res = await PATCH(badJsonRequest("/api/orchestration/hil/hil-b38/edit", "PATCH"), {
      params: Promise.resolve({ id: "hil-b38" }),
    });
    expect(res.status).toBe(422);
  });

  it("POST /api/onboarding/register tolerates invalid JSON (49)", async () => {
    const { POST } = await import("../onboarding/register/route");
    const res = await POST(badJsonRequest("/api/onboarding/register"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "Invalid onboarding registration body" });
  });

  it("POST /api/dispatch tolerates invalid JSON (156)", async () => {
    const { POST } = await import("../dispatch/route");
    const res = await POST(badJsonRequest("/api/dispatch"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_BODY");
  });

  it("POST /api/gsd/goal tolerates invalid JSON (10)", async () => {
    const { POST } = await import("../gsd/goal/route");
    const res = await POST(badJsonRequest("/api/gsd/goal") as never);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "goal title is required" });
  });

  it("PUT /api/admin/compliance tolerates invalid JSON (50)", async () => {
    const { PUT } = await import("../admin/compliance/route");
    const res = await PUT(badJsonRequest("/api/admin/compliance", "PUT") as never);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "JSON body required" });
  });

  it("POST /api/artifact-gate/prompt tolerates invalid JSON (10)", async () => {
    const { POST } = await import("../artifact-gate/prompt/route");
    const res = await POST(badJsonRequest("/api/artifact-gate/prompt") as never);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "spaceId, artifactName, and artifactType are required",
    });
  });

  it("POST /api/tool-attention/record tolerates invalid JSON (42)", async () => {
    const { POST } = await import("../tool-attention/record/route");
    const res = await POST(badJsonRequest("/api/tool-attention/record"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "toolId and outcome are required" });
  });

  it("POST /api/workspace tolerates invalid JSON (25)", async () => {
    const { POST } = await import("../workspace/route");
    const res = await POST(badJsonRequest("/api/workspace") as never);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "spaceId is required" });
  });

  it("POST /api/write-rules tolerates invalid JSON (30)", async () => {
    const { POST } = await import("../write-rules/route");
    const res = await POST(badJsonRequest("/api/write-rules") as never);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "spaceId is required" });
  });

  it("POST /api/l3/events tolerates invalid JSON (107)", async () => {
    const { POST } = await import("../l3/events/route");
    const res = await POST(badJsonRequest("/api/l3/events") as never);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringMatching(/correlationId/i),
    });
  });

  it("POST /api/agents/register tolerates invalid JSON (73)", async () => {
    const { POST } = await import("../agents/register/route");
    const res = await POST(badJsonRequest("/api/agents/register"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "Invalid registration body" });
  });

  it("POST /api/skills/report tolerates invalid JSON (153)", async () => {
    const { POST } = await import("../skills/report/route");
    const res = await POST(badJsonRequest("/api/skills/report"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "skillId and action are required" });
  });

  it("POST /api/memory/proposals tolerates invalid JSON (72)", async () => {
    const { POST } = await import("../memory/proposals/route");
    const res = await POST(badJsonRequest("/api/memory/proposals") as never);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "traceId and runId are required" });
  });

  it("POST /api/operations/telemetry tolerates invalid JSON (22)", async () => {
    const { POST } = await import("../operations/telemetry/route");
    const res = await POST(badJsonRequest("/api/operations/telemetry") as never);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "Invalid JSON body" });
  });

  it("POST /api/evals/run tolerates invalid JSON (26)", async () => {
    const { POST } = await import("../evals/run/route");
    const res = await POST(badJsonRequest("/api/evals/run") as never);
    expect(res.status).toBe(400);
  });

  it("POST /api/apo tolerates invalid JSON (512)", async () => {
    const { POST } = await import("../apo/route");
    const res = await POST(badJsonRequest("/api/apo"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "proposalId is required" });
  });

  it("POST /api/memory/add tolerates invalid JSON (28)", async () => {
    const { POST } = await import("../memory/add/route");
    const res = await POST(badJsonRequest("/api/memory/add"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "Invalid memory payload" });
  });

  it("POST /api/gsd/adapter tolerates invalid JSON (42)", async () => {
    const { POST } = await import("../gsd/adapter/route");
    const res = await POST(badJsonRequest("/api/gsd/adapter") as never);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "adapterId and action are required" });
  });

  it("POST /api/memory-lifecycle/graph-catchup tolerates invalid JSON (32)", async () => {
    const { POST } = await import("../memory-lifecycle/graph-catchup/route");
    const res = await POST(badJsonRequest("/api/memory-lifecycle/graph-catchup"));
    expect(res.status).toBe(200);
    expect(runGraphCatchup).toHaveBeenCalled();
  });
});