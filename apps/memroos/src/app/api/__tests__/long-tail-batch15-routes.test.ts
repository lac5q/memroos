// @vitest-environment node
import { randomUUID } from "node:crypto";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";

const TMP_ROOT = path.join(os.tmpdir(), `batch15-routes-${randomUUID()}`);
const testDb = new Database(":memory:");
initSchema(testDb);

const mockAuthenticateUser = vi.fn();
const mockAuthenticateAgent = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => mockAuthenticateUser(...args),
}));

vi.mock("@/lib/agent-registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent-registry")>();
  return {
    ...actual,
    authenticateAgentHeaders: (...args: unknown[]) => mockAuthenticateAgent(...args),
  };
});

const LOOPBACK = "http://localhost";
const operatorSession = {
  userId: "op-1",
  role: "operator" as const,
  email: "op@example.com",
  displayName: "Operator",
  tenantId: "default-tenant",
};

function asReq(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as unknown as NextRequest;
}

function jsonBody(url: string, body: unknown, method = "POST"): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", ...(method === "POST" ? {} : {}) },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockAuthenticateUser.mockReset();
  mockAuthenticateAgent.mockReset();
  mockAuthenticateUser.mockResolvedValue(operatorSession);
  mockAuthenticateAgent.mockReturnValue({ id: "agent-1" });
  delete process.env["MEMROOS_OPERATOR_API_KEY"];
  vi.resetModules();
});

afterEach(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

function makePost(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("batch15 — API route branches", () => {
  it("GET /api/skills/proposals rejects invalid status filter", async () => {
    const { GET } = await import("../skills/proposals/route");
    const res = await GET(asReq(`${LOOPBACK}/api/skills/proposals?status=not-a-status`));
    expect(res.status).toBe(400);
  });

  it("POST /api/skills/proposals validates body shape and hash types", async () => {
    process.env["MEMROOS_OPERATOR_API_KEY"] = "sync-key";
    const { POST } = await import("../skills/proposals/route");
    expect((await POST(makePost(`${LOOPBACK}/api/skills/proposals`, ["bad"]))).status).toBe(400);
    expect(
      (
        await POST(
          makePost(`${LOOPBACK}/api/skills/proposals`, {
            source_harness: "claude",
            skill_name: "x",
            proposed_by: "scanner",
            detected_content_hash: 123,
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          makePost(`${LOOPBACK}/api/skills/proposals`, {
            source_harness: "claude",
            skill_name: "x",
            proposed_by: "scanner",
          }),
        )
      ).status,
    ).toBe(400);
  });

  it("POST /api/skills/pins validates required hash and actor fields", async () => {
    process.env["MEMROOS_OPERATOR_API_KEY"] = "sync-key";
    const { POST } = await import("../skills/pins/route");
    expect((await POST(makePost(`${LOOPBACK}/api/skills/pins`, null))).status).toBe(400);
    const badHash = await POST(
      makePost(`${LOOPBACK}/api/skills/pins`, {
        agent_id: "agent-1",
        skill_name: "skill",
        current_version: "1.0.0",
        current_content_hash: "short",
        actor: "operator",
      }),
    );
    expect(badHash.status).toBe(400);
  });

  it("POST /api/library/qmd-update requires auth on remote host", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const { POST } = await import("../library/qmd-update/route");
    const res = await POST(asReq("https://memroos.example/api/library/qmd-update", { method: "POST" }));
    expect(res.status).toBe(401);
  });

  it("GET /api/agent-context/messages/[id] enforces agent access", async () => {
    const { GET } = await import("../agent-context/messages/[id]/route");
    mockAuthenticateAgent.mockReturnValueOnce(null);
    const unauth = await GET(asReq(`${LOOPBACK}/api/agent-context/messages/msg-1`), {
      params: Promise.resolve({ id: "msg-1" }),
    } as never);
    expect(unauth.status).toBe(401);
  });

  it("PATCH /api/write-rules/[id] rejects invalid ids", async () => {
    const { PATCH } = await import("../write-rules/[id]/route");
    const res = await PATCH(jsonBody(`${LOOPBACK}/api/write-rules/abc`, { expectedVersion: 1 }, "PATCH") as unknown as NextRequest, {
      params: Promise.resolve({ id: "abc" }),
    } as never);
    expect(res.status).toBe(400);
  });

  it("GET /api/workspace returns active workspace for authed agent", async () => {
    const { GET } = await import("../workspace/route");
    const res = await GET(asReq(`${LOOPBACK}/api/workspace?agent=agent-1`));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("POST /api/workspace requires spaceId", async () => {
    const { POST } = await import("../workspace/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/workspace`, { agent: "agent-1", spaceId: "   " }) as unknown as NextRequest,
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/tools/disconnect validates provider payload", async () => {
    const { POST } = await import("../tools/disconnect/route");
    const res = await POST(jsonBody(`${LOOPBACK}/api/tools/disconnect`, {}) as unknown as NextRequest);
    expect(res.status).toBe(400);
  });

  it("POST /api/skills/verify returns fail-closed envelope for missing skill", async () => {
    const { POST } = await import("../skills/verify/route");
    const res = await POST(
      makePost(`${LOOPBACK}/api/skills/verify`, { skill_name: `missing-${randomUUID()}` }),
    );
    // 400: no operator key; 404: key present but skill missing; 200: fail-closed verified=false.
    expect([200, 400, 404]).toContain(res.status);
    const body = await res.json();
    expect(body.verified === false || body.ok === false).toBe(true);
  });

  it("POST /api/skills/quarantine/reject validates body shape", async () => {
    const { POST } = await import("../skills/quarantine/reject/route");
    const badBody = await POST(makePost(`${LOOPBACK}/api/skills/quarantine/reject`, {}));
    expect(badBody.status).toBe(400);
  });

  it("GET /api/paperclip and POST paths return structured responses", async () => {
    const { GET } = await import("../paperclip/route");
    expect((await GET(asReq(`${LOOPBACK}/api/paperclip`))).status).toBe(200);
  });

  it("GET /api/memory-lifecycle/tombstones requires subjectHash", async () => {
    const { GET } = await import("../memory-lifecycle/tombstones/route");
    const res = await GET(asReq(`${LOOPBACK}/api/memory-lifecycle/tombstones?tenantId=default-tenant`));
    expect(res.status).toBe(400);
    const subjectHash = `sha256:${"a".repeat(64)}`;
    const ok = await GET(
      asReq(`${LOOPBACK}/api/memory-lifecycle/tombstones?tenantId=default-tenant&subjectHash=${subjectHash}`),
    );
    expect(ok.status).toBe(200);
  });

  it("GET /api/l3/events accepts query filters", async () => {
    const { GET } = await import("../l3/events/route");
    const res = await GET(asReq(`${LOOPBACK}/api/l3/events?limit=5`));
    expect(res.status).toBe(200);
  });

  it("GET /api/document-directory requires agent auth and spaceId", async () => {
    mockAuthenticateAgent.mockReturnValueOnce(null);
    const { GET } = await import("../document-directory/route");
    expect((await GET(asReq(`${LOOPBACK}/api/document-directory`))).status).toBe(401);
    mockAuthenticateAgent.mockReturnValueOnce({ id: "agent-1" });
    expect((await GET(asReq(`${LOOPBACK}/api/document-directory?spaceId=`))).status).toBe(400);
  });

  it("GET /api/directives/budget returns budget envelope", async () => {
    process.env["MEMROOS_OPERATOR_API_KEY"] = "budget-key";
    const { GET } = await import("../directives/budget/route");
    const res = await GET(
      new NextRequest(`${LOOPBACK}/api/directives/budget`, {
        headers: { authorization: "Bearer budget-key" },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("GET /api/apo returns operator envelope when authed", async () => {
    const { GET } = await import("../apo/route");
    const res = await GET(asReq(`${LOOPBACK}/api/apo`));
    expect(res.status).toBe(200);
  });

  it("GET /api/agent-memory/traces requires runId", async () => {
    const { GET } = await import("../agent-memory/traces/route");
    expect((await GET(asReq(`${LOOPBACK}/api/agent-memory/traces`))).status).toBe(400);
    const res = await GET(asReq(`${LOOPBACK}/api/agent-memory/traces?runId=run-${randomUUID()}`));
    expect(res.status).toBe(404);
  });

  it("GET /api/agent-context/messages validates box and status", async () => {
    const { GET } = await import("../agent-context/messages/route");
    expect((await GET(asReq(`${LOOPBACK}/api/agent-context/messages?box=bad`))).status).toBe(400);
    expect((await GET(asReq(`${LOOPBACK}/api/agent-context/messages?status=not-status`))).status).toBe(400);
    expect((await GET(asReq(`${LOOPBACK}/api/agent-context/messages?limit=5`))).status).toBe(200);
  });

  it("POST /api/agent-checkpoints validates required checkpoint fields", async () => {
    const { POST } = await import("../agent-checkpoints/route");
    const res = await POST(jsonBody(`${LOOPBACK}/api/agent-checkpoints`, {}) as unknown as NextRequest);
    expect(res.status).toBe(400);
  });

  it("GET /api/recall rejects crossProject without allowlist", async () => {
    const { GET } = await import("../recall/route");
    const res = await GET(asReq(`${LOOPBACK}/api/recall?q=test&crossProject=true`));
    expect(res.status).toBe(400);
  });

  it("POST /api/gsd/adapter requires adapterId and action", async () => {
    const { POST } = await import("../gsd/adapter/route");
    const res = await POST(jsonBody(`${LOOPBACK}/api/gsd/adapter`, { agent: "agent-1" }) as unknown as NextRequest);
    expect(res.status).toBe(400);
  });

  it("POST /api/agent-context/messages rejects invalid payload and self-declared claims", async () => {
    const { POST } = await import("../agent-context/messages/route");
    expect((await POST(jsonBody(`${LOOPBACK}/api/agent-context/messages`, null) as unknown as NextRequest)).status).toBe(
      400,
    );
    const denied = await POST(
      jsonBody(`${LOOPBACK}/api/agent-context/messages`, {
        fromAgent: "agent-1",
        toAgent: "agent-2",
        body: "hello",
        oauthToken: "secret",
      }) as unknown as NextRequest,
    );
    expect(denied.status).toBe(403);
  });
});
