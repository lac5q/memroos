/**
 * @vitest-environment jsdom
 */
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const navigation = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
}));

const skillApi = vi.hoisted(() => ({
  useSkillRegistry: vi.fn(),
  useSkillSuggestions: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => navigation.searchParams,
}));

vi.mock("@/lib/api-client", () => skillApi);

import SkillsRegistryPage from "../page";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const skillItem = {
  name: "dispatch-ready",
  description: "Ready skill",
  source_harness: "cursor",
  risk_tier: "low",
  dispatch_status: "enabled" as const,
  completeness_pct: 100,
  missing_fields: [],
  verification_checks_list: ["check-one"],
  owner: "ops",
  version: "1",
  imported_at: "2026-05-01T00:00:00.000Z",
  imported_by: "admin",
};

describe("SkillsRegistryPage batch13b", () => {
  beforeEach(() => {
    navigation.searchParams = new URLSearchParams();
    vi.clearAllMocks();
  });

  it("paginates registry results and filters by harness", async () => {
    skillApi.useSkillRegistry.mockImplementation(({ offset }: { offset: number }) => ({
      data: {
        items: offset === 0 ? [skillItem] : [{ ...skillItem, name: "page-two", source_harness: "codex" }],
        total: 25,
      },
      isLoading: false,
      isError: false,
    }));
    skillApi.useSkillSuggestions.mockReturnValue({
      data: { suggestions: [], timestamp: null },
      isLoading: false,
      isError: false,
    });
    navigation.searchParams = new URLSearchParams({
      from_window: "24h",
      from_workspace: "all",
      from_scope_note: "reference only",
    });
    wrap(<SkillsRegistryPage />);
    expect(screen.getByText(/Drilldown from Operations NOC/i)).toBeInTheDocument();
    expect(screen.getByText(/Showing 1–20 of 25 skills/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("page-two")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "codex" }));
    expect(skillApi.useSkillRegistry).toHaveBeenCalledWith(
      expect.objectContaining({ source_harness: "codex", offset: 0 }),
    );
  });

  it("shows suggestion and registry error states", () => {
    skillApi.useSkillRegistry.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    skillApi.useSkillSuggestions.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    wrap(<SkillsRegistryPage />);
    expect(screen.getByText(/Failed to load suggested skills/i)).toBeInTheDocument();
    expect(screen.getByText(/Failed to load governed registry skills/i)).toBeInTheDocument();
  });

  it("expands verification checks on a skill row", async () => {
    skillApi.useSkillRegistry.mockReturnValue({
      data: { items: [skillItem], total: 1 },
      isLoading: false,
      isError: false,
    });
    skillApi.useSkillSuggestions.mockReturnValue({
      data: { suggestions: [], timestamp: "2026-05-01T00:00:00.000Z" },
      isLoading: false,
      isError: false,
    });
    wrap(<SkillsRegistryPage />);
    fireEvent.click(screen.getByRole("button", { name: /Show verification checks/i }));
    await waitFor(() => expect(screen.getByText("check-one")).toBeInTheDocument());
  });
});
