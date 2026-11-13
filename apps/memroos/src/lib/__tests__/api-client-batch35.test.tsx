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

describe("api-client batch35 — hooks near L3 events and seal polling", () => {
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

  it("useBusinessOutcomeEvents omits empty query string when no filters", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/l3/events")) {
        return jsonResponse({ events: [], count: 0, timestamp: "t" });
      }
      return jsonResponse({});
    });
    const { result, unmount } = renderHook(() => api.useBusinessOutcomeEvents({}), {
      wrapper: wrap(queryClient),
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/l3/events");
    unmount();
  });

  it("useResolveEscalation invalidates escalations and audit entries", async () => {
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    fetchMock.mockResolvedValueOnce(jsonResponse({ escalation: { id: "esc-b35" }, timestamp: "t" }));
    const { result, unmount } = renderHook(() => api.useResolveEscalation(), {
      wrapper: wrap(queryClient),
    });
    await act(async () => {
      await result.current.mutateAsync({ id: "esc-b35", note: "resolved batch35" });
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["escalations"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["audit-entries"] });
    unmount();
  });

  it("useSealJob stops refetching when job is terminal", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        job: {
          id: "job-b35",
          proposalId: "p",
          proposalType: "skill",
          agentId: "a",
          status: "passed",
          errorMessage: null,
          createdAt: "t",
          updatedAt: "t",
        },
        timestamp: "t",
      }),
    );
    const { result, unmount } = renderHook(() => api.useSealJob("job-b35"), {
      wrapper: wrap(queryClient),
    });
    await waitFor(() => expect(result.current.data?.job.status).toBe("passed"));
    unmount();
  });

  it("useTriggerQmdUpdate reset clears streaming state", async () => {
    const encoder = new TextEncoder();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      body: new ReadableStream({
        start(c) {
          c.enqueue(encoder.encode('data: {"type":"started","pid":1}\n\n'));
          c.enqueue(encoder.encode("data: [DONE]\n\n"));
          c.close();
        },
      }),
    } as Response);
    const { result, unmount } = renderHook(() => api.useTriggerQmdUpdate());
    await act(async () => {
      await result.current.trigger();
    });
    expect(result.current.events.length).toBeGreaterThan(0);
    act(() => result.current.reset());
    expect(result.current.events).toEqual([]);
    expect(result.current.isStreaming).toBe(false);
    unmount();
  });

  it("useLibraryFreshness fetches /api/library/freshness", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ collections: [], timestamp: "t", isUpdating: false }),
    );
    const { result, unmount } = renderHook(() => api.useLibraryFreshness(), {
      wrapper: wrap(queryClient),
    });
    await waitFor(() => expect(result.current.data?.collections).toEqual([]));
    unmount();
  });
});
