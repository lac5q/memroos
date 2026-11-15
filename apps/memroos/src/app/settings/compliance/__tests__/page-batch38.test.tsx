/**
 * @vitest-environment jsdom
 */
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import ComplianceSettingsPage from "../page";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const COMPLIANCE = {
  dataResidencyEnabled: false,
  judgeProvider: "ollama",
  judgeModel: "llama",
  judgeModelFamily: "llama3",
  judgeEndpoint: null as string | null,
  judgeEndpointLocal: false,
  auditRetentionDays: 30,
  enabledAdapters: ["slack"],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ComplianceSettingsPage batch38", () => {
  it("shows loading copy before the compliance query resolves (68–69)", async () => {
    let resolveGet: (value: Response) => void = () => {};
    const getDeferred = new Promise<Response>((resolve) => {
      resolveGet = resolve;
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/admin/compliance") && !init?.method) {
          return getDeferred;
        }
        throw new Error(`unexpected ${url}`);
      }),
    );

    wrap(<ComplianceSettingsPage />);
    expect(screen.getByText(/Loading compliance posture/i)).toBeInTheDocument();

    resolveGet({
      ok: true,
      json: async () => ({ compliance: COMPLIANCE, timestamp: "2026-07-01T00:00:00.000Z" }),
    } as Response);
    await waitFor(() => expect(screen.getByLabelText("Judge model family")).toBeInTheDocument());
  });

  it("surfaces PUT error body and success toast (46–47, 211)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/admin/compliance") && (!init || !init.method)) {
          return {
            ok: true,
            json: async () => ({ compliance: COMPLIANCE, timestamp: "2026-07-01T00:00:00.000Z" }),
          } as Response;
        }
        if (url.endsWith("/api/admin/compliance") && init?.method === "PUT") {
          return {
            ok: false,
            status: 422,
            json: async () => ({ error: "batch38 compliance rejected" }),
          } as Response;
        }
        throw new Error(`unexpected ${url}`);
      }),
    );

    wrap(<ComplianceSettingsPage />);
    await waitFor(() => expect(screen.getByLabelText("Judge model family")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText("batch38 compliance rejected")).toBeInTheDocument());

    vi.mocked(fetch).mockImplementation(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/admin/compliance") && (!init || !init.method)) {
        return {
          ok: true,
          json: async () => ({ compliance: COMPLIANCE, timestamp: "2026-07-03T00:00:00.000Z" }),
        } as Response;
      }
      if (url.endsWith("/api/admin/compliance") && init?.method === "PUT") {
        return {
          ok: true,
          json: async () => ({ compliance: COMPLIANCE, timestamp: "2026-07-03T00:00:00.000Z" }),
        } as Response;
      }
      throw new Error(`unexpected ${url}`);
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText("Compliance controls saved.")).toBeInTheDocument());
  });
});