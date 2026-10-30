// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { createSpace } from "@/lib/space";
import { createDocumentDirectoryEntry } from "@/lib/write-rules";

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
  mockAuthenticateAgent.mockReturnValue({ id: "agent-1" });
  delete process.env.MEMROOS_OPERATOR_API_KEY;
  delete process.env.MEMROOS_AGENT_API_KEY;
  vi.resetModules();
});

describe("long-tail batch17b — workspace, document directory, artifact gate, directives budget", () => {
  it("POST /api/workspace requires spaceId", async () => {
    const { POST } = await import("../workspace/route");
    const res = await POST(jsonBody(`${LOOPBACK}/api/workspace`, { agent: "agent-1" }) as unknown as NextRequest);
    expect(res.status).toBe(400);
  });

  it("GET /api/workspace returns active workspace for authed agent", async () => {
    const space = createSpace(testDb, {
      tenantId: "default-tenant",
      name: `ws-${randomUUID().slice(0, 8)}`,
    });
    const { POST, GET } = await import("../workspace/route");
    await POST(
      jsonBody(`${LOOPBACK}/api/workspace`, {
        spaceId: space.id,
        agent: "agent-1",
      }) as unknown as NextRequest,
    );
    const res = await GET(asReq(`${LOOPBACK}/api/workspace?agent=agent-1`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.workspace?.spaceId).toBe(space.id);
  });

  it("POST /api/document-directory creates an entry when name is provided", async () => {
    const space = createSpace(testDb, {
      tenantId: "default-tenant",
      name: `dd-${randomUUID().slice(0, 8)}`,
    });
    const { POST } = await import("../document-directory/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/document-directory`, {
        spaceId: space.id,
        name: "INDEX.md",
        agent: "agent-1",
      }) as unknown as NextRequest,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).entry.name).toBe("INDEX.md");
  });

  it("PATCH /api/document-directory/[id] requires expectedVersion", async () => {
    const space = createSpace(testDb, {
      tenantId: "default-tenant",
      name: `dd-patch-${randomUUID().slice(0, 8)}`,
    });
    const entry = createDocumentDirectoryEntry(testDb, {
      spaceId: space.id,
      name: "TODO.md",
      actorId: "agent-1",
    });
    const { PATCH } = await import("../document-directory/[id]/route");
    const res = await PATCH(
      jsonBody(
        `${LOOPBACK}/api/document-directory/${entry.id}`,
        { agent: "agent-1", name: "DONE.md" },
        "PATCH",
      ) as unknown as NextRequest,
      { params: Promise.resolve({ id: String(entry.id) }) } as never,
    );
    expect(res.status).toBe(400);
  });

  it("GET /api/artifact-gate/auto-readme returns enabled flag", async () => {
    const space = createSpace(testDb, {
      tenantId: "default-tenant",
      name: `readme-${randomUUID().slice(0, 8)}`,
    });
    const { GET, POST } = await import("../artifact-gate/auto-readme/route");
    await POST(
      jsonBody(`${LOOPBACK}/api/artifact-gate/auto-readme`, {
        spaceId: space.id,
        enabled: true,
        agent: "agent-1",
      }) as unknown as NextRequest,
    );
    const res = await GET(asReq(`${LOOPBACK}/api/artifact-gate/auto-readme?spaceId=${space.id}&agent=agent-1`));
    expect(res.status).toBe(200);
    expect((await res.json()).enabled).toBe(true);
  });

  it("POST /api/directives/budget evaluates directive_text with admin session", async () => {
    mockAuthenticateUser.mockResolvedValueOnce({
      userId: "admin-1",
      role: "admin",
      email: "admin@example.com",
      displayName: "Admin",
      tenantId: "default-tenant",
    });
    const { POST } = await import("../directives/budget/route");
    const res = await POST(
      new NextRequest(`${LOOPBACK}/api/directives/budget`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenant_id: "default-tenant",
          directive_text: "Line one\nLine two\n",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.report?.lineCount).toBe("number");
  });
});
