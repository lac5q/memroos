import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { randomUUID } from "node:crypto";
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

describe("api-client batch35b — filtered queries and export URLs", () => {
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

  it("useBusinessOutcomeEvents builds full query string (1994-2004)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ events: [], count: 0, timestamp: "t" }));
    const filter = {
      correlationId: `corr-b35b-${randomUUID().slice(0, 8)}`,
      agentId: "codex",
      since: "2026-11-01T00:00:00.000Z",
      until: "2026-11-12T00:00:00.000Z",
      limit: 15,
    };
    const { result, unmount } = renderHook(() => api.useBusinessOutcomeEvents(filter), {
      wrapper: wrap(queryClient),
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("correlationId=");
    expect(url).toContain("agentId=codex");
    expect(url).toContain("limit=15");
    unmount();
  });

  it("useAuditEntries forwards cursor and tenant filters (2077-2091)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ entries: [], total: 0 }));
    const { result, unmount } = renderHook(
      () =>
        api.useAuditEntries({
          tenantId: "default-tenant",
          eventType: "memory.export",
          cursor: "cursor-b35b",
          limit: 5,
        }),
      { wrapper: wrap(queryClient) },
    );
    await waitFor(() => expect(result.current.data?.total).toBe(0));
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("tenantId=default-tenant");
    expect(url).toContain("eventType=memory.export");
    expect(url).toContain("cursor=cursor-b35b");
    unmount();
  });

  it("useAuditExportUrl builds csv download path (2098-2105)", () => {
    const { result, unmount } = renderHook(
      () =>
        api.useAuditExportUrl(
          { actorId: "operator-b35b", from: "2026-11-01", to: "2026-11-12" },
          "csv",
        ),
      { wrapper: wrap(queryClient) },
    );
    expect(result.current).toMatch(/^\/api\/audit\/export\?/);
    expect(result.current).toContain("format=csv");
    expect(result.current).toContain("actorId=operator-b35b");
    unmount();
  });

  it("useTriggerAdapterPollMutation invalidates l3-events (2016-2023)", async () => {
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    fetchMock.mockResolvedValueOnce(jsonResponse({ polled: [], timestamp: "t" }));
    const { result, unmount } = renderHook(() => api.useTriggerAdapterPollMutation(), {
      wrapper: wrap(queryClient),
    });
    await act(async () => {
      await result.current.mutateAsync({ since: "2026-11-01T00:00:00.000Z", adapters: ["hubspot"] });
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["l3-events"] });
    unmount();
  });

  it("useOperationsNoc encodes workspace filter (661+)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ panels: {}, timestamp: "t" }));
    const { result, unmount } = renderHook(() => api.useOperationsNoc({ window: "7d", workspace: "local" }), {
      wrapper: wrap(queryClient),
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("workspace=local");
    expect(url).toContain("window=7d");
    unmount();
  });
});
