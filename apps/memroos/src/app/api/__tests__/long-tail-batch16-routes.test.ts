// @vitest-environment node
import { generateKeyPairSync, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { EventEmitter } from "events";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";
import { postAgentContextMessage } from "@/lib/agent-context-bus";
import { registerAgent } from "@/lib/agent-registry";
import { createSpace } from "@/lib/space";
import { createWriteRule, createDocumentDirectoryEntry } from "@/lib/write-rules";

const testDb = new Database(":memory:");
initSchema(testDb);

const mockAuthenticateUser = vi.fn();
const mockAuthenticateAgent = vi.fn();
const mockAuthorizeRegistryWrite = vi.fn();

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

vi.mock("@/lib/operator-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/operator-auth")>();
  return {
    ...actual,
    authorizeRegistryWrite: (...args: unknown[]) => mockAuthorizeRegistryWrite(...args),
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
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockAuthenticateUser.mockReset();
  mockAuthenticateAgent.mockReset();
  mockAuthorizeRegistryWrite.mockReset();
  mockAuthenticateUser.mockResolvedValue(operatorSession);
  mockAuthenticateAgent.mockReturnValue({ id: "agent-1" });
  mockAuthorizeRegistryWrite.mockImplementation((req: Request) => {
    try {
      return new URL(req.url).hostname === "localhost";
    } catch {
      return false;
    }
  });
  delete process.env.MEMROOS_OPERATOR_API_KEY;
  delete process.env.MEMROOS_AGENT_API_KEY;
  delete process.env.PAPERCLIP_BASE_URL;
  vi.resetModules();
});

afterEach(() => {
  testDb.exec("DELETE FROM hive_delegations");
});

describe("batch16 — API route coverage gaps", () => {
  it("DELETE /api/workspace requires agent auth", async () => {
    mockAuthenticateAgent.mockReturnValueOnce(null);
    const { DELETE } = await import("../workspace/route");
    const res = await DELETE(asReq(`${LOOPBACK}/api/workspace?agent=agent-1`));
    expect(res.status).toBe(401);
  });

  it("DELETE /api/workspace clears active workspace for authed agent", async () => {
    const space = createSpace(testDb, {
      tenantId: "default-tenant",
      name: `ws-${randomUUID().slice(0, 8)}`,
    });
    const { POST, DELETE, GET } = await import("../workspace/route");
    expect(
      (
        await POST(
          jsonBody(`${LOOPBACK}/api/workspace`, {
            agent: "agent-1",
            spaceId: space.id,
          }) as unknown as NextRequest,
        )
      ).status,
    ).toBe(200);
    const cleared = await DELETE(asReq(`${LOOPBACK}/api/workspace?agent=agent-1`));
    expect(cleared.status).toBe(200);
    expect((await cleared.json()).ok).toBe(true);
    const after = await GET(asReq(`${LOOPBACK}/api/workspace?agent=agent-1`));
    expect(after.status).toBe(200);
  });

  it("GET /api/write-rules lists rules for a space", async () => {
    const space = createSpace(testDb, {
      tenantId: "default-tenant",
      name: `rules-${randomUUID().slice(0, 8)}`,
    });
    createWriteRule(testDb, {
      spaceId: space.id,
      dataType: "note",
      targetDocument: "notes.md",
      actorId: "agent-1",
    });
    const { GET } = await import("../write-rules/route");
    const unauth = await GET(asReq(`${LOOPBACK}/api/write-rules?spaceId=${space.id}`));
    expect(unauth.status).toBe(200);
    const body = await unauth.json();
    expect(body.ok).toBe(true);
    expect(body.rules.length).toBeGreaterThanOrEqual(1);
  });

  it("PATCH /api/write-rules/[id] updates rule with expectedVersion", async () => {
    const space = createSpace(testDb, {
      tenantId: "default-tenant",
      name: `patch-${randomUUID().slice(0, 8)}`,
    });
    const rule = createWriteRule(testDb, {
      spaceId: space.id,
      dataType: "note",
      targetDocument: "notes.md",
      actorId: "agent-1",
    });
    const { PATCH } = await import("../write-rules/[id]/route");
    const res = await PATCH(
      jsonBody(
        `${LOOPBACK}/api/write-rules/${rule.id}`,
        { targetDocument: "updated.md", expectedVersion: rule.version, agent: "agent-1" },
        "PATCH",
      ) as unknown as NextRequest,
      { params: Promise.resolve({ id: String(rule.id) }) } as never,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).rule.targetDocument).toBe("updated.md");
  });

  it("DELETE /api/write-rules/[id] requires expectedVersion", async () => {
    const { DELETE } = await import("../write-rules/[id]/route");
    const res = await DELETE(
      jsonBody(`${LOOPBACK}/api/write-rules/5`, { agent: "agent-1" }, "DELETE") as unknown as NextRequest,
      { params: Promise.resolve({ id: "5" }) } as never,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/expectedVersion/i);
  });

  it("GET /api/skills/pins lists pins with pagination defaults", async () => {
    const { GET } = await import("../skills/pins/route");
    const res = await GET(asReq(`${LOOPBACK}/api/skills/pins?limit=10&offset=0`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.limit).toBe(10);
    expect(body.offset).toBe(0);
  });

  it("POST /api/skills/pins rejects invalid skill_id type", async () => {
    const { POST } = await import("../skills/pins/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/skills/pins`, {
        agent_id: "agent-1",
        skill_name: "demo-skill",
        current_version: "1.0.0",
        current_content_hash: "a".repeat(64),
        actor: "operator",
        skill_id: -3,
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/skill_id/i);
  });

  it("POST /api/skills/verify rejects invalid public_key_pem", async () => {
    const { POST } = await import("../skills/verify/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/skills/verify`, {
        content_hash: "b".repeat(64),
        signature: "sig",
        public_key_pem: "not-a-valid-pem",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).verified).toBe(false);
  });

  it("POST /api/skills/verify returns 404 for missing registry skill", async () => {
    const { publicKey } = generateKeyPairSync("ed25519");
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const { POST } = await import("../skills/verify/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/skills/verify`, {
        skill_name: `missing-skill-${randomUUID()}`,
        public_key_pem: publicKeyPem,
      }),
    );
    expect(res.status).toBe(404);
  });

  it("POST /api/skills/quarantine/reject validates operator and reason", async () => {
    const { POST } = await import("../skills/quarantine/reject/route");
    expect((await POST(jsonBody(`${LOOPBACK}/api/skills/quarantine/reject`, { skill_id: 1 }))).status).toBe(
      400,
    );
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/skills/quarantine/reject`, {
        skill_id: 999_999,
        operator: "op",
        reason: "test rejection",
      }),
    );
    expect(res.status).toBe(404);
  });

  it("GET /api/paperclip parses invalid delegation checkpoint safely", async () => {
    testDb
      .prepare(
        `INSERT INTO hive_delegations(task_id, from_agent, to_agent, task_summary, priority, status, checkpoint)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(`task-${randomUUID()}`, "agent-1", "paperclip", "bad checkpoint", 1, "paused", "{not-json");
    const { GET } = await import("../paperclip/route");
    const res = await GET(asReq(`${LOOPBACK}/api/paperclip`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.operations.length).toBeGreaterThanOrEqual(1);
    expect(body.operations[0].completedSteps).toEqual([]);
  });

  it("POST /api/paperclip rejects invalid JSON body", async () => {
    const { POST } = await import("../paperclip/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/paperclip`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("GET /api/document-directory returns entries for authed agent", async () => {
    const space = createSpace(testDb, {
      tenantId: "default-tenant",
      name: `docdir-${randomUUID().slice(0, 8)}`,
    });
    createDocumentDirectoryEntry(testDb, {
      spaceId: space.id,
      name: "README.md",
      actorId: "agent-1",
    });
    const { GET } = await import("../document-directory/route");
    const res = await GET(asReq(`${LOOPBACK}/api/document-directory?spaceId=${space.id}&agent=agent-1`));
    expect(res.status).toBe(200);
    expect((await res.json()).entries.length).toBeGreaterThanOrEqual(1);
  });

  it("PATCH /api/document-directory/[id] rejects invalid entry id", async () => {
    const { PATCH } = await import("../document-directory/[id]/route");
    const res = await PATCH(
      jsonBody(`${LOOPBACK}/api/document-directory/nope`, { expectedVersion: 1, agent: "agent-1" }, "PATCH") as unknown as NextRequest,
      { params: Promise.resolve({ id: "nope" }) } as never,
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/memory-lifecycle/tombstones verify action returns report", async () => {
    const { POST } = await import("../memory-lifecycle/tombstones/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/memory-lifecycle/tombstones`, {
        action: "verify",
        tenantId: "default-tenant",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("report");
  });

  it("POST /api/directives/budget rejects budget_lines without tenant_id", async () => {
    mockAuthenticateUser.mockResolvedValueOnce({
      userId: "admin-1",
      role: "admin",
      email: "admin@example.com",
    });
    const { POST } = await import("../directives/budget/route");
    const res = await POST(
      new NextRequest(`${LOOPBACK}/api/directives/budget`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ budget_lines: 42 }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/tools/disconnect returns 400 for invalid JSON", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(operatorSession);
    const { POST } = await import("../tools/disconnect/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/tools/disconnect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json",
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("GET /api/l3/events filters by since/until query params", async () => {
    const { GET } = await import("../l3/events/route");
    const res = await GET(
      asReq(
        `${LOOPBACK}/api/l3/events?since=2020-01-01T00:00:00.000Z&until=2030-01-01T00:00:00.000Z&limit=3`,
      ),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).events).toEqual([]);
  });

  it("POST /api/l3/events validates required ingestion fields", async () => {
    const { POST } = await import("../l3/events/route");
    const res = await POST(jsonBody(`${LOOPBACK}/api/l3/events`, { correlationId: "c-1" }));
    expect(res.status).toBe(400);
  });

  it("POST /api/l3/events inserts a manual event when authed", async () => {
    const { POST } = await import("../l3/events/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/l3/events`, {
        correlationId: `corr-${randomUUID()}`,
        sourceSystem: "manual",
        adapter: "test",
        eventType: "kpi",
        kpiKey: "revenue",
        kpiValue: 1,
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("GET /api/agent-context/messages/[id] forbids unrelated agents", async () => {
    registerAgent({
      id: "agent-alpha",
      name: "Alpha",
      role: "Worker",
      platform: "codex",
      protocol: "rest",
    });
    registerAgent({
      id: "agent-beta",
      name: "Beta",
      role: "Worker",
      platform: "codex",
      protocol: "rest",
    });
    const message = postAgentContextMessage(testDb, {
      fromAgent: "agent-alpha",
      toAgent: "agent-beta",
      body: "hello",
    });
    const { GET } = await import("../agent-context/messages/[id]/route");
    mockAuthenticateAgent.mockReturnValueOnce({ id: "agent-1" });
    const res = await GET(asReq(`${LOOPBACK}/api/agent-context/messages/${message.id}?agent=agent-1`), {
      params: Promise.resolve({ id: message.id }),
    } as never);
    expect(res.status).toBe(403);
  });

  it("GET /api/agent-context/messages/[id] returns message for participant", async () => {
    registerAgent({
      id: "agent-1",
      name: "One",
      role: "Worker",
      platform: "codex",
      protocol: "rest",
    });
    registerAgent({
      id: "agent-2",
      name: "Two",
      role: "Worker",
      platform: "codex",
      protocol: "rest",
    });
    const message = postAgentContextMessage(testDb, {
      fromAgent: "agent-1",
      toAgent: "agent-2",
      body: "visible",
    });
    const { GET } = await import("../agent-context/messages/[id]/route");
    const res = await GET(asReq(`${LOOPBACK}/api/agent-context/messages/${message.id}?agent=agent-1`), {
      params: Promise.resolve({ id: message.id }),
    } as never);
    expect(res.status).toBe(200);
    expect((await res.json()).message.id).toBe(message.id);
  });

  it("POST /api/apo process-approved on empty queue succeeds", async () => {
    const tmp = `/tmp/apo-batch16-${randomUUID()}`;
    process.env.APO_PROPOSALS_PATH = `${tmp}/proposals`;
    process.env.APO_SKILLS_PATH = `${tmp}/skills`;
    const { POST } = await import("../apo/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/apo`, { action: "process-approved", limit: 1 }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.processed).toBe(0);
    delete process.env.APO_PROPOSALS_PATH;
    delete process.env.APO_SKILLS_PATH;
  });

  it("GET /api/gsd/adapter returns adapter contract for authed agent", async () => {
    const { GET } = await import("../gsd/adapter/route");
    const res = await GET(asReq(`${LOOPBACK}/api/gsd/adapter`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contract.adapters).toContain("cursor");
    expect(body.contract.actions).toContain("standup");
  });

  it("POST /api/gsd/adapter runs standup action", async () => {
    const { POST } = await import("../gsd/adapter/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/gsd/adapter`, {
        agent: "agent-1",
        adapterId: "cursor",
        action: "standup",
        payload: { goalId: `goal-${randomUUID().slice(0, 8)}` },
      }) as unknown as NextRequest,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).action).toBe("standup");
  });

  it("GET /api/memory-lifecycle/subject-erasure lists plans", async () => {
    const { GET } = await import("../memory-lifecycle/subject-erasure/route");
    const res = GET(asReq(`${LOOPBACK}/api/memory-lifecycle/subject-erasure?limit=5`));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("POST /api/memory-lifecycle/subject-erasure rejects unsupported action", async () => {
    const { POST } = await import("../memory-lifecycle/subject-erasure/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/memory-lifecycle/subject-erasure`, { action: "noop" }),
    );
    expect(res.status).toBe(400);
  });
});
