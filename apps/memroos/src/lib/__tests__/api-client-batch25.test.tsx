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

describe("api-client batch25 — optional query params, HIL 422, QMD failure, registry filters", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let queryClient: QueryClient;

  beforeEach(() => {
    fetchMock = vi.fn(async () => jsonResponse({ ok: true, timestamp: "t" }));
    vi.stubGlobal("fetch", fetchMock);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  });

  afterEach(() => {
    queryClient.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("useModelUsage without since hits bare model-usage URL", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/model-usage")) {
        return jsonResponse({ usage: {}, timestamp: "t" });
      }
      return jsonResponse({});
    });
    const { unmount } = renderHook(() => api.useModelUsage(), { wrapper: wrap(queryClient) });
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(0));
    const url = String(fetchMock.mock.calls.find((c) => String(c[0]).includes("model-usage"))?.[0]);
    expect(url).toBe("/api/model-usage");
    unmount();
  });

  it("useSealAuditLog without proposalId omits query string", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/seal/audit")) {
        return jsonResponse({ entries: [], timestamp: "t" });
      }
      return jsonResponse({});
    });
    const { unmount } = renderHook(() => api.useSealAuditLog(), { wrapper: wrap(queryClient) });
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(0));
    const url = String(fetchMock.mock.calls.find((c) => String(c[0]).includes("seal/audit"))?.[0]);
    expect(url).not.toContain("?");
    unmount();
  });

  it("useMemory without filters still calls memory API", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/memory?")) {
        return jsonResponse({ timestamp: "t" });
      }
      return jsonResponse({});
    });
    const { unmount } = renderHook(() => api.useMemory(), { wrapper: wrap(queryClient) });
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(0));
    const url = String(fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/memory?"))?.[0]);
    expect(url).toBe("/api/memory?");
    unmount();
  });

  it("useToolAttention without query omits q param", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/tool-attention")) {
        return jsonResponse({ items: [], timestamp: "t" });
      }
      return jsonResponse({});
    });
    const { unmount } = renderHook(() => api.useToolAttention(), { wrapper: wrap(queryClient) });
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(0));
    const url = String(fetchMock.mock.calls.find((c) => String(c[0]).includes("tool-attention"))?.[0]);
    expect(url).not.toContain("q=");
    unmount();
  });

  it("useSkillRegistry without harness filters uses offset/limit only", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/skills/import")) {
        return jsonResponse({ skills: [], timestamp: "t" });
      }
      return jsonResponse({});
    });
    const { unmount } = renderHook(() => api.useSkillRegistry(), { wrapper: wrap(queryClient) });
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(0));
    const url = String(fetchMock.mock.calls.find((c) => String(c[0]).includes("skills/import"))?.[0]);
    expect(url).toContain("offset=0");
    expect(url).toContain("limit=20");
    expect(url).not.toContain("source_harness");
    unmount();
  });

  it("useMemoryProposals and useAgentProposals omit status when unset", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const s = String(input);
      if (s.includes("/api/memory/proposals")) {
        return jsonResponse({ proposals: [], timestamp: "t" });
      }
      if (s.includes("/api/agents/proposals")) {
        return jsonResponse({ proposals: [], timestamp: "t" });
      }
      return jsonResponse({});
    });
    const { unmount: u1 } = renderHook(() => api.useMemoryProposals(), { wrapper: wrap(queryClient) });
    const { unmount: u2 } = renderHook(() => api.useAgentProposals(), { wrapper: wrap(queryClient) });
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(1));
    const memUrl = String(fetchMock.mock.calls.find((c) => String(c[0]).includes("memory/proposals"))?.[0]);
    const agentUrl = String(fetchMock.mock.calls.find((c) => String(c[0]).includes("agents/proposals"))?.[0]);
    expect(memUrl).not.toContain("?");
    expect(agentUrl).not.toContain("?");
    u1();
    u2();
  });

  it("editOrchestrationHil returns validation payload on 422", async () => {
    fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return jsonResponse({ fieldErrors: { taskSummary: "too long" } }, 422);
      }
      return jsonResponse({});
    });
    const { result, unmount } = renderHook(() => api.useEditOrchestrationHilMutation(), {
      wrapper: wrap(queryClient),
    });
    let out: unknown;
    await act(async () => {
      out = await result.current.mutateAsync({ id: "hil-b25", patch: { taskSummary: "x" } });
    });
    expect(out).toMatchObject({ ok: false, validationError: true, status: 422 });
    unmount();
  });

  it("editOrchestrationHil uses string error body when present", async () => {
    fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return jsonResponse({ error: "hil locked" }, 409);
      }
      return jsonResponse({});
    });
    const { result, unmount } = renderHook(() => api.useEditOrchestrationHilMutation(), {
      wrapper: wrap(queryClient),
    });
    let thrown: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ id: "hil-b25-err", patch: { requiresApproval: false } });
      } catch (error) {
        thrown = error;
      }
    });
    expect(String(thrown)).toMatch(/hil locked/);
    unmount();
  });

  it("useTriggerQmdUpdate records failed event when response is not ok", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("forbidden", { status: 403, statusText: "Forbidden" }),
    );
    const { result, unmount } = renderHook(() => api.useTriggerQmdUpdate());
    await act(async () => {
      await result.current.trigger();
    });
    expect(result.current.events[0]).toMatchObject({ type: "failed" });
    expect(String(result.current.events[0]?.error)).toMatch(/HTTP 403/);
    unmount();
  });

  it("usePurgeCacheMutation posts empty body when tag is omitted", async () => {
    fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST" && String(_input).includes("/api/cache/purge")) {
        return jsonResponse({ ok: true, purged: 0, tag: null, timestamp: "t" });
      }
      return jsonResponse({});
    });
    const { result, unmount } = renderHook(() => api.usePurgeCacheMutation(), {
      wrapper: wrap(queryClient),
    });
    await act(async () => {
      await result.current.mutateAsync(undefined);
    });
    const call = fetchMock.mock.calls.find(
      (c) => String(c[0]).includes("cache/purge") && (c[1] as RequestInit)?.method === "POST",
    );
    expect(call?.[1]).toMatchObject({ body: "{}" });
    unmount();
  });

  it("useEvalPresets maps weight presets from eval config", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/evals/config")) {
        return jsonResponse({
          config: { weightPresets: { ops: { l1: 0.2, l2: 0.5, l3: 0.3 } }, activePreset: "ops" },
          timestamp: "t",
        });
      }
      return jsonResponse({});
    });
    const { result, unmount } = renderHook(() => api.useEvalPresets(), { wrapper: wrap(queryClient) });
    await waitFor(() => expect(result.current.data?.presets.ops).toBeDefined());
    expect(result.current.data?.activePreset).toBe("ops");
    unmount();
  });
});
