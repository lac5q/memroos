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

describe("api-client batch22 — hil 422 JSON, similar-task params, memory stats, QMD errors", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let queryClient: QueryClient;

  beforeEach(() => {
    fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
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

  it("editOrchestrationHil returns validationError when 422 body is not JSON", async () => {
    const { result, unmount } = renderHook(() => api.useEditOrchestrationHilMutation(), {
      wrapper: wrap(queryClient),
    });
    fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return new Response("not-json", { status: 422 });
      }
      return jsonResponse({ ok: true });
    });
    await act(async () => {
      const out = await result.current.mutateAsync({ id: "hil-b22", patch: { taskSummary: "x" } });
      expect(out).toMatchObject({ ok: false, validationError: true, status: 422, detail: null });
    });
    unmount();
  });

  it("useSimilarTaskRecommendations serializes task_type, repo, agent_id, and tags", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/tool-attention/similar")) {
        return jsonResponse({ suggestions: [], timestamp: "t" });
      }
      return jsonResponse({});
    });
    const { unmount } = renderHook(
      () =>
        api.useSimilarTaskRecommendations({
          task_type: "deploy",
          repo: "lac5q/memroos",
          agent_id: "codex-cli-agent",
          tags: ["memory", "eval"],
        }),
      { wrapper: wrap(queryClient) },
    );
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(0));
    const calledUrl = String(fetchMock.mock.calls.find((c) => String(c[0]).includes("similar"))?.[0]);
    expect(calledUrl).toContain("task_type=deploy");
    expect(calledUrl).toContain("repo=lac5q%2Fmemroos");
    expect(calledUrl).toContain("agent_id=codex-cli-agent");
    expect(calledUrl).toContain("tags=memory%2Ceval");
    unmount();
  });

  it("useMemoryStats adds window and workspace query params", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/memory-stats")) {
        return jsonResponse({ pendingUnconsolidated: 0, tierStats: [], timestamp: "t" });
      }
      return jsonResponse({});
    });
    const { unmount } = renderHook(
      () => api.useMemoryStats({ window: "week", workspace: "local" }),
      { wrapper: wrap(queryClient) },
    );
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(0));
    const url = String(fetchMock.mock.calls.find((c) => String(c[0]).includes("memory-stats"))?.[0]);
    expect(url).toMatch(/window=week/);
    expect(url).toContain("workspace=local");
    unmount();
  });

  it("useTriggerQmdUpdate records failed event when response is ok but body is missing", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    const { result, unmount } = renderHook(() => api.useTriggerQmdUpdate());
    await act(async () => {
      await result.current.trigger();
    });
    expect(result.current.events[0]).toMatchObject({ type: "failed" });
    expect(String(result.current.events[0]?.error)).toMatch(/HTTP 200/);
    unmount();
  });
});
