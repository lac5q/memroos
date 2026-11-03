/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  useContextSourceHealth: vi.fn(),
  useLibraryFreshness: vi.fn(),
  useTriggerQmdUpdate: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  useContextSourceHealth: api.useContextSourceHealth,
  useLibraryFreshness: api.useLibraryFreshness,
  useTriggerQmdUpdate: api.useTriggerQmdUpdate,
}));

import { ContextSourcesPanel } from "../context-sources-panel";

describe("ContextSourcesPanel batch23", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.useContextSourceHealth.mockReturnValue({
      data: { sources: [{ id: "gmail", status: "ok", ageMinutes: null, documentCount: 0, repairHint: "" }] },
      isLoading: false,
      error: null,
    });
    api.useLibraryFreshness.mockReturnValue({
      data: { collections: [{ collection: "day", state: "live", ageMs: null }] },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    api.useTriggerQmdUpdate.mockReturnValue({
      events: [{ type: "progress", line: "ignored batch23" } as { type: string; line: string }],
      isStreaming: false,
      trigger: vi.fn(),
    });
  });

  it("formats n/a ages and ignores unknown qmd stream event types", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("auth down batch23");
      }),
    );

    render(<ContextSourcesPanel />);
    expect(screen.getAllByText("n/a").length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Refresh Index" })).not.toBeInTheDocument());
  });
});
