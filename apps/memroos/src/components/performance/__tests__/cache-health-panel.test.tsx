import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const api = vi.hoisted(() => ({
  useCacheStats: vi.fn(),
  usePurgeCacheMutation: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  useCacheStats: api.useCacheStats,
  usePurgeCacheMutation: api.usePurgeCacheMutation,
}));

import { CacheHealthPanel } from "../cache-health-panel";

describe("CacheHealthPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.usePurgeCacheMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  it("shows loading spinner", () => {
    api.useCacheStats.mockReturnValue({ data: undefined, isLoading: true });
    const { container } = render(<CacheHealthPanel />);
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("shows budget risk when performance budgets fail", () => {
    api.useCacheStats.mockReturnValue({
      isLoading: false,
      data: {
        stats: { entries: 1, hits: 1, misses: 9, memoryBytes: 512, invalidations: 0 },
        performance: {
          ok: false,
          routes: [{ route: "/api/memory", p95Ms: 120, budgetMs: 50, status: "fail" }],
        },
      },
    });
    render(<CacheHealthPanel />);
    expect(screen.getByText("budget risk")).toBeInTheDocument();
    expect(screen.getByText(/p95 120ms/)).toBeInTheDocument();
  });

  it("renders cache stats and purge control", () => {
    const mutate = vi.fn();
    api.usePurgeCacheMutation.mockReturnValue({ mutate, isPending: false });
    api.useCacheStats.mockReturnValue({
      isLoading: false,
      data: {
        stats: { entries: 10, hits: 80, misses: 20, memoryBytes: 2048, invalidations: 2 },
        performance: {
          ok: true,
          routes: [{ route: "/api/memory", p95Ms: 12, budgetMs: 50, status: "pass" }],
        },
      },
    });

    render(<CacheHealthPanel />);
    expect(screen.getByText("Cache Health")).toBeInTheDocument();
    expect(screen.getByText("within budget")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Purge" }));
    expect(mutate).toHaveBeenCalledWith(undefined);
  });
});
