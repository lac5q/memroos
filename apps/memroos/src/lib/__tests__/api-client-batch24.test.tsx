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

describe("api-client batch24 — mutate error shapes, inventory params, QMD SSE branches", () => {
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

  it("editOrchestrationHil uses status code when error body is not a string", async () => {
    const { result, unmount } = renderHook(() => api.useEditOrchestrationHilMutation(), {
      wrapper: wrap(queryClient),
    });
    fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return jsonResponse({ error: { code: 503 } }, 503);
      }
      return jsonResponse({ ok: true, editedFields: ["taskSummary"] });
    });
    let thrown: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ id: "hil-b24", patch: { taskSummary: "fail" } });
      } catch (error) {
        thrown = error;
      }
    });
    expect(String(thrown)).toMatch(/503/);
    unmount();
  });

  it("editOrchestrationHil returns success payload on 200", async () => {
    fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return jsonResponse({ ok: true, editedFields: ["requiresApproval"] });
      }
      return jsonResponse({});
    });
    const { result, unmount } = renderHook(() => api.useEditOrchestrationHilMutation(), {
      wrapper: wrap(queryClient),
    });
    await act(async () => {
      const out = await result.current.mutateAsync({
        id: "hil-b24-ok",
        patch: { requiresApproval: true },
      });
      expect(out).toMatchObject({ ok: true, editedFields: ["requiresApproval"] });
    });
    unmount();
  });

  it("createAgentOnboardingInvite omits operator header when key is absent", async () => {
    await api.createAgentOnboardingInvite({ name: "batch24-bot" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/onboarding/invite",
      expect.objectContaining({
        method: "POST",
        headers: expect.not.objectContaining({ "x-memroos-operator-key": expect.anything() }),
      }),
    );
  });

  it("useMemoryInventory skips all=all filters and hits bare inventory URL", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/memory-inventory")) {
        return jsonResponse({ rows: [], timestamp: "t", totals: {} });
      }
      return jsonResponse({});
    });
    const { unmount } = renderHook(
      () =>
        api.useMemoryInventory({
          category: "all",
          consolidationState: "all",
          degraded: "all",
        }),
      { wrapper: wrap(queryClient) },
    );
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(0));
    const url = String(fetchMock.mock.calls.find((c) => String(c[0]).includes("memory-inventory"))?.[0]);
    expect(url).toBe("/api/memory-inventory");
    unmount();
  });

  it("useSealProposals without status hits unfiltered proposals URL", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/seal/proposals")) {
        return jsonResponse({ proposals: [], timestamp: "t" });
      }
      return jsonResponse({});
    });
    const { unmount } = renderHook(() => api.useSealProposals(undefined), { wrapper: wrap(queryClient) });
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(0));
    const url = String(fetchMock.mock.calls.find((c) => String(c[0]).includes("seal/proposals"))?.[0]);
    expect(url).not.toContain("?");
    unmount();
  });

  it("useTriggerQmdUpdate records stdout/stderr frames and ok responses without body", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"stdout","line":"chunk"}\n'));
        controller.enqueue(encoder.encode('data: {"type":"stderr","line":"warn"}\n'));
        controller.enqueue(encoder.encode('data: {"type":"completed","exitCode":0}\n'));
        controller.close();
      },
    });
    fetchMock.mockResolvedValueOnce(
      new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    );

    const { result, unmount } = renderHook(() => api.useTriggerQmdUpdate());
    await act(async () => {
      await result.current.trigger();
    });
    expect(result.current.events.map((e) => e.type)).toEqual(["stdout", "stderr", "completed"]);

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await act(async () => {
      await result.current.trigger();
    });
    expect(result.current.events[0]).toMatchObject({ type: "failed" });
    expect(String(result.current.events[0]?.error)).toMatch(/HTTP 200/);
    unmount();
  });

  it("deregisterAgent falls back to numeric status when error JSON is missing", async () => {
    fetchMock.mockResolvedValueOnce(new Response("plain", { status: 502 }));
    await expect(api.deregisterAgent("agent-b24")).rejects.toMatchObject({
      message: "/api/agents/agent-b24: 502",
    });
  });
});
