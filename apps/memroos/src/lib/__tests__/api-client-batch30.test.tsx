import React from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "@/lib/api-client";

function wrap(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("api-client batch30 — editOrchestrationHil non-422 errors", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let queryClient: QueryClient;

  beforeEach(() => {
    fetchMock = vi.fn();
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

  it("throws with status code when error JSON cannot be parsed (line 1316)", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("broken json batch30");
      },
    } as Response);
    const { result, unmount } = renderHook(() => api.useEditOrchestrationHilMutation(), {
      wrapper: wrap(queryClient),
    });
    let thrown: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ id: "hil-b30", patch: { taskSummary: "x" } });
      } catch (error) {
        thrown = error;
      }
    });
    expect(String(thrown)).toMatch(/500/);
    unmount();
  });
});
