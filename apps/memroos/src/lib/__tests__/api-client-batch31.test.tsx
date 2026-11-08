import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
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

describe("api-client batch31 — audit and escalation query params", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let queryClient: QueryClient;

  beforeEach(() => {
    fetchMock = vi.fn(async () => jsonResponse({ entries: [], total: 0 }));
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

  it("useAuditEntries serializes full filter set", async () => {
    const filter = {
      agentId: "agent-b31",
      eventType: "skillforge.approved",
      actorId: "op-b31",
      tenantId: "tenant-b31",
      from: "2026-11-01T00:00:00.000Z",
      to: "2026-11-08T00:00:00.000Z",
      limit: 50,
      cursor: "cursor-b31",
    };
    const { result, unmount } = renderHook(() => api.useAuditEntries(filter), { wrapper: wrap(queryClient) });
    await waitFor(() => expect(result.current.data).toBeDefined());
    const url = String(fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/audit"))?.[0]);
    expect(url).toContain("agentId=agent-b31");
    expect(url).toContain("eventType=");
    expect(url).toContain("cursor=cursor-b31");
    unmount();
  });

  it("useAuditExportUrl builds export query string", () => {
    const url = renderHook(
      () =>
        api.useAuditExportUrl(
          {
            agentId: "agent-b31",
            eventType: "hil",
            actorId: "op",
            tenantId: "default-tenant",
            from: "2026-11-01",
            to: "2026-11-08",
          },
          "csv",
        ),
      { wrapper: wrap(queryClient) },
    ).result.current;
    expect(url).toContain("/api/audit/export?");
    expect(url).toContain("format=csv");
    expect(url).toContain("agentId=agent-b31");
  });

  it("useEscalations serializes status, tenant, and limit", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/escalations")) {
        return jsonResponse({ escalations: [], timestamp: "t" });
      }
      return jsonResponse({});
    });
    const { result, unmount } = renderHook(
      () => api.useEscalations({ status: "open", tenantId: "tenant-b31", limit: 5 }),
      { wrapper: wrap(queryClient) },
    );
    await waitFor(() => expect(result.current.data).toBeDefined());
    const url = String(fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/escalations"))?.[0]);
    expect(url).toContain("status=open");
    expect(url).toContain("tenantId=tenant-b31");
    expect(url).toContain("limit=5");
    unmount();
  });
});
