import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

import ComplianceSettingsPage from "../page";

const COMPLIANCE = {
  dataResidencyEnabled: true,
  judgeProvider: "ollama",
  judgeModel: "llama",
  judgeModelFamily: "llama3",
  judgeEndpoint: "http://judge.test.local:11434",
  judgeEndpointLocal: true,
  auditRetentionDays: 90,
  enabledAdapters: ["slack"],
};

describe("ComplianceSettingsPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ compliance: COMPLIANCE, timestamp: "2026-07-01T00:00:00.000Z" }),
      })),
    );
  });

  it("renders compliance stats after load", async () => {
    wrap(<ComplianceSettingsPage />);

    expect(screen.getByText("Compliance")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Local only")).toBeInTheDocument();
      expect(screen.getByText("90 days")).toBeInTheDocument();
    });
  });

  it("shows error when admin fetch fails", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);
    wrap(<ComplianceSettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Admin access required")).toBeInTheDocument();
    });
  });
});
