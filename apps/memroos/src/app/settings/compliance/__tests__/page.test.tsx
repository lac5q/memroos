import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, mutations: { retry: false } } } });
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
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/admin/compliance") && (!init || init.method === undefined)) {
          return {
            ok: true,
            json: async () => ({ compliance: COMPLIANCE, timestamp: "2026-07-01T00:00:00.000Z" }),
          } as Response;
        }
        if (url.endsWith("/api/admin/compliance") && init?.method === "PUT") {
          const body = JSON.parse(String(init.body)) as { auditRetentionDays: number };
          return {
            ok: true,
            json: async () => ({
              compliance: { ...COMPLIANCE, auditRetentionDays: body.auditRetentionDays },
              timestamp: "2026-07-02T00:00:00.000Z",
            }),
          } as Response;
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
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

  it("saves compliance controls from the form", async () => {
    wrap(<ComplianceSettingsPage />);
    await waitFor(() => expect(screen.getByLabelText("Audit retention days")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Data residency mode"));
    fireEvent.change(screen.getByLabelText("Audit retention days"), { target: { value: "120" } });
    fireEvent.change(screen.getByLabelText("Judge provider"), { target: { value: "vllm" } });
    fireEvent.change(screen.getByLabelText("Local judge endpoint"), {
      target: { value: "http://judge.test.local:8000/v1" },
    });
    fireEvent.change(screen.getByLabelText("Enabled adapters"), { target: { value: "slack, gmail" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText("Compliance controls saved.")).toBeInTheDocument();
    });
  });
});
