// @vitest-environment node
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

import { GET as getTimeSeries } from "../time-series/route";
import { GET as getWiki } from "../wiki/route";
import { GET as getSharedSpace, POST as postSharedSpace } from "../shared-space/route";
import { POST as postToolAttentionRecord } from "../tool-attention/record/route";
import { GET as getSecurityReport } from "../security/report/route";
import { GET as getCronHealth, POST as postCronHealth } from "../cron-health/route";
import { POST as postMemoryLifecycleVault } from "../memory-lifecycle/vault/route";
import { POST as postMemoryLifecycleRetention } from "../memory-lifecycle/retention/route";
import { GET as getSealProposalById } from "../seal/proposals/[id]/route";
import { GET as getWorkspacePrompt } from "../workspace/prompt/route";
import { GET as getEscalations } from "../escalations/route";
import { GET as getLibraryFreshness } from "../library/freshness/route";
import { POST as postPaperclipActivity } from "../paperclip/activity/route";
import { GET as getAgentCheckpointMetrics } from "../agent-checkpoints/metrics/route";
import { GET as getMemoryHealth } from "../memory/health/route";
import { GET as getSealProposals } from "../seal/proposals/route";
import { POST as postPolicyKnowledge } from "../policy/knowledge/route";
import { POST as postAuditKnowledge } from "../audit/knowledge/route";
import { POST as postSkillsReview } from "../skills/review/route";
import { GET as getSpaceCacheHistory } from "../space-cache/history/route";
import { GET as getSharedSpaceHistory } from "../shared-space/history/route";
import { GET as getModelRoutingRecommendations } from "../model-routing/recommendations/route";
import { POST as postSkillsPinRollback } from "../skills/pins/[agent]/rollback/route";
import { GET as getActivity } from "../activity/route";
import { GET as getOperationsNoc } from "../operations/noc/route";

const PUBLIC_HOST = "https://memroos.example.com";

beforeEach(() => {
  vi.mocked(authenticateUser).mockReset();
  vi.mocked(authenticateAgentHeaders).mockReset();
  vi.mocked(authorizeRegistryWrite).mockReset();
  delete process.env.MEMROOS_OPERATOR_API_KEY;
});

describe("long-tail batch 10 — API routes", () => {
  it("GET /api/time-series rejects unknown metrics", async () => {
    const res = await getTimeSeries(new Request(`${PUBLIC_HOST}/api/time-series?metric=nope&window=day`) as never);
    expect(res.status).toBe(400);
  });

  it("GET /api/time-series returns points for recall_queries", async () => {
    const res = await getTimeSeries(
      new Request(`${PUBLIC_HOST}/api/time-series?metric=recall_queries&window=day`) as never
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { metric: string; points: unknown[] };
    expect(body.metric).toBe("recall_queries");
    expect(Array.isArray(body.points)).toBe(true);
  });

  it("GET /api/wiki status view returns root existence", async () => {
    const res = await getWiki(new Request(`${PUBLIC_HOST}/api/wiki?view=status`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; exists: boolean };
    expect(body.ok).toBe(true);
    expect(typeof body.exists).toBe("boolean");
  });

  it("GET /api/shared-space requires agent auth", async () => {
    vi.mocked(authenticateAgentHeaders).mockReturnValueOnce(null);
    const res = await getSharedSpace(new Request(`${PUBLIC_HOST}/api/shared-space?spaceId=s1`) as never);
    expect(res.status).toBe(401);
  });

  it("POST /api/shared-space validates spaceId", async () => {
    vi.mocked(authenticateAgentHeaders).mockReturnValue({ id: "agent-1" } as never);
    const res = await postSharedSpace(
      new Request(`${PUBLIC_HOST}/api/shared-space`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isShared: true }),
      }) as never
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/tool-attention/record rejects unauthenticated agents", async () => {
    vi.mocked(authenticateAgentHeaders).mockReturnValueOnce(null);
    const res = await postToolAttentionRecord(
      new Request(`${PUBLIC_HOST}/api/tool-attention/record`, {
        method: "POST",
        body: JSON.stringify({ toolId: "t", outcome: "ok" }),
      })
    );
    expect(res.status).toBe(401);
  });

  it("GET /api/security/report returns audit summary JSON", async () => {
    const res = await getSecurityReport(new Request(`${PUBLIC_HOST}/api/security/report`) as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { summary: { status: string } };
    expect(["clear", "watch", "attention"]).toContain(body.summary.status);
  });

  it("GET /api/cron-health lists jobs", async () => {
    const res = await getCronHealth();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; jobs: unknown[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.jobs)).toBe(true);
  });

  it("POST /api/cron-health requires registry write on public host", async () => {
    vi.mocked(authorizeRegistryWrite).mockReturnValueOnce(false);
    const res = await postCronHealth(
      new Request(`${PUBLIC_HOST}/api/cron-health`, {
        method: "POST",
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/memory-lifecycle/vault requires registry write", async () => {
    vi.mocked(authorizeRegistryWrite).mockReturnValueOnce(false);
    const res = await postMemoryLifecycleVault(
      new Request(`${PUBLIC_HOST}/api/memory-lifecycle/vault`, { method: "POST", body: "{}" })
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/memory-lifecycle/retention requires registry write", async () => {
    vi.mocked(authorizeRegistryWrite).mockReturnValueOnce(false);
    const res = await postMemoryLifecycleRetention(
      new Request(`${PUBLIC_HOST}/api/memory-lifecycle/retention`, { method: "POST", body: "{}" })
    );
    expect(res.status).toBe(403);
  });

  it("GET /api/seal/proposals/[id] requires session", async () => {
    vi.mocked(authenticateUser).mockResolvedValueOnce(null);
    const res = await getSealProposalById(new Request(`${PUBLIC_HOST}/api/seal/proposals/p1`) as never, {
      params: Promise.resolve({ id: "p1" }),
    });
    expect(res.status).toBe(401);
  });

  it("GET /api/workspace/prompt requires agent auth", async () => {
    vi.mocked(authenticateAgentHeaders).mockReturnValueOnce(null);
    const res = await getWorkspacePrompt(new Request(`${PUBLIC_HOST}/api/workspace/prompt`) as never);
    expect(res.status).toBe(401);
  });

  it("GET /api/escalations requires reviewer session", async () => {
    vi.mocked(authenticateUser).mockResolvedValueOnce(null);
    const res = await getEscalations(new Request(`${PUBLIC_HOST}/api/escalations`) as never);
    expect(res.status).toBe(403);
  });

  it("GET /api/library/freshness requires authenticated user", async () => {
    vi.mocked(authenticateUser).mockResolvedValueOnce(null);
    const res = await getLibraryFreshness(new Request(`${PUBLIC_HOST}/api/library/freshness`) as never);
    expect(res.status).toBe(401);
  });

  it("POST /api/paperclip/activity rejects malformed payloads", async () => {
    const res = await postPaperclipActivity(
      new Request(`${PUBLIC_HOST}/api/paperclip/activity`, {
        method: "POST",
        body: JSON.stringify({}),
      }) as never
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("GET /api/agent-checkpoints/metrics requires registry write", async () => {
    vi.mocked(authorizeRegistryWrite).mockReturnValueOnce(false);
    const res = await getAgentCheckpointMetrics(new Request(`${PUBLIC_HOST}/api/agent-checkpoints/metrics`));
    expect(res.status).toBe(403);
  });

  it("GET /api/memory/health accepts agent headers", async () => {
    vi.mocked(authorizeRegistryWrite).mockReturnValueOnce(false);
    vi.mocked(authenticateAgentHeaders).mockReturnValueOnce({ id: "agent-health" } as never);
    const res = await getMemoryHealth(
      new Request(`${PUBLIC_HOST}/api/memory/health`, { headers: { "x-agent-id": "agent-health" } })
    );
    expect(res.status).toBe(200);
  });

  it("GET /api/memory/health rejects unauthenticated callers", async () => {
    vi.mocked(authorizeRegistryWrite).mockReturnValueOnce(false);
    vi.mocked(authenticateAgentHeaders).mockReturnValueOnce(null);
    const res = await getMemoryHealth(new Request(`${PUBLIC_HOST}/api/memory/health`));
    expect(res.status).toBe(403);
  });

  it("GET /api/seal/proposals lists proposals for authenticated users", async () => {
    vi.mocked(authenticateUser).mockResolvedValueOnce({
      userId: "u1",
      role: "operator",
      email: "",
      displayName: "",
      tenantId: "default",
    });
    const res = await getSealProposals(new Request(`${PUBLIC_HOST}/api/seal/proposals`) as never);
    expect(res.status).toBe(200);
  });

  it("POST /api/policy/knowledge requires operator session", async () => {
    vi.mocked(authenticateUser).mockResolvedValueOnce(null);
    const res = await postPolicyKnowledge(
      new Request(`${PUBLIC_HOST}/api/policy/knowledge`, { method: "POST", body: "{}" }) as never
    );
    expect(res.status).toBe(401);
  });

  it("POST /api/audit/knowledge rejects missing agent key", async () => {
    const res = await postAuditKnowledge(
      new Request(`${PUBLIC_HOST}/api/audit/knowledge`, { method: "POST", body: "{}" }) as never
    );
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it("POST /api/skills/review requires authenticated user", async () => {
    vi.mocked(authenticateUser).mockResolvedValueOnce(null);
    const res = await postSkillsReview(
      new Request(`${PUBLIC_HOST}/api/skills/review`, { method: "POST", body: "{}" }) as never
    );
    expect(res.status).toBe(401);
  });

  it("GET /api/space-cache/history requires agent auth", async () => {
    vi.mocked(authenticateAgentHeaders).mockReturnValueOnce(null);
    const res = await getSpaceCacheHistory(new Request(`${PUBLIC_HOST}/api/space-cache/history?spaceId=s1`) as never);
    expect(res.status).toBe(401);
  });

  it("GET /api/shared-space/history requires agent auth", async () => {
    vi.mocked(authenticateAgentHeaders).mockReturnValueOnce(null);
    const res = await getSharedSpaceHistory(new Request(`${PUBLIC_HOST}/api/shared-space/history?spaceId=s1`) as never);
    expect(res.status).toBe(401);
  });

  it("GET /api/model-routing/recommendations returns ranked models", async () => {
    const res = await getModelRoutingRecommendations(
      new Request(`${PUBLIC_HOST}/api/model-routing/recommendations?taskType=engineering`) as never
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recommendations: unknown[] };
    expect(Array.isArray(body.recommendations)).toBe(true);
  });

  it("POST /api/skills/pins/:agent/rollback validates JSON body on public host", async () => {
    const res = await postSkillsPinRollback(
      new Request(`${PUBLIC_HOST}/api/skills/pins/my-agent/rollback`, {
        method: "POST",
        body: "not-json",
      }),
      { params: Promise.resolve({ agent: "my-agent" }) }
    );
    expect(res.status).toBe(401);
  });

  it("GET /api/activity returns event feed JSON", async () => {
    const res = await getActivity();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: unknown[] };
    expect(Array.isArray(body.events)).toBe(true);
  });

  it("GET /api/operations/noc returns operator metrics envelope", async () => {
    const res = await getOperationsNoc(new Request(`${PUBLIC_HOST}/api/operations/noc`) as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
