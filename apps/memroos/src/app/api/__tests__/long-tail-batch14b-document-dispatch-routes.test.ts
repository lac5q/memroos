// @vitest-environment node
import Database from "better-sqlite3";
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";
import { createSpace } from "@/lib/space";
import { createDocumentDirectoryEntry } from "@/lib/write-rules";

const testDb = new Database(":memory:");
initSchema(testDb);

const mockAuthenticateAgent = vi.fn();
const mockAuthenticateUser = vi.fn();
const mockAuthorizeRegistryWrite = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/agent-registry", () => ({
  authenticateAgentHeaders: (...args: unknown[]) => mockAuthenticateAgent(...args),
  getRemoteAgents: vi.fn(() => []),
  listRegisteredAgents: vi.fn(() => [
    {
      id: "sophia",
      name: "Sophia",
      role: "Marketing",
      platform: "claude",
      protocol: "rest",
      status: "active",
      location: "local",
      host: null,
      port: null,
      healthEndpoint: null,
      currentTask: null,
      lastHeartbeat: null,
      lessonsCount: 0,
      todayMemoryCount: 0,
      isRemote: false,
      latencyMs: null,
      capabilities: [],
      metadata: {},
      tunnelUrl: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      deregisteredAt: null,
    },
  ]),
}));

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => mockAuthenticateUser(...args),
}));

vi.mock("@/lib/operator-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/operator-auth")>();
  return {
    ...actual,
    authorizeRegistryWrite: (...args: unknown[]) => mockAuthorizeRegistryWrite(...args),
  };
});

vi.mock("@/lib/content-scanner", () => ({
  scanContent: vi.fn(() => ({ blocked: false, matches: [], cleanContent: "task" })),
}));
vi.mock("@/lib/iris-scanner", () => ({
  scanIrisPreflight: vi.fn(() => ({ blocked: false, findings: [], matches: [], cleanContent: "task" })),
}));
vi.mock("@/lib/security-policy", () => ({
  checkDispatchPolicy: vi.fn(() => ({ allowed: true })),
}));
vi.mock("@/lib/dispatch/adapter-factory", () => ({
  selectAdapter: vi.fn(() => ({
    name: "local-queue",
    dispatch: vi.fn().mockResolvedValue({ accepted: true, mode: "queued", detail: "ok" }),
  })),
}));
vi.mock("@/lib/dispatch/skill-lookup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dispatch/skill-lookup")>();
  return { ...actual, lookupSkillContract: vi.fn(() => null) };
});
vi.mock("@/lib/skills/skill-sync-governance", () => ({
  getAgentVersionPin: vi.fn(() => null),
}));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn() }));

const LOOPBACK = "http://localhost";

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("batch14b — /api/document-directory/[id]", () => {
  let entryId: number;

  beforeEach(() => {
    mockAuthenticateAgent.mockReset();
    mockAuthenticateAgent.mockReturnValue({ id: "agent-1" });
    const space = createSpace(testDb, { tenantId: "default-tenant", name: `dir-${Date.now()}` });
    entryId = createDocumentDirectoryEntry(testDb, {
      spaceId: space.id,
      name: "Original",
      actorId: "agent-1",
    }).id;
    vi.resetModules();
  });

  it("401 when agent auth fails", async () => {
    mockAuthenticateAgent.mockReturnValueOnce(null);
    const { PATCH } = await import("../document-directory/[id]/route");
    const res = await PATCH(
      jsonRequest(`${LOOPBACK}/api/document-directory/${entryId}`, "PATCH", {
        expectedVersion: 1,
        name: "X",
      }) as unknown as NextRequest,
      { params: Promise.resolve({ id: String(entryId) }) }
    );
    expect(res.status).toBe(401);
  });

  it("400 for invalid entry id", async () => {
    const { PATCH } = await import("../document-directory/[id]/route");
    const res = await PATCH(
      jsonRequest(`${LOOPBACK}/api/document-directory/not-id`, "PATCH", {
        expectedVersion: 1,
        name: "X",
      }) as unknown as NextRequest,
      { params: Promise.resolve({ id: "not-id" }) }
    );
    expect(res.status).toBe(400);
  });

  it("PATCH updates purpose and resource_id using agentId body hint", async () => {
    mockAuthenticateAgent.mockImplementation((_headers, hint?: string) =>
      hint === "agent-hint" ? { id: "agent-hint" } : { id: "agent-1" }
    );
    const { PATCH } = await import("../document-directory/[id]/route");
    const res = await PATCH(
      jsonRequest(`${LOOPBACK}/api/document-directory/${entryId}`, "PATCH", {
        expectedVersion: 1,
        agentId: "agent-hint",
        purpose: "Runbook index",
        resource_id: "res-42",
      }) as unknown as NextRequest,
      { params: Promise.resolve({ id: String(entryId) }) }
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.entry.purpose).toBe("Runbook index");
    expect(body.entry.resourceId).toBe("res-42");
  });

  it("DELETE returns 400 on version mismatch", async () => {
    const { DELETE } = await import("../document-directory/[id]/route");
    const res = await DELETE(
      jsonRequest(`${LOOPBACK}/api/document-directory/${entryId}`, "DELETE", {
        expectedVersion: 99,
      }) as unknown as NextRequest,
      { params: Promise.resolve({ id: String(entryId) }) }
    );
    expect(res.status).toBe(400);
  });
});

describe("batch14b — /api/dispatch auth branches", () => {
  beforeEach(() => {
    mockAuthenticateUser.mockReset();
    mockAuthenticateAgent.mockReset();
    mockAuthorizeRegistryWrite.mockReset();
    mockAuthenticateAgent.mockReturnValue(null);
    mockAuthorizeRegistryWrite.mockReturnValue(false);
    vi.resetModules();
  });

  it("403 when authenticated user lacks operator role", async () => {
    vi.resetModules();
    mockAuthenticateUser.mockResolvedValue({
      userId: "reviewer-1",
      role: "reviewer",
      email: "r@example.com",
      displayName: "Reviewer",
      tenantId: "default-tenant",
    });
    const { POST } = await import("../dispatch/route");
    const res = await POST(
      jsonRequest("https://memroos.example/api/dispatch", "POST", {
        to_agent: "sophia",
        task_summary: "blocked role",
      }) as unknown as NextRequest
    );
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("FORBIDDEN");
  });

  it("200 when operator session dispatches on remote host", async () => {
    mockAuthenticateUser.mockResolvedValue({
      userId: "op-1",
      role: "operator",
      email: "op@example.com",
      displayName: "Operator",
      tenantId: "default-tenant",
    });
    const { POST } = await import("../dispatch/route");
    const res = await POST(
      jsonRequest("https://memroos.example/api/dispatch", "POST", {
        to_agent: "sophia",
        task_summary: "operator dispatch",
      }) as unknown as NextRequest
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});
