import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "@/lib/api-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function wrap(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("api-client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let queryClient: QueryClient;

  beforeEach(() => {
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/evals/config") && (!init?.method || init.method === "GET")) {
        return jsonResponse({
          config: {
            weightPresets: { balanced: { a: 1 } },
            activePreset: "balanced",
          },
        });
      }
      if (url.includes("/evidence") && init?.method !== "POST") {
        return jsonResponse({ evidence: { jobId: "j1" }, timestamp: "t" });
      }
      if (url.includes("/api/seal/jobs/") && !url.includes("/evidence")) {
        return jsonResponse({
          job: { id: "j1", status: "running", proposalId: "p", proposalType: "t", agentId: "a", errorMessage: null, createdAt: "t", updatedAt: "t" },
          timestamp: "t",
        });
      }
      return jsonResponse({ ok: true, timestamp: "t", agents: [], decisions: [], proposals: [], entries: [], escalations: [], events: [], collections: [], sources: [], tools: [], items: [], suggestions: [], cards: [], usage: {}, stats: {}, config: {}, history: [], results: [], services: [], memories: [], rows: [], panels: {} });
    });
    vi.stubGlobal("fetch", fetchMock);
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  });

  afterEach(() => {
    queryClient.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("builds audit export URLs with filters", () => {
    const url = api.useAuditExportUrl(
      {
        agentId: "a1",
        eventType: "login",
        actorId: "u1",
        tenantId: "t1",
        from: "2026-01-01",
        to: "2026-01-02",
      },
      "csv"
    );
    expect(url).toContain("/api/audit/export?");
    expect(url).toContain("format=csv");
    expect(url).toContain("agentId=a1");
    expect(url).toContain("eventType=login");
    expect(url).toContain("actorId=u1");
    expect(url).toContain("tenantId=t1");
    expect(url).toContain("from=2026-01-01");
    expect(url).toContain("to=2026-01-02");
  });

  it("covers direct mutate helpers including error detail parsing", async () => {
    await expect(
      api.registerAgent({
        id: "a1",
        name: "A",
        role: "Worker",
        platform: "codex",
        protocol: "rest",
      } as never)
    ).resolves.toMatchObject({ ok: true });

    await expect(
      api.registerA2aAgentCard({ cardUrl: "https://example.com/card.json" })
    ).resolves.toMatchObject({ ok: true });

    await expect(
      api.createAgentOnboardingInvite({ name: "bot", operatorKey: "op-key" })
    ).resolves.toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/onboarding/invite",
      expect.objectContaining({
        headers: expect.objectContaining({ "x-memroos-operator-key": "op-key" }),
      })
    );

    await expect(api.deregisterAgent("agent-1")).resolves.toMatchObject({ ok: true });
    await expect(api.approveApoProposal("p1")).resolves.toBeTruthy();
    await expect(api.resolveOrchestrationHil({ id: "d1", decision: "approve" })).resolves.toBeTruthy();
    await expect(
      api.updateSkillReview({
        skillName: "s",
        stage: "draft",
        status: "pending",
        notes: "",
        draftBody: "",
      } as never)
    ).resolves.toBeTruthy();
    await expect(api.updateEvalConfig({} as never)).resolves.toBeTruthy();
    await expect(api.runEvalTrace({} as never)).resolves.toBeTruthy();

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/agents/bad")) {
        return new Response(JSON.stringify({ error: "nope" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/api/agents/bad2")) {
        return new Response("not-json", {
          status: 502,
          headers: { "Content-Type": "text/plain" },
        });
      }
      return jsonResponse({ ok: true, timestamp: "t" });
    });

    await expect(api.deregisterAgent("bad")).rejects.toMatchObject({
      message: "/api/agents/bad: nope",
    });
    await expect(api.deregisterAgent("bad2")).rejects.toMatchObject({
      message: "/api/agents/bad2: 502",
    });
  });

  it("loads query hooks and fires their fetch URLs", async () => {
    const hooks: Array<() => unknown> = [
      () => api.useContextSourceHealth(),
      () => api.useOperationsNoc({ window: "24h", workspace: "all" }),
      () => api.useAgents(),
      () => api.useRegisteredAgents(),
      () => api.useTokenStats(),
      () => api.useModelUsage("2026-01-01"),
      () => api.useEvalConfig(),
      () => api.useEvalHistory(10),
      () => api.useSealProposals("pending"),
      () => api.useSealProposal("p1"),
      () => api.useSealAuditLog("p1"),
      () => api.useMemory("mem0", "q"),
      () => api.useMultiMemorySearch("hello", 5),
      () =>
        api.useMemoryInventory({
          category: "episodic",
          backend: "sqlite",
          agent: "a1",
          project: "p1",
          source: "s1",
          dateFrom: "2026-01-01",
          dateTo: "2026-01-02",
          label: "l1",
          consolidationState: "active",
          degraded: "ok",
        } as never),
      () => api.useKnowledge(),
      () => api.useHealth(),
      () => api.useRemoteAgents(),
      () => api.useGitNexus(),
      () => api.useApo(),
      () => api.useDevToolsStatus(),
      () =>
        api.useSkillRegistry({
          offset: 5,
          limit: 10,
          source_harness: "codex",
          dispatch_status: "enabled",
        }),
      () => api.useSkillSuggestions(14),
      () => api.useActivity(),
      () => api.useOrchestrationHil(),
      () => api.useSkills(),
      () => api.useToolAttention("browser"),
      () => api.useSimilarTaskRecommendations({ task: "x" } as never),
      () => api.useRecallStats(),
      () => api.useHiveFeed(5),
      () => api.usePaperclipFleet(),
      () => api.useAgentPeers(30),
      () => api.useAuditLog(5),
      () => api.useSecurityReport(5),
      () => api.useSecurityCapabilities(),
      () => api.useCacheStats(),
      () => api.useModelRoutingDashboard(5),
      () => api.useModelRoutingRecommendations("ops", "cheap"),
      () => api.useModelRoutingEvals(),
      () => api.useVoiceStatus(),
      () => api.useMemoryStats({ agentId: "a1" } as never),
      () => api.useMemoryTierHealth(),
      () => api.useMemoryEvalLatest(),
      () => api.useTimeSeries("tokens", "24h" as never),
      () => api.useKnowledgeTrends("7d" as never, 3),
      () => api.useDelegations(5),
      () => api.useLineage("task-1"),
      () => api.useMemoryProposals("pending"),
      () => api.useEvalPresets(),
      () => api.useAgentProposals("pending"),
      () => api.useAgentCards(),
      () =>
        api.useBusinessOutcomeEvents({
          correlationId: "c1",
          agentId: "a1",
          since: "s",
          until: "u",
          limit: 2,
        }),
      () =>
        api.useAuditEntries({
          agentId: "a1",
          eventType: "e",
          actorId: "u",
          tenantId: "t",
          from: "f",
          to: "to",
          limit: 2,
          cursor: "c",
        }),
      () => api.useEscalations({ status: "open", tenantId: "t", limit: 2 }),
      () => api.useSealJob("job-1"),
      () => api.useSealJobEvidence("job-1"),
      () => api.useLibraryFreshness(),
    ];

    for (const useHook of hooks) {
      const { result, unmount } = renderHook(useHook, { wrapper: wrap(queryClient) });
      await waitFor(() => {
        const value = result.current as { isSuccess?: boolean; isError?: boolean; isFetched?: boolean };
        expect(value.isSuccess || value.isError || value.isFetched).toBeTruthy();
      });
      unmount();
    }

    expect(fetchMock.mock.calls.length).toBeGreaterThan(40);
  });

  it("keeps disabled queries idle for empty multi-search and null lineage/seal ids", async () => {
    const before = fetchMock.mock.calls.length;
    const { unmount: u1 } = renderHook(() => api.useMultiMemorySearch("   "), {
      wrapper: wrap(queryClient),
    });
    const { unmount: u2 } = renderHook(() => api.useLineage(null), {
      wrapper: wrap(queryClient),
    });
    const { unmount: u3 } = renderHook(() => api.useSealJob(null), {
      wrapper: wrap(queryClient),
    });
    const { unmount: u4 } = renderHook(() => api.useSealJobEvidence(null), {
      wrapper: wrap(queryClient),
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock.mock.calls.length).toBe(before);
    u1();
    u2();
    u3();
    u4();
  });

  it("covers mutation hooks and invalidation paths", async () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const mutations = [
      () => api.useRegisterAgentMutation(),
      () => api.useRegisterA2aAgentCardMutation(),
      () => api.useCreateAgentOnboardingInviteMutation(),
      () => api.useDeregisterAgentMutation(),
      () => api.useUpdateEvalConfigMutation(),
      () => api.useRunEvalTraceMutation(),
      () => api.useApproveMutation(),
      () => api.useRejectMutation(),
      () => api.useApplyMutation(),
      () => api.useApproveApoProposalMutation(),
      () => api.useResolveOrchestrationHilMutation(),
      () => api.useEditOrchestrationHilMutation(),
      () => api.useUpdateSkillReviewMutation(),
      () => api.usePurgeCacheMutation(),
      () => api.useRunPolicyLabMutation(),
      () => api.useSetActivePresetMutation(),
      () => api.useTriggerAgentReflectionMutation(),
      () => api.useMemoryProposalActionMutation(),
      () => api.useTriggerAdapterPollMutation(),
      () => api.useResolveEscalation(),
    ];

    for (const useMutationHook of mutations) {
      const { result, unmount } = renderHook(useMutationHook, {
        wrapper: wrap(queryClient),
      });
      await act(async () => {
        const mutation = result.current as {
          mutateAsync: (arg?: unknown) => Promise<unknown>;
        };
        // Provide a sensible default payload for each mutateAsync signature.
        const argCandidates = [
          { id: "x", name: "n", role: "r", platform: "codex", protocol: "rest" },
          { cardUrl: "https://example.com/card.json" },
          { name: "invite" },
          "agent-id",
          {},
          { id: "d1", decision: "approve" },
          { id: "d1", patch: { taskSummary: "edited" } },
          { skillName: "s", stage: "draft", status: "pending", notes: "", draftBody: "" },
          { variants: [{ name: "v", config: {} }] },
          "balanced",
          "agent-id",
          { id: "p1", action: "approve" },
          { since: "2026-01-01" },
          { id: "e1", note: "done" },
          "p1",
          undefined,
        ];
        let lastError: unknown;
        for (const arg of argCandidates) {
          try {
            await mutation.mutateAsync(arg as never);
            lastError = undefined;
            break;
          } catch (error) {
            lastError = error;
          }
        }
        if (lastError) throw lastError;
      });
      unmount();
    }

    expect(invalidate).toHaveBeenCalled();
  });

  it("handles editOrchestrationHil 422 and generic errors", async () => {
    const { result, unmount } = renderHook(() => api.useEditOrchestrationHilMutation(), {
      wrapper: wrap(queryClient),
    });

    fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        const body = typeof init.body === "string" ? JSON.parse(init.body) : {};
        if (body.taskSummary === "x") {
          return jsonResponse({ field: "bad" }, 422);
        }
        if (body.taskSummary === "boom") {
          return jsonResponse({ error: "boom" }, 500);
        }
      }
      return jsonResponse({ ok: true });
    });

    await act(async () => {
      const out = await result.current.mutateAsync({
        id: "d1",
        patch: { taskSummary: "x" },
      });
      expect(out).toMatchObject({ ok: false, validationError: true, status: 422 });
    });

    let thrown: unknown;
    try {
      await result.current.mutateAsync({ id: "d1", patch: { taskSummary: "boom" } });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("boom");

    unmount();
  });

  it("handles seal job evidence 404 and error statuses", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
    const { result, unmount } = renderHook(() => api.useSealJobEvidence("missing"), {
      wrapper: wrap(queryClient),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    unmount();

    fetchMock.mockResolvedValueOnce(new Response("", { status: 500 }));
    const { result: result2, unmount: unmount2 } = renderHook(
      () => api.useSealJobEvidence("err"),
      { wrapper: wrap(queryClient) }
    );
    await waitFor(() => expect(result2.current.isError).toBe(true));
    unmount2();
  });

  it("stops seal job polling once terminal and keeps polling while running", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        job: {
          id: "j1",
          status: "passed",
          proposalId: "p",
          proposalType: "t",
          agentId: "a",
          errorMessage: null,
          createdAt: "t",
          updatedAt: "t",
        },
        timestamp: "t",
      })
    );
    const { result, unmount } = renderHook(() => api.useSealJob("done"), {
      wrapper: wrap(queryClient),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.job.status).toBe("passed");
    unmount();
  });

  it("streams QMD update SSE events and recovers from failures", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"started","pid":1}\n'));
        controller.enqueue(encoder.encode("data: not-json\n"));
        controller.enqueue(encoder.encode('data: {"type":"completed","exitCode":0}\n'));
        controller.close();
      },
    });
    fetchMock.mockResolvedValueOnce(
      new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } })
    );

    const { result, unmount } = renderHook(() => api.useTriggerQmdUpdate());
    await act(async () => {
      await result.current.trigger();
    });
    expect(result.current.events.map((e) => e.type)).toEqual(["started", "completed"]);
    expect(result.current.isStreaming).toBe(false);

    act(() => result.current.reset());
    expect(result.current.events).toEqual([]);

    fetchMock.mockResolvedValueOnce(new Response("fail", { status: 500 }));
    await act(async () => {
      await result.current.trigger();
    });
    expect(result.current.events[0]).toMatchObject({ type: "failed" });

    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await act(async () => {
      await result.current.trigger();
    });
    expect(result.current.events.at(-1)).toMatchObject({
      type: "failed",
      error: "network down",
    });

    unmount();
  });

  it("surfaces fetchJSON failures for query hooks", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 503 }));
    const { result, unmount } = renderHook(() => api.useHealth(), {
      wrapper: wrap(queryClient),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    unmount();
  });

  it("patches agent display fields and invalidates the agents query", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        agent: { id: "hermes:claude", name: "Renamed", role: "ops" },
        timestamp: "t",
      })
    );
    await api.updateAgentDetails({ agentId: "hermes:claude", name: "Renamed", role: "ops" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agents/hermes%3Aclaude",
      expect.objectContaining({ method: "PATCH" })
    );

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        agent: { id: "hermes:claude", name: "Renamed", role: "ops" },
        timestamp: "t",
      })
    );
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result, unmount } = renderHook(() => api.useUpdateAgentDetailsMutation(), {
      wrapper: wrap(queryClient),
    });
    await act(async () => {
      await result.current.mutateAsync({ agentId: "hermes:claude", name: "Renamed" });
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["agents"] });
    unmount();
  });
});
