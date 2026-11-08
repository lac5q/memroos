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

describe("api-client batch27 — HIL errors, QMD body read, eval presets", () => {
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

  it("editOrchestrationHil throws with numeric status when error JSON is not a string", async () => {
    fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return jsonResponse({ error: { code: "locked" } }, 409);
      }
      return jsonResponse({});
    });
    const { result, unmount } = renderHook(() => api.useEditOrchestrationHilMutation(), {
      wrapper: wrap(queryClient),
    });
    let thrown: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ id: "hil-batch27", patch: { requiresApproval: true } });
      } catch (error) {
        thrown = error;
      }
    });
    expect(String(thrown)).toMatch(/409/);
    unmount();
  });

  it("useTriggerQmdUpdate records failed event when error body text cannot be read", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      body: null,
      text: async () => {
        throw new Error("body unreadable batch27");
      },
    } as Response);
    const { result, unmount } = renderHook(() => api.useTriggerQmdUpdate());
    await act(async () => {
      await result.current.trigger();
    });
    expect(result.current.events[0]).toMatchObject({ type: "failed" });
    expect(String(result.current.events[0]?.error)).toMatch(/HTTP 503/);
    unmount();
  });

  it("useEvalPresets defaults missing weight presets and active preset to empty/null", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/evals/config")) {
        return jsonResponse({ config: {}, timestamp: "t" });
      }
      return jsonResponse({});
    });
    const { result, unmount } = renderHook(() => api.useEvalPresets(), { wrapper: wrap(queryClient) });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.presets).toEqual({});
    expect(result.current.data?.activePreset).toBeNull();
    unmount();
  });

  it("useSetActivePresetMutation posts null active preset", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/api/evals/config") && init?.method === "POST") {
        return jsonResponse({ ok: true, config: { activePreset: null }, timestamp: "t" });
      }
      return jsonResponse({});
    });
    const { result, unmount } = renderHook(() => api.useSetActivePresetMutation(), {
      wrapper: wrap(queryClient),
    });
    await act(async () => {
      await result.current.mutateAsync(null);
    });
    const call = fetchMock.mock.calls.find(
      (c) => String(c[0]).includes("evals/config") && (c[1] as RequestInit)?.method === "POST",
    );
    expect(String(call?.[1]?.body)).toContain("active_preset");
    expect(String(call?.[1]?.body)).toContain("null");
    unmount();
  });
});
