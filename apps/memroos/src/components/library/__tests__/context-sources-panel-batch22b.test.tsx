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

describe("ContextSourcesPanel batch22b", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.useContextSourceHealth.mockReturnValue({
      data: {
        sources: [
          {
            id: "mem0",
            status: "stale",
            ageMinutes: 125,
            documentCount: 4,
            repairHint: "reindex batch22b",
          },
        ],
      },
      isLoading: false,
      error: null,
    });
    api.useTriggerQmdUpdate.mockReturnValue({
      events: [
        { type: "stderr", line: "stderr batch22b" },
        { type: "completed", exitCode: 0 },
        { type: "failed", error: "failed batch22b" },
      ],
      isStreaming: true,
      trigger,
    });
    api.useLibraryFreshness.mockReturnValue({
      data: {
        collections: [{ collection: "hour", state: "stale", ageMs: 90 * 60_000 }],
      },
      isLoading: false,
      error: null,
      refetch,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ role: "admin" }),
      })),
    );
  });

  it("renders source health rows and freshness streaming log branches", async () => {
    render(<ContextSourcesPanel />);
    expect(screen.getByText("mem0")).toBeInTheDocument();
    expect(screen.getAllByText("stale").length).toBeGreaterThan(0);
    expect(screen.getByText("125m")).toBeInTheDocument();
    expect(screen.getByText("1h")).toBeInTheDocument();
    expect(screen.getByText("stderr batch22b")).toBeInTheDocument();
    expect(screen.getByText(/Completed \(exit 0\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Failed: failed batch22b/i)).toBeInTheDocument();
    expect(screen.getByText(/streaming/i)).toBeInTheDocument();
    await waitFor(() => {
      const refresh = screen.getByRole("button", { name: /Refresh Index|Updating/i });
      expect(refresh).toBeDisabled();
    });
  });

  it("triggers qmd refresh when operator and not streaming", async () => {
    api.useTriggerQmdUpdate.mockReturnValue({
      events: [],
      isStreaming: false,
      trigger,
    });
    render(<ContextSourcesPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Refresh Index" }));
    await waitFor(() => expect(trigger).toHaveBeenCalled());
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it("shows loading and error states for context health and freshness", () => {
    api.useContextSourceHealth.mockReturnValueOnce({
      data: undefined,
      isLoading: true,
      error: null,
    });
    const { rerender } = render(<ContextSourcesPanel />);
    expect(screen.getByText(/Loading context sources/i)).toBeInTheDocument();

    api.useContextSourceHealth.mockReturnValueOnce({
      data: undefined,
      isLoading: false,
      error: new Error("health down batch22b"),
    });
    rerender(<ContextSourcesPanel />);
    expect(screen.getByText(/Failed to load context source health/i)).toBeInTheDocument();
  });
});
