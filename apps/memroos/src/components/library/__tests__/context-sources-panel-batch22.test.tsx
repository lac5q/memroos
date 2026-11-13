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

describe("ContextSourcesPanel batch22", () => {
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
        collections: [{ collection: "minute", state: "live", ageMs: 45_000 }],
      },
      isLoading: false,
      error: null,
      refetch,
    });
  });

  it("formats sub-hour ages and hides operator refresh for reviewers", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ role: "reviewer" }),
      })),
    );

    render(<ContextSourcesPanel />);
    expect(screen.getByText("0m")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh Index" })).not.toBeInTheDocument();
  });

  it("streams started and stdout qmd events for operators", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ role: "admin" }),
      })),
    );
    api.useTriggerQmdUpdate.mockReturnValue({
      events: [
        { type: "started", pid: 4242 },
        { type: "stdout", line: "batch22 stdout" },
      ],
      isStreaming: false,
      trigger,
    });

    render(<ContextSourcesPanel />);
    expect(screen.getByText(/qmd update started/i)).toBeInTheDocument();
    expect(screen.getByText("batch22 stdout")).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "Refresh Index" }));
    await waitFor(() => expect(trigger).toHaveBeenCalled());
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });
});
