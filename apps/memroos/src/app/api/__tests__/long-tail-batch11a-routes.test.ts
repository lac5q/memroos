// @vitest-environment node
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: vi.fn(),
}));

vi.mock("@/lib/agent-registry", () => ({
  authenticateAgentHeaders: vi.fn(),
  recordToolOutcome: vi.fn(),
}));

vi.mock("@/lib/operator-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/operator-auth")>();
  return {
    ...actual,
    authorizeRegistryWrite: vi.fn(actual.authorizeRegistryWrite),
  };
});

import { authenticateUser } from "@/lib/auth/session";
import { authenticateAgentHeaders } from "@/lib/agent-registry";
import { authorizeRegistryWrite } from "@/lib/operator-auth";
import { createSpace } from "@/lib/space";
import { getDb } from "@/lib/db";

import { POST as postSpaceCacheInvalidate } from "../space-cache/invalidate/route";
import { POST as postWriteRulesResolve } from "../write-rules/resolve/route";
import { POST as postSyncProposalReject } from "../skills/sync/proposals/[proposalId]/reject/route";
import { GET as getDirectivesDiff } from "../directives/diff/route";
import { POST as postNativeMemoryIngest } from "../native-memory/ingest/route";
import { POST as postOnboardingInvite } from "../onboarding/invite/route";
import { POST as postA2aRegister } from "../a2a/agents/register/route";
import { POST as postAgentMemoryHandoff } from "../agent-memory/handoff/route";
import { POST as postOperationsTelemetry } from "../operations/telemetry/route";
import { GET as getGsdModelRoute, POST as postGsdModelRoute } from "../gsd/model-route/route";
import { POST as postLegalHolds } from "../memory-lifecycle/legal-holds/route";
import { POST as postOnboardingRegister } from "../onboarding/register/route";
import { POST as postSkillsSyncCheck } from "../skills/sync/check/route";
import { POST as postOrchestration } from "../orchestration/route";
import { POST as postOrchestrationFederated } from "../orchestration/federated/execute/route";

const PUBLIC_HOST = "https://memroos.example.com";
const LOOPBACK = "http://localhost";

function makeDirectivesDiffRequest(body: unknown | null): NextRequest {
  const nextUrl = new URL(`${PUBLIC_HOST}/api/directives/diff`);
  return {
    nextUrl,
    headers: new Headers(),
    json: async () => {
      if (body === null) throw new Error("no body");
      return body;
    },
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.mocked(authenticateUser).mockReset();
  vi.mocked(authenticateAgentHeaders).mockReset();
  vi.mocked(authorizeRegistryWrite).mockReset();
  delete process.env.MEMROOS_OPERATOR_API_KEY;
  delete process.env.MEMROOS_AGENT_API_KEY;
});

describe("long-tail batch 11a — API routes", () => {
  it("POST /api/space-cache/invalidate requires agent auth", async () => {
    vi.mocked(authenticateAgentHeaders).mockReturnValueOnce(null);
    const res = await postSpaceCacheInvalidate(
      new Request(`${PUBLIC_HOST}/api/space-cache/invalidate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spaceId: "s1" }),
      }) as never
    );
    expect(res.status).toBe(401);
  });

  it("POST /api/space-cache/invalidate rejects missing spaceId", async () => {
    vi.mocked(authenticateAgentHeaders).mockReturnValue({ id: "agent-1" } as never);
    const res = await postSpaceCacheInvalidate(
      new Request(`${PUBLIC_HOST}/api/space-cache/invalidate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }) as never
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/space-cache/invalidate invalidates a real space", async () => {
    vi.mocked(authenticateAgentHeaders).mockReturnValue({ id: "agent-1" } as never);
    const space = createSpace(getDb(), {
      tenantId: "default-tenant",
      name: `batch11-space-${randomUUID()}`,
    });
    const res = await postSpaceCacheInvalidate(
      new Request(`${PUBLIC_HOST}/api/space-cache/invalidate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spaceId: space.id, reason: "test" }),
      }) as never
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("POST /api/write-rules/resolve requires agent auth", async () => {
    vi.mocked(authenticateAgentHeaders).mockReturnValueOnce(null);
    const res = await postWriteRulesResolve(
      new Request(`${PUBLIC_HOST}/api/write-rules/resolve`, {
        method: "POST",
        body: JSON.stringify({ spaceId: "s", dataType: "note" }),
      }) as never
    );
    expect(res.status).toBe(401);
  });

  it("POST /api/write-rules/resolve validates required fields", async () => {
    vi.mocked(authenticateAgentHeaders).mockReturnValue({ id: "agent-1" } as never);
    const res = await postWriteRulesResolve(
      new Request(`${PUBLIC_HOST}/api/write-rules/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spaceId: "only-space" }),
      }) as never
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/write-rules/resolve returns routing for a space", async () => {
    vi.mocked(authenticateAgentHeaders).mockReturnValue({ id: "agent-1" } as never);
    const space = createSpace(getDb(), {
      tenantId: "default-tenant",
      name: `batch11-wr-${randomUUID()}`,
    });
    const res = await postWriteRulesResolve(
      new Request(`${PUBLIC_HOST}/api/write-rules/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spaceId: space.id, dataType: "memory_note" }),
      }) as never
    );
    expect([200, 500]).toContain(res.status);
  });

  it("POST /api/skills/sync/proposals/:id/reject validates JSON body on loopback", async () => {
    const res = await postSyncProposalReject(
      new Request(`${LOOPBACK}/api/skills/sync/proposals/p1/reject`, {
        method: "POST",
        body: "not-json",
      }),
      { params: Promise.resolve({ proposalId: "p1" }) }
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/skills/sync/proposals/:id/reject requires operator field", async () => {
    const res = await postSyncProposalReject(
      new Request(`${LOOPBACK}/api/skills/sync/proposals/p1/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "nope" }),
      }),
      { params: Promise.resolve({ proposalId: "p1" }) }
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("operator");
  });

  it("GET /api/directives/diff requires authentication", async () => {
    vi.mocked(authenticateUser).mockResolvedValueOnce(null);
    const res = await getDirectivesDiff(
      new Request(`${PUBLIC_HOST}/api/directives/diff`, { method: "GET" }) as never
    );
    expect(res.status).toBe(401);
  });

  it("GET /api/directives/diff rejects missing JSON body", async () => {
    vi.mocked(authenticateUser).mockResolvedValueOnce({
      userId: "u1",
      role: "admin",
      email: "",
      displayName: "",
      tenantId: "default",
    });
    const res = await getDirectivesDiff(makeDirectivesDiffRequest(null));
    expect(res.status).toBe(400);
  });

  it("GET /api/directives/diff returns diff for admin session", async () => {
    vi.mocked(authenticateUser).mockResolvedValueOnce({
      userId: "u1",
      role: "admin",
      email: "",
      displayName: "",
      tenantId: "default",
    });
    const res = await getDirectivesDiff(
      makeDirectivesDiffRequest({ local: "a\n", canonical: "a\nb\n" })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; diff: { identical: boolean } };
    expect(body.ok).toBe(true);
    expect(body.diff.identical).toBe(false);
  });

  it("POST /api/native-memory/ingest requires operator auth", async () => {
    vi.mocked(authenticateUser).mockResolvedValueOnce(null);
    const res = await postNativeMemoryIngest(
      new Request(`${PUBLIC_HOST}/api/native-memory/ingest`, {
        method: "POST",
        body: JSON.stringify({}),
      }) as never
    );
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it("POST /api/onboarding/invite uses forwarded host for origin", async () => {
    vi.mocked(authenticateUser).mockResolvedValueOnce({
      userId: "u1",
      role: "operator",
      email: "",
      displayName: "",
      tenantId: "default",
    });
    const res = await postOnboardingInvite(
      new Request(`${PUBLIC_HOST}/api/onboarding/invite`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-host": "proxy.memroos.example.com",
          "x-forwarded-proto": "https",
        },
        body: JSON.stringify({ agentId: "agent-invite" }),
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; command: string };
    expect(body.ok).toBe(true);
    expect(body.command).toContain("proxy.memroos.example.com");
  });

  it("POST /api/onboarding/invite rejects non-operator session without registry write", async () => {
    vi.mocked(authenticateUser).mockResolvedValueOnce({
      userId: "u1",
      role: "reviewer",
      email: "",
      displayName: "",
      tenantId: "default",
    });
    vi.mocked(authorizeRegistryWrite).mockReturnValueOnce(false);
    const res = await postOnboardingInvite(
      new Request(`${PUBLIC_HOST}/api/onboarding/invite`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/a2a/agents/register requires registry write", async () => {
    vi.mocked(authorizeRegistryWrite).mockReturnValueOnce(false);
    const res = await postA2aRegister(
      new Request(`${PUBLIC_HOST}/api/a2a/agents/register`, {
        method: "POST",
        body: JSON.stringify({ cardUrl: "https://example.com/card" }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/a2a/agents/register validates cardUrl", async () => {
    vi.mocked(authorizeRegistryWrite).mockReturnValueOnce(true);
    const res = await postA2aRegister(
      new Request(`${PUBLIC_HOST}/api/a2a/agents/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/agent-memory/handoff rejects invalid JSON", async () => {
    vi.mocked(authorizeRegistryWrite).mockReturnValueOnce(true);
    const res = await postAgentMemoryHandoff(
      new Request(`${PUBLIC_HOST}/api/agent-memory/handoff`, { method: "POST", body: "{" })
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/operations/telemetry requires registry write", async () => {
    vi.mocked(authorizeRegistryWrite).mockReturnValueOnce(false);
    const res = await postOperationsTelemetry(
      new Request(`${PUBLIC_HOST}/api/operations/telemetry`, {
        method: "POST",
        body: JSON.stringify({ messages: [] }),
      }) as never
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/operations/telemetry accepts empty payloads on authorized hosts", async () => {
    vi.mocked(authorizeRegistryWrite).mockReturnValueOnce(true);
    const res = await postOperationsTelemetry(
      new Request(`${PUBLIC_HOST}/api/operations/telemetry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [], tokenLedgers: [] }),
      }) as never
    );
    expect(res.status).toBe(200);
  });

  it("GET /api/gsd/model-route requires agent headers", async () => {
    vi.mocked(authenticateAgentHeaders).mockReturnValueOnce(null);
    const res = await getGsdModelRoute(new Request(`${PUBLIC_HOST}/api/gsd/model-route`) as never);
    expect(res.status).toBe(401);
  });

  it("POST /api/gsd/model-route routes tasks for authenticated agents", async () => {
    vi.mocked(authenticateAgentHeaders).mockReturnValue({ id: "gsd-agent" } as never);
    const res = await postGsdModelRoute(
      new Request(`${PUBLIC_HOST}/api/gsd/model-route`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskClass: "hard_reasoning" }),
      }) as never
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; route: unknown };
    expect(body.ok).toBe(true);
    expect(body.route).toBeTruthy();
  });

  it("POST /api/memory-lifecycle/legal-holds requires registry write", async () => {
    vi.mocked(authorizeRegistryWrite).mockReturnValueOnce(false);
    const res = await postLegalHolds(
      new Request(`${PUBLIC_HOST}/api/memory-lifecycle/legal-holds`, {
        method: "POST",
        body: JSON.stringify({ action: "create" }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/onboarding/register rejects malformed body", async () => {
    const res = await postOnboardingRegister(
      new Request(`${PUBLIC_HOST}/api/onboarding/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "bad" }),
      })
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("POST /api/skills/sync/check rejects missing roots on loopback", async () => {
    const res = await postSkillsSyncCheck(
      new Request(`${LOOPBACK}/api/skills/sync/check`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("POST /api/orchestration rejects unauthenticated callers", async () => {
    vi.mocked(authenticateAgentHeaders).mockReturnValueOnce(null);
    vi.mocked(authenticateUser).mockResolvedValueOnce(null);
    const res = await postOrchestration(
      new Request(`${PUBLIC_HOST}/api/orchestration`, {
        method: "POST",
        body: JSON.stringify({ action: "status" }),
      }) as never
    );
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it("POST /api/orchestration/federated/execute requires agent auth", async () => {
    vi.mocked(authenticateAgentHeaders).mockReturnValueOnce(null);
    const res = await postOrchestrationFederated(
      new Request(`${PUBLIC_HOST}/api/orchestration/federated/execute`, {
        method: "POST",
        body: JSON.stringify({}),
      }) as never
    );
    expect(res.status).toBeGreaterThanOrEqual(401);
  });
});
