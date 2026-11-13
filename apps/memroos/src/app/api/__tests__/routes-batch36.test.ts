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
const validateOrchestrationPlan = vi.hoisted(() => vi.fn());
const runWikiDigest = vi.hoisted(() => vi.fn());
const pollAllAdapters = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: (...args: unknown[]) => authorizeRegistryWrite(...args),
  registryWriteUnauthorizedResponse: () => Response.json({ ok: false, error: "unauthorized" }, { status: 401 }),
}));

vi.mock("@/lib/agent-registry", () => ({
  authenticateAgentHeaders: (...args: unknown[]) => authenticateAgentHeaders(...args),
  recordHeartbeat: vi.fn(() => ({ id: "agent-b36" })),
}));

vi.mock("@/lib/orchestration/client", () => ({
  validateOrchestrationPlan: (...args: unknown[]) => validateOrchestrationPlan(...args),
}));

vi.mock("@/lib/wiki-digest", () => ({
  WIKI_DIGEST_CRON_ID: "wiki-digest",
  runWikiDigest: (...args: unknown[]) => runWikiDigest(...args),
}));

vi.mock("@/lib/cron-health", () => ({
  ensureDefaultCronJobs: vi.fn(),
  isCronJobRunnable: vi.fn(() => true),
  recordCronHealthRun: vi.fn(),
  listCronHealthJobs: vi.fn(() => [{ id: "wiki-digest", status: "running" }]),
}));

vi.mock("@/lib/l3/poller", () => ({
  pollAllAdapters: (...args: unknown[]) => pollAllAdapters(...args),
}));

const LOOPBACK = "http://localhost";

function badJsonRequest(path: string, method = "POST"): Request {
  return new Request(`${LOOPBACK}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: "{not-json-b36",
  });
}

beforeEach(() => {
  authorizeRegistryWrite.mockReturnValue(true);
  authenticateAgentHeaders.mockReturnValue({ id: "agent-b36", tenantId: "default-tenant" });
  validateOrchestrationPlan.mockResolvedValue({ ok: true, status: "plan_valid" });
  runWikiDigest.mockResolvedValue({
    status: "completed",
    written: 0,
    considered: 0,
    errors: 0,
    dryRun: false,
  });
  pollAllAdapters.mockResolvedValue({ results: [], errors: [] });
  vi.resetModules();
});

describe("api routes batch36 — json().catch handlers", () => {
  it("POST /api/wiki/digest tolerates invalid JSON body (33)", async () => {
    const { POST } = await import("../wiki/digest/route");
    const res = await POST(badJsonRequest("/api/wiki/digest"));
    expect(res.status).toBe(200);
    expect(runWikiDigest).toHaveBeenCalled();
  });

  it("POST /api/heartbeat tolerates invalid JSON (31)", async () => {
    const { POST } = await import("../heartbeat/route");
    const res = await POST(badJsonRequest("/api/heartbeat"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });
  });

  it("POST /api/write-rules/resolve tolerates invalid JSON (10)", async () => {
    const { POST } = await import("../write-rules/resolve/route");
    const res = await POST(badJsonRequest("/api/write-rules/resolve") as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/spaceId and dataType/);
  });

  it("PATCH /api/write-rules/[id] tolerates invalid JSON (12)", async () => {
    const { PATCH } = await import("../write-rules/[id]/route");
    const res = await PATCH(badJsonRequest("/api/write-rules/1", "PATCH") as never, {
      params: Promise.resolve({ id: "1" }),
    });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/expectedVersion/i) });
  });

  it("POST /api/space-cache/invalidate tolerates invalid JSON (10)", async () => {
    const { POST } = await import("../space-cache/invalidate/route");
    const res = await POST(badJsonRequest("/api/space-cache/invalidate") as never);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "spaceId is required" });
  });

  it("POST /api/orchestration/plans/validate tolerates invalid JSON (11)", async () => {
    const { POST } = await import("../orchestration/plans/validate/route");
    const res = await POST(badJsonRequest("/api/orchestration/plans/validate"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/JSON object body/i) });
  });

  it("POST /api/model-routing/telemetry tolerates invalid JSON (36)", async () => {
    const { POST } = await import("../model-routing/telemetry/route");
    const res = await POST(badJsonRequest("/api/model-routing/telemetry") as never);
    expect(res.status).toBe(400);
  });

  it("POST /api/model-routing/recommendations tolerates invalid JSON (41)", async () => {
    const { POST } = await import("../model-routing/recommendations/route");
    const res = await POST(badJsonRequest("/api/model-routing/recommendations") as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recommendations).toBeDefined();
  });

  it("POST /api/memory/policy-lab tolerates invalid JSON (26)", async () => {
    const { POST } = await import("../memory/policy-lab/route");
    const res = await POST(badJsonRequest("/api/memory/policy-lab") as never);
    expect(res.status).toBe(400);
  });

  it("POST /api/l3/poll tolerates invalid JSON (33)", async () => {
    const { POST } = await import("../l3/poll/route");
    const res = await POST(badJsonRequest("/api/l3/poll") as never);
    expect(res.status).toBe(200);
  });

  it("POST /api/agent-context/messages rejects invalid JSON (62)", async () => {
    const { POST } = await import("../agent-context/messages/route");
    const res = await POST(badJsonRequest("/api/agent-context/messages") as never);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "Invalid agent context payload" });
  });
});
