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

describe("api-client batch26 — preset mutation, agent proposals filter, QMD catch", () => {
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

  it("useSetActivePresetMutation posts active preset to eval config", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/api/evals/config") && init?.method === "POST") {
        return jsonResponse({ ok: true, config: { activePreset: "ops" }, timestamp: "t" });
      }
      return jsonResponse({});
    });
    const { result, unmount } = renderHook(() => api.useSetActivePresetMutation(), {
      wrapper: wrap(queryClient),
    });
    await act(async () => {
      await result.current.mutateAsync("ops");
    });
    const call = fetchMock.mock.calls.find(
      (c) => String(c[0]).includes("evals/config") && (c[1] as RequestInit)?.method === "POST",
    );
    expect(String(call?.[1]?.body)).toContain("active_preset");
    unmount();
  });

  it("useAgentProposals with status adds query param", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/agents/proposals")) {
        return jsonResponse({ proposals: [], timestamp: "t" });
      }
      return jsonResponse({});
    });
    const { unmount } = renderHook(() => api.useAgentProposals("pending"), { wrapper: wrap(queryClient) });
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(0));
    const url = String(fetchMock.mock.calls.find((c) => String(c[0]).includes("agents/proposals"))?.[0]);
    expect(url).toContain("status=pending");
    unmount();
  });

  it("useTriggerAgentReflectionMutation posts reflect action", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/api/agents/proposals") && init?.method === "POST") {
        return jsonResponse({ ok: true, proposals: [], timestamp: "t" });
      }
      return jsonResponse({});
    });
    const { result, unmount } = renderHook(() => api.useTriggerAgentReflectionMutation(), {
      wrapper: wrap(queryClient),
    });
    await act(async () => {
      await result.current.mutateAsync("agent-b26");
    });
    const call = fetchMock.mock.calls.find(
      (c) => String(c[0]).includes("agents/proposals") && (c[1] as RequestInit)?.method === "POST",
    );
    expect(String(call?.[1]?.body)).toContain("reflect");
    unmount();
  });

  it("useTriggerQmdUpdate records catch-path failures when fetch throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network_down_b26"));
    const { result, unmount } = renderHook(() => api.useTriggerQmdUpdate());
    await act(async () => {
      await result.current.trigger();
    });
    expect(result.current.events[0]).toMatchObject({ type: "failed" });
    expect(String(result.current.events[0]?.error)).toMatch(/network_down_b26/);
    unmount();
  });

  it("useMemoryProposalActionMutation posts approve action", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/api/seal/proposals/") && init?.method === "POST") {
        return jsonResponse({ ok: true, proposal: { id: "p1", status: "approved" }, timestamp: "t" });
      }
      return jsonResponse({});
    });
    const { result, unmount } = renderHook(() => api.useMemoryProposalActionMutation(), {
      wrapper: wrap(queryClient),
    });
    await act(async () => {
      await result.current.mutateAsync({ id: "proposal-b26", action: "approve" });
    });
    const call = fetchMock.mock.calls.find(
      (c) => String(c[0]).includes("seal/proposals/proposal-b26") && (c[1] as RequestInit)?.method === "POST",
    );
    expect(String(call?.[1]?.body)).toContain("approve");
    unmount();
  });
});
