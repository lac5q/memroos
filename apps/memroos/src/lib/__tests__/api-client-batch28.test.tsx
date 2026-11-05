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

describe("api-client batch28 — KPI events, NOC errors, adapter poll", () => {
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

  it("useBusinessOutcomeEvents serializes correlation and limit filters", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/l3/events")) {
        return jsonResponse({ events: [], count: 0, timestamp: "t" });
      }
      return jsonResponse({});
    });
    const filter = {
      correlationId: "corr-batch28",
      agentId: "agent-batch28",
      since: "2026-06-01T00:00:00.000Z",
      until: "2026-06-30T00:00:00.000Z",
      limit: 12,
    };
    const { result, unmount } = renderHook(() => api.useBusinessOutcomeEvents(filter), {
      wrapper: wrap(queryClient),
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/l3/events"));
    const url = String(call?.[0]);
    expect(url).toContain("correlationId=corr-batch28");
    expect(url).toContain("agentId=agent-batch28");
    expect(url).toContain("limit=12");
    unmount();
  });

  it("useOperationsNoc surfaces numeric status when error JSON is not a string", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: "noc_down" } }, 503));
    const { result, unmount } = renderHook(
      () => api.useOperationsNoc({ window: "7d", workspace: "remote" }),
      { wrapper: wrap(queryClient) },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(String(result.current.error)).toMatch(/503/);
    unmount();
  });

  it("useTriggerAdapterPollMutation invalidates l3-events after success", async () => {
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/api/l3/poll") && init?.method === "POST") {
        return jsonResponse({ ok: true, adaptersPolled: 1, timestamp: "t" });
      }
      return jsonResponse({});
    });
    const { result, unmount } = renderHook(() => api.useTriggerAdapterPollMutation(), {
      wrapper: wrap(queryClient),
    });
    await act(async () => {
      await result.current.mutateAsync({ since: "2026-06-01T00:00:00.000Z", adapters: ["hubspot"] });
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["l3-events"] });
    unmount();
  });
});
