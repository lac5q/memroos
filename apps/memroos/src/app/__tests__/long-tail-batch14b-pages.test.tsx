/**
 * @vitest-environment jsdom
 */
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  searchParams: new URLSearchParams(),
}));

const pageApi = vi.hoisted(() => ({
  useRegisteredAgents: vi.fn(),
  useRegisterAgentMutation: vi.fn(),
  useRegisterA2aAgentCardMutation: vi.fn(),
  useDeregisterAgentMutation: vi.fn(),
  useCreateAgentOnboardingInviteMutation: vi.fn(),
  useApoProposals: vi.fn(),
  useAgents: vi.fn(),
  useEvalConfig: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
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

describe("Long-tail pages batch14b", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigation.searchParams = new URLSearchParams();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/api/wiki?view=tree")) {
          return { ok: true, json: async () => ({ exists: false, wikiRoot: "/wiki", tree: [] }) };
        }
        if (String(url).includes("/api/wiki?view=graph")) {
          return { ok: true, json: async () => ({ nodes: [], edges: [] }) };
        }
        return { ok: true, json: async () => ({}) };
      }),
    );

    pageApi.useRegisteredAgents.mockReturnValue({ data: { agents: [] }, isLoading: false, isError: false });
    pageApi.useAgents.mockReturnValue({ data: { agents: [] }, isLoading: false, isError: false });
    pageApi.useEvalConfig.mockReturnValue({
      data: { config: { weights: { l1: 0.3, l2: 0.3, l3: 0.4 } } },
      isLoading: false,
      isError: false,
    });
    pageApi.useRegisterAgentMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    pageApi.useRegisterA2aAgentCardMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    pageApi.useDeregisterAgentMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    pageApi.useCreateAgentOnboardingInviteMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    pageApi.useApoProposals.mockReturnValue({ data: { proposals: [] }, isLoading: false, isError: false });
  });

  it("Agents page renders registry heading", async () => {
    const { default: AgentsPage } = await import("../agents/page");
    wrap(<AgentsPage />);
    expect(screen.getByRole("heading", { name: "Agents" })).toBeInTheDocument();
  });

  it("APO page renders proposals heading", async () => {
    const { default: ApoPage } = await import("../apo/page");
    wrap(<ApoPage />);
    expect(screen.getByRole("heading", { name: /Improvements/i })).toBeInTheDocument();
  });

  it("Wiki page renders wiki library heading", async () => {
    const { default: WikiPage } = await import("../wiki/page");
    wrap(<WikiPage />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Wiki" })).toBeInTheDocument();
    });
  });

  it("Business ops page renders KPI surface heading", async () => {
    navigation.searchParams = new URLSearchParams({ from_window: "7d", from_workspace: "all" });
    const { default: BusinessOpsPage } = await import("../business-ops/page");
    wrap(<BusinessOpsPage />);
    expect(screen.getByRole("heading", { name: "Business Ops" })).toBeInTheDocument();
  });
});
