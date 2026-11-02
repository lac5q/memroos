import React from "react";
import { act, renderHook } from "@testing-library/react";
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

describe("api-client batch23 — hil non-422 errors and QMD HTTP failures", () => {
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

  it("editOrchestrationHil throws for non-422 HTTP failures", async () => {
    const { result, unmount } = renderHook(() => api.useEditOrchestrationHilMutation(), {
      wrapper: wrap(queryClient),
    });
    fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return jsonResponse({ error: "server exploded" }, 500);
      }
      return jsonResponse({ ok: true });
    });
    let thrown: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ id: "hil-b23", patch: { taskSummary: "x" } });
      } catch (error) {
        thrown = error;
      }
    });
    expect(String(thrown)).toMatch(/server exploded/);
    unmount();
  });

  it("useTriggerQmdUpdate records failed event when response is not ok", async () => {
    fetchMock.mockResolvedValueOnce(new Response("bad gateway", { status: 502 }));
    const { result, unmount } = renderHook(() => api.useTriggerQmdUpdate());
    await act(async () => {
      await result.current.trigger();
    });
    expect(result.current.events[0]).toMatchObject({ type: "failed" });
    expect(String(result.current.events[0]?.error)).toMatch(/HTTP 502/);
    unmount();
  });
});
