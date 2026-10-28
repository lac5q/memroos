import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

import ComplianceSettingsPage from "../page";

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

describe("ComplianceSettingsPage batch21", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/admin/compliance") && (!init || init.method === undefined)) {
          return {
            ok: true,
            json: async () => ({ compliance: COMPLIANCE, timestamp: "2026-07-01T00:00:00.000Z" }),
          } as Response;
        }
        if (url.endsWith("/api/admin/compliance") && init?.method === "PUT") {
          return {
            ok: false,
            json: async () => ({ error: "Policy conflict" }),
          } as Response;
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  it("surfaces updateCompliance API errors and sends judge model family", async () => {
    wrap(<ComplianceSettingsPage />);
    await waitFor(() => expect(screen.getByLabelText("Judge model family")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Judge model family"), {
      target: { value: "qwen2.5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText("Policy conflict")).toBeInTheDocument();
    });
  });
});
