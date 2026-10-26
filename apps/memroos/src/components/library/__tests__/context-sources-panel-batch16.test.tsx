/**
 * @vitest-environment jsdom
 */
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

describe("ContextSourcesPanel batch16", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.useContextSourceHealth.mockReturnValue({
      data: { sources: [] },
      isLoading: false,
      error: null,
    });
    api.useTriggerQmdUpdate.mockReturnValue({
      events: [],
      isStreaming: false,
      trigger,
    });
    api.useLibraryFreshness.mockReturnValue({
      data: {
        collections: [
          { collection: "hourly", state: "live", ageMs: 3_600_000 },
          { collection: "daily", state: "stale", ageMs: 86_400_000 },
        ],
      },
      isLoading: false,
      error: null,
      refetch,
    });
  });

  it("formats index ages in hours and days", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ role: "reviewer" }),
      })),
    );

    render(<ContextSourcesPanel />);
    expect(screen.getByText("1h")).toBeInTheDocument();
    expect(screen.getByText("1d")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh Index" })).not.toBeInTheDocument();
  });

  it("renders qmd stream log lines for stderr, completed, and failed events", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ role: "operator" }),
      })),
    );
    api.useTriggerQmdUpdate.mockReturnValue({
      events: [
        { type: "stderr", line: "batch16 stderr line" },
        { type: "completed", exitCode: 0 },
        { type: "failed", error: "batch16 failed" },
      ],
      isStreaming: false,
      trigger,
    });

    render(<ContextSourcesPanel />);
    expect(screen.getByText("batch16 stderr line")).toBeInTheDocument();
    expect(screen.getByText(/Completed \(exit 0\)/)).toBeInTheDocument();
    expect(screen.getByText(/Failed: batch16 failed/)).toBeInTheDocument();

    const refresh = await screen.findByRole("button", { name: "Refresh Index" });
    fireEvent.click(refresh);
    await waitFor(() => expect(trigger).toHaveBeenCalled());
  });
});
