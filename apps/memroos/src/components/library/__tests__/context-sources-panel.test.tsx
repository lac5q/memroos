import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  useContextSourceHealth: vi.fn(),
  useLibraryFreshness: vi.fn(),
  useTriggerQmdUpdate: vi.fn(),
}));

const trigger = vi.fn().mockResolvedValue(undefined);
const refetch = vi.fn();

vi.mock("@/lib/api-client", () => ({
  useContextSourceHealth: api.useContextSourceHealth,
  useLibraryFreshness: api.useLibraryFreshness,
  useTriggerQmdUpdate: api.useTriggerQmdUpdate,
}));

import { ContextSourcesPanel } from "../context-sources-panel";

describe("ContextSourcesPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ role: "operator" }),
      })),
    );
    api.useTriggerQmdUpdate.mockReturnValue({
      events: [{ type: "started", pid: 123 }],
      isStreaming: false,
      trigger,
    });
    api.useLibraryFreshness.mockReturnValue({
      data: {
        collections: [{ collection: "playbooks", state: "live", ageMs: 120_000 }],
      },
      isLoading: false,
      error: null,
      refetch,
    });
  });

  it("renders context source rows", () => {
    api.useContextSourceHealth.mockReturnValue({
      data: {
        sources: [
          {
            id: "gmail",
            status: "ok",
            ageMinutes: 5,
            documentCount: 12,
            repairHint: "none",
          },
        ],
      },
      isLoading: false,
      error: null,
    });

    render(<ContextSourcesPanel />);
    expect(screen.getByText("Context Sources")).toBeInTheDocument();
    expect(screen.getByText("gmail")).toBeInTheDocument();
    expect(screen.getByText("Index Freshness")).toBeInTheDocument();
    expect(screen.getByText("playbooks")).toBeInTheDocument();
  });

  it("shows loading and error states", () => {
    api.useContextSourceHealth.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });
    const { rerender } = render(<ContextSourcesPanel />);
    expect(screen.getByText(/Loading context sources/i)).toBeInTheDocument();

    api.useContextSourceHealth.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("down"),
    });
    rerender(<ContextSourcesPanel />);
    expect(screen.getByText(/Failed to load context source health/i)).toBeInTheDocument();
  });

  it("lets operators refresh index and shows stream log", async () => {
    api.useContextSourceHealth.mockReturnValue({
      data: { sources: [] },
      isLoading: false,
      error: null,
    });
    render(<ContextSourcesPanel />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh Index" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Refresh Index" }));
    expect(trigger).toHaveBeenCalled();
    await waitFor(() => expect(refetch).toHaveBeenCalled());
    expect(screen.getByText(/qmd update started/i)).toBeInTheDocument();
  });
});
