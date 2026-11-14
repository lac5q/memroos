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

describe("ComplianceSettingsPage batch37", () => {
  it("initializes judge endpoint input when judgeEndpoint is null (branch 94)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.endsWith("/api/admin/compliance")) {
          return {
            ok: true,
            json: async () => ({ compliance: COMPLIANCE, timestamp: "2026-07-01T00:00:00.000Z" }),
          } as Response;
        }
        throw new Error(`unexpected ${url}`);
      }),
    );

    wrap(<ComplianceSettingsPage />);
    await waitFor(() => expect(screen.getByLabelText("Judge model family")).toBeInTheDocument());
    expect(screen.getByLabelText("Local judge endpoint")).toHaveValue("");
  });

  it("shows Saving on the submit button while the PUT is in flight (branch 219)", async () => {
    let resolvePut: (value: Response) => void = () => {};
    const putDeferred = new Promise<Response>((resolve) => {
      resolvePut = resolve;
    });

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
          return putDeferred;
        }
        throw new Error(`unexpected ${url}`);
      }),
    );

    wrap(<ComplianceSettingsPage />);
    await waitFor(() => expect(screen.getByLabelText("Judge model family")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Saving" })).toBeDisabled());

    resolvePut({
      ok: true,
      json: async () => ({ compliance: COMPLIANCE, timestamp: "2026-07-02T00:00:00.000Z" }),
    } as Response);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
  });
});