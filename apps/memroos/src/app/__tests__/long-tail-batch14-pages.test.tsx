/**
 * @vitest-environment jsdom
 */
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  params: { token: "reset-batch14" },
  searchParams: new URLSearchParams(),
}));

const pageApi = vi.hoisted(() => ({
  useSkillRegistry: vi.fn(),
  useSkillSuggestions: vi.fn(),
  useMemoryInventory: vi.fn(),
  useMultiMemorySearch: vi.fn(),
  useEscalations: vi.fn(),
  useResolveEscalation: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
  useParams: () => navigation.params,
  useSearchParams: () => navigation.searchParams,
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, ...pageApi };
});

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("Long-tail pages batch14", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigation.searchParams = new URLSearchParams();
    vi.stubGlobal("fetch", vi.fn());
    window.history.replaceState({}, "", "/");
  });

  it("NotebooksPage shows scope disclosure from query params", async () => {
    navigation.searchParams = new URLSearchParams({
      from_window: "24h",
      from_workspace: "local",
      from_scope_note: "reference-only-batch14",
      q: "batch14-query",
    });
    pageApi.useMemoryInventory.mockReturnValue({
      data: { rows: [], categories: [] },
      isLoading: false,
      isError: false,
    });
    pageApi.useMultiMemorySearch.mockReturnValue({ mutate: vi.fn(), isPending: false, data: undefined });
    const { default: NotebooksPage } = await import("../notebooks/page");
    wrap(<NotebooksPage />);
    expect(screen.getByText(/reference-only-batch14/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue("batch14-query")).toBeInTheDocument();
  });

  it("EscalationsPage renders drilldown disclosure", async () => {
    navigation.searchParams = new URLSearchParams({ from_window: "7d", from_workspace: "all" });
    pageApi.useEscalations.mockReturnValue({ data: { escalations: [] }, isLoading: false, isError: false });
    pageApi.useResolveEscalation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    const { default: EscalationsPage } = await import("../escalations/page");
    wrap(<EscalationsPage />);
    expect(screen.getByText(/Drilldown from Operations NOC/i)).toBeInTheDocument();
  });

  it("Skills page renders unknown risk tier badge", async () => {
    pageApi.useSkillRegistry.mockReturnValue({
      data: {
        items: [
          {
            name: "risky-skill",
            description: "d",
            source_harness: "cursor",
            risk_tier: "experimental",
            dispatch_status: "disabled",
            completeness_pct: 40,
            missing_fields: ["owner"],
            verification_checks_list: [],
            owner: "",
            version: "1",
            imported_at: "2026-05-01T00:00:00.000Z",
            imported_by: "admin",
          },
        ],
        total: 1,
      },
      isLoading: false,
      isError: false,
    });
    pageApi.useSkillSuggestions.mockReturnValue({ data: { suggestions: [] }, isLoading: false, isError: false });
    const { default: SkillsPage } = await import("../skills/page");
    wrap(<SkillsPage />);
    expect(screen.getByText("experimental")).toBeInTheDocument();
  });

  it("Reset password page renders form for token param", async () => {
    navigation.params = { token: "reset-batch14" };
    const { default: ResetPasswordPage } = await import("../reset-password/[token]/page");
    render(<ResetPasswordPage />);
    expect(screen.getByText(/Set a new password/i)).toBeInTheDocument();
  });

  it("Settings compliance page renders heading", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ role: "admin", policies: { retentionDays: 30 } }),
    } as Response);
    const { default: CompliancePage } = await import("../settings/compliance/page");
    wrap(<CompliancePage />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Compliance" })).toBeInTheDocument());
  });
});
