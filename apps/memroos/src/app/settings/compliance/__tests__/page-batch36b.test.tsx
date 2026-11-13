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
  judgeEndpoint: "http://localhost:11434/v1",
  judgeEndpointLocal: true,
  auditRetentionDays: 30,
  enabledAdapters: ["slack"],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ComplianceSettingsPage batch36b", () => {
  it("updateCompliance json().catch uses fallback error (46)", async () => {
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
            status: 500,
            json: async () => {
              throw new SyntaxError("invalid json");
            },
          } as Response;
        }
        throw new Error(`unexpected ${url}`);
      }),
    );
    wrap(<ComplianceSettingsPage />);
    await waitFor(() => expect(screen.getByLabelText("Judge model family")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText("Failed to update compliance controls")).toBeInTheDocument());
  });
});
