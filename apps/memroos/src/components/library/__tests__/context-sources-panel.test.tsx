import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

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

describe("ContextSourcesPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ role: "reviewer" }),
      })),
    );
    api.useTriggerQmdUpdate.mockReturnValue({
      events: [],
      isStreaming: false,
      trigger: vi.fn(),
    });
    api.useLibraryFreshness.mockReturnValue({
      data: { state: "live", ageMs: 120_000, documentCount: 4, lastIndexedAt: null },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
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
  });

  it("shows loading state for sources", () => {
    api.useContextSourceHealth.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });

    render(<ContextSourcesPanel />);
    expect(screen.getByText(/Loading context sources/i)).toBeInTheDocument();
  });
});
