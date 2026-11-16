// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const authorizeRegistryWrite = vi.hoisted(() => vi.fn(() => true));
const authenticateAgentHeaders = vi.hoisted(() => vi.fn());
const mockAuthenticateUser = vi.hoisted(() => vi.fn());
const mockRequireRole = vi.hoisted(() => vi.fn(() => null as Response | null));
const updateSkillReviewState = vi.hoisted(() => vi.fn());
const replyToAgentContextMessage = vi.hoisted(() => vi.fn());
const createDocumentDirectoryEntry = vi.hoisted(() => vi.fn());
const runGsdLaneEvalSuite = vi.hoisted(() => vi.fn());

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
  recordMemoryWrite: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => mockAuthenticateUser(...args),
}));

vi.mock("@/lib/auth/middleware-roles", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/middleware-roles")>();
  return {
    ...actual,
    requireRole: (...args: unknown[]) => mockRequireRole(...args),
  };
});

vi.mock("@/lib/skill-workflow", () => ({
  updateSkillReviewState: (...args: unknown[]) => updateSkillReviewState(...args),
}));

vi.mock("@/lib/agent-context-bus", () => ({
  replyToAgentContextMessage: (...args: unknown[]) => replyToAgentContextMessage(...args),
}));

vi.mock("@/lib/write-rules", () => ({
  createDocumentDirectoryEntry: (...args: unknown[]) => createDocumentDirectoryEntry(...args),
  getDocumentDirectory: vi.fn(() => []),
}));

vi.mock("@/lib/gsd/lane-evals", () => ({
  runGsdLaneEvalSuite: (...args: unknown[]) => runGsdLaneEvalSuite(...args),
}));

vi.mock("@/lib/agent-gsd-control", () => ({
  gsdInputFromJson: (v: unknown) => (v && typeof v === "object" ? v : {}),
}));

vi.mock("@/lib/audit", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("@/lib/content-scanner", () => ({
  scanContent: vi.fn(() => ({ blocked: false, findings: [] })),
}));

vi.mock("@/lib/agent-context-policy", () => ({
  findSelfDeclaredAccessClaims: vi.fn(() => []),
}));

const LOOPBACK = "http://localhost";

function badJsonRequest(path: string, method = "POST"): Request {
  return new Request(`${LOOPBACK}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: `{not-json-b39-${randomUUID().slice(0, 6)}`,
  });
}

beforeEach(() => {
  authorizeRegistryWrite.mockReturnValue(true);
  const agentId = `agent-b39-${randomUUID().slice(0, 6)}`;
  authenticateAgentHeaders.mockReturnValue({ id: agentId, tenantId: "default-tenant" });
  mockAuthenticateUser.mockResolvedValue({
    userId: `user-b39-${randomUUID().slice(0, 6)}`,
    tenantId: "default-tenant",
    role: "admin",
    email: "admin-b39@test.local",
  });
  mockRequireRole.mockReturnValue(null);
  updateSkillReviewState.mockResolvedValue({ status: "draft" });
  runGsdLaneEvalSuite.mockReturnValue({
    totalCases: 0,
    passedCases: 0,
    failedCases: 0,
    results: [],
  });
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api routes batch39 — json().catch handlers (not in batch36–38)", () => {
  it("POST /api/skills/review tolerates invalid JSON after auth (26)", async () => {
    const { POST } = await import("../skills/review/route");
    const res = await POST(badJsonRequest("/api/skills/review") as unknown as NextRequest);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "skillName and action are required",
    });
    expect(mockAuthenticateUser).toHaveBeenCalled();
    expect(mockRequireRole).toHaveBeenCalledWith("admin", "operator");
    expect(updateSkillReviewState).not.toHaveBeenCalled();
  });

  it("PUT /api/evals/config tolerates invalid JSON (29)", async () => {
    const { PUT } = await import("../evals/config/route");
    const res = await PUT(badJsonRequest("/api/evals/config", "PUT") as unknown as NextRequest);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "config is required" });
  });

  it("POST /api/document-directory tolerates invalid JSON (30)", async () => {
    const { POST } = await import("../document-directory/route");
    const res = await POST(badJsonRequest("/api/document-directory") as unknown as NextRequest);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "spaceId is required" });
  });

  it("POST /api/agent-context/messages/[id]/reply tolerates invalid JSON (25)", async () => {
    const { POST } = await import("../agent-context/messages/[id]/reply/route");
    const res = await POST(badJsonRequest("/api/agent-context/messages/msg-b39/reply") as unknown as NextRequest, {
      params: Promise.resolve({ id: "msg-b39" }),
    });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "Invalid reply payload" });
  });

  it("POST /api/artifact-gate/auto-readme tolerates invalid JSON (30)", async () => {
    const { POST } = await import("../artifact-gate/auto-readme/route");
    const res = await POST(badJsonRequest("/api/artifact-gate/auto-readme") as unknown as NextRequest);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "spaceId is required" });
  });

  it("POST /api/gsd/lane-eval tolerates invalid JSON (11)", async () => {
    const { POST } = await import("../gsd/lane-eval/route");
    const res = await POST(badJsonRequest("/api/gsd/lane-eval") as unknown as NextRequest);
    expect(res.status).toBe(200);
    expect(runGsdLaneEvalSuite).toHaveBeenCalled();
  });
});

describe("api routes batch39 — sticky skips (covered in batch36–38)", () => {
  // sticky: batch37 resume + batch38 federated/register/onboarding/apo/l3-events.
  it.skip("POST /api/orchestration/runs/[id]/resume invalid JSON — routes-batch37.test.ts", () => {});
  it.skip("POST /api/orchestration/runs/[id]/rollback invalid JSON — routes-batch37.test.ts", () => {});
  it.skip("POST /api/orchestration/federated/execute invalid JSON — routes-batch38.test.ts", () => {});
  it.skip("POST /api/evals/config invalid JSON — routes-batch37.test.ts", () => {});
  it.skip("POST /api/onboarding/register invalid JSON — routes-batch38.test.ts", () => {});
  it.skip("POST /api/heartbeat invalid JSON — routes-batch36.test.ts", () => {});
  it.skip("POST /api/l3/events invalid JSON — routes-batch38.test.ts", () => {});
  it.skip("POST /api/l3/poll invalid JSON — routes-batch36.test.ts", () => {});
  it.skip("POST /api/apo invalid JSON — routes-batch38.test.ts", () => {});
  it.skip("PATCH/DELETE /api/document-directory/[id] invalid JSON — routes-batch37.test.ts", () => {});
});