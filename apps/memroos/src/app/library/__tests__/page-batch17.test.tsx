/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const navigation = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
}));

const api = vi.hoisted(() => ({
  useKnowledge: vi.fn(),
  useGitNexus: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => navigation.searchParams,
}));

vi.mock("@/lib/api-client", () => ({
  useKnowledge: api.useKnowledge,
  useGitNexus: api.useGitNexus,
}));

vi.mock("@/components/library/collection-card", () => ({
  CollectionCard: ({ collection }: { collection: { name: string } }) => <div>{collection.name}</div>,
}));
vi.mock("@/components/library/collection-treemap", () => ({ CollectionTreemap: () => null }));
vi.mock("@/components/library/health-panel", () => ({ HealthPanel: () => null }));
vi.mock("@/components/library/gitnexus-panel", () => ({ GitNexusPanel: () => null }));
vi.mock("@/components/ledger/sqlite-health-panel", () => ({ SqliteHealthPanel: () => null }));
vi.mock("@/components/ledger/memory-intelligence-panel", () => ({ MemoryIntelligencePanel: () => null }));
vi.mock("@/components/security/security-operations-panel", () => ({ SecurityOperationsPanel: () => null }));
vi.mock("@/components/performance/cache-health-panel", () => ({ CacheHealthPanel: () => null }));
vi.mock("@/components/library/analytics-panel", () => ({ LibraryAnalyticsPanel: () => null }));
vi.mock("@/components/library/collection-trends-panel", () => ({ CollectionTrendsPanel: () => null }));
vi.mock("@/components/library/context-sources-panel", () => ({ ContextSourcesPanel: () => null }));
vi.mock("@/components/ui/info-tip", () => ({ InfoTip: () => null }));
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import LibraryPage from "../page";

describe("LibraryPage batch17", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigation.searchParams = new URLSearchParams();
    api.useGitNexus.mockReturnValue({ data: { repos: [] } });
  });

  it("shows the loading spinner while knowledge data is fetching", () => {
    api.useKnowledge.mockReturnValue({ data: undefined, isLoading: true });
    render(<LibraryPage />);
    expect(document.querySelector(".animate-spin")).toBeTruthy();
  });

  it("renders NOC drilldown banner from search params", () => {
    navigation.searchParams = new URLSearchParams(
      "from_window=24h&from_workspace=oracle-1&from_scope_note=batch17-scope-note",
    );
    api.useKnowledge.mockReturnValue({
      data: { collections: [{ name: "alpha", docCount: 3, category: "business", lastUpdated: null }], totalFiles: 3 },
      isLoading: false,
    });

    render(<LibraryPage />);
    expect(screen.getByText(/Drilldown from Operations NOC/i)).toBeInTheDocument();
    expect(screen.getByText(/window=24h, workspace=oracle-1/)).toBeInTheDocument();
    expect(screen.getByText(/batch17-scope-note/)).toBeInTheDocument();
    expect(screen.getByText("alpha")).toBeInTheDocument();
  });
});
