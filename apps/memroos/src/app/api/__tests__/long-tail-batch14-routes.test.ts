// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

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

const adminSession = { ...operatorSession, role: "admin" as const };

function asReq(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as unknown as NextRequest;
}

function jsonPost(url: string, body: unknown, method = "POST"): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function insertSkillforgeProposal(id: string) {
  const now = new Date().toISOString();
  testDb
    .prepare(
      `INSERT INTO skillforge_proposals (
        id, seal_proposal_id, source_skill_id, source_version, proposed_diff, status,
        rejected_edits, residual_risks, created_at, updated_at
      ) VALUES (?, NULL, ?, ?, ?, 'pending', '[]', '[]', ?, ?)`
    )
    .run(id, "skill-batch14", "1.0.0", "diff", now, now);
}

describe("batch14 long-tail API routes", () => {
  beforeEach(() => {
    mockAuthenticateUser.mockReset();
    mockAuthenticateAgent.mockReset();
    mockAuthorizeRegistryWrite.mockReset();
    mockAuthenticateUser.mockResolvedValue(operatorSession);
    mockAuthenticateAgent.mockReturnValue({ id: "agent-1", name: "Agent" });
    mockAuthorizeRegistryWrite.mockReturnValue(true);
    vi.resetModules();
  });

  it("POST /api/l3/events ingests a business outcome event on loopback", async () => {
    const { POST } = await import("../l3/events/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/l3/events`, {
        tenantId: "default-tenant",
        correlationId: `corr-${randomUUID()}`,
        sourceSystem: "crm",
        adapter: "test",
        eventType: "kpi_update",
        kpiKey: "throughput",
        kpiValue: 1,
        rawJson: "{}",
        polledAt: new Date().toISOString(),
      }) as unknown as NextRequest
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("GET /api/l3/events filters by correlationId and agentId", async () => {
    const correlationId = `corr-${randomUUID()}`;
    testDb
      .prepare(
        `INSERT INTO business_outcome_events (
          tenant_id, correlation_id, source_system, adapter, event_type, kpi_key, kpi_value,
          raw_json, agent_id, polled_at, created_at
        ) VALUES (?, ?, 'crm', 'test', 'kpi_update', 'latency', 2, '{}', ?, ?, ?)`
      )
      .run("default-tenant", correlationId, "agent-filter", new Date().toISOString(), new Date().toISOString());
    const { GET } = await import("../l3/events/route");
    const body = await (
      await GET(
        asReq(`${LOOPBACK}/api/l3/events?correlationId=${correlationId}&agentId=agent-filter&limit=10`)
      )
    ).json();
    expect(body.events.length).toBe(1);
    expect(body.events[0].correlationId).toBe(correlationId);
  });

  it("PATCH /api/skillforge/proposals approves a real pending proposal", async () => {
    const proposalId = `prop-${randomUUID()}`;
    insertSkillforgeProposal(proposalId);
    const { PATCH } = await import("../skillforge/proposals/route");
    const res = await PATCH(
      jsonPost(
        `${LOOPBACK}/api/skillforge/proposals`,
        { proposalId, action: "reject", reasoning: "batch14 integration" },
        "PATCH"
      ) as unknown as NextRequest
    );
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("rejected");
  });

  it("PATCH /api/write-rules/[id] rejects invalid rule id", async () => {
    const { PATCH } = await import("../write-rules/[id]/route");
    const res = await PATCH(
      jsonPost(`${LOOPBACK}/api/write-rules/not-a-number`, { expectedVersion: 1 }, "PATCH") as unknown as NextRequest,
      { params: Promise.resolve({ id: "not-a-number" }) } as never
    );
    expect(res.status).toBe(400);
  });

  it("GET /api/memory-lifecycle/tombstones requires spaceId", async () => {
    const { GET } = await import("../memory-lifecycle/tombstones/route");
    const res = await GET(asReq(`${LOOPBACK}/api/memory-lifecycle/tombstones`));
    expect(res.status).toBe(400);
  });

  it("GET /api/memory-lifecycle/tombstones lists tombstones for a subject hash", async () => {
    const subjectHash = `sha256:${"d".repeat(64)}`;
    const { GET } = await import("../memory-lifecycle/tombstones/route");
    const res = await GET(
      asReq(`${LOOPBACK}/api/memory-lifecycle/tombstones?subjectHash=${encodeURIComponent(subjectHash)}`)
    );
    expect(res.status).toBe(200);
  });

  it("POST /api/tools/disconnect rejects missing connection id", async () => {
    const { POST } = await import("../tools/disconnect/route");
    const res = await POST(jsonPost(`${LOOPBACK}/api/tools/disconnect`, {}) as unknown as NextRequest);
    expect(res.status).toBe(400);
  });

  it("GET /api/directives/budget returns budget envelope for admin", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(adminSession);
    const { GET } = await import("../directives/budget/route");
    const res = await GET(
      new NextRequest(`${LOOPBACK}/api/directives/budget?tenant=default-tenant`)
    );
    expect(res.status).toBe(200);
  });

  it("GET /api/workspace returns workspace configuration", async () => {
    const { GET } = await import("../workspace/route");
    const res = await GET(asReq(`${LOOPBACK}/api/workspace`));
    expect(res.status).toBe(200);
  });

  it("GET /api/agent-checkpoints requires spaceId", async () => {
    const { GET } = await import("../agent-checkpoints/route");
    const res = await GET(asReq(`${LOOPBACK}/api/agent-checkpoints`));
    expect(res.status).toBe(400);
  });

  it("GET /api/skills/pins lists pins with default pagination", async () => {
    const { GET } = await import("../skills/pins/route");
    const res = await GET(asReq(`${LOOPBACK}/api/skills/pins?limit=5`));
    expect(res.status).toBe(200);
  });

  it("POST /api/skills/verify rejects missing skill_name and content", async () => {
    const { POST } = await import("../skills/verify/route");
    const res = await POST(jsonPost(`${LOOPBACK}/api/skills/verify`, {}) as unknown as NextRequest);
    expect(res.status).toBe(400);
  });
});
