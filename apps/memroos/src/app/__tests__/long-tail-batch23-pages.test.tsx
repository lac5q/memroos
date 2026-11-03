/**
 * @vitest-environment jsdom
 */
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

vi.mock("@/lib/schema", () => ({
  JsonLd: () => null,
  articleSchema: (data: unknown) => data,
  breadcrumbSchema: (data: unknown) => data,
  faqSchema: (items: unknown) => items,
}));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    useSkillRegistry: vi.fn(() => ({ data: { skills: [] }, isLoading: false })),
    useSkillSuggestions: vi.fn(() => ({ data: { suggestions: [] }, isLoading: false })),
    useBusinessOpsDashboard: vi.fn(() => ({ data: { adapters: [] }, isLoading: false, isError: false })),
    useEvalHistory: vi.fn(() => ({ data: { runs: [] }, isLoading: false })),
    useApo: vi.fn(() => ({ data: { proposals: [] }, isLoading: false })),
    useAgents: vi.fn(() => ({ data: { agents: [] }, isLoading: false })),
  };
});

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("Long-tail pages batch23", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } });
  });

  it("meetings page requires consent before joining", async () => {
    const { default: MeetingsPage } = await import("../meetings/page");
    vi.stubGlobal("fetch", vi.fn());
    render(<MeetingsPage />);
    fireEvent.submit(screen.getByRole("button", { name: /Join meeting/i }).closest("form")!);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("forgot-password page renders email field", async () => {
    const { default: ForgotPasswordPage } = await import("../forgot-password/page");
    render(<ForgotPasswordPage />);
    expect(screen.getByLabelText(/Email/i)).toBeInTheDocument();
  });

  it("business-ops page loads shell heading", async () => {
    const { default: BusinessOpsPage } = await import("../business-ops/page");
    wrap(<BusinessOpsPage />);
    expect(screen.getByRole("heading", { name: /Business Ops/i })).toBeInTheDocument();
  });

  it("skills page renders registry heading", async () => {
    const { default: SkillsPage } = await import("../skills/page");
    wrap(<SkillsPage />);
    expect(screen.getByRole("heading", { name: /Skills/i })).toBeInTheDocument();
  });

  it("apo page renders proposal workspace heading", async () => {
    const { default: ApoPage } = await import("../apo/page");
    wrap(<ApoPage />);
    expect(screen.getByRole("heading", { name: /Improvements/i })).toBeInTheDocument();
  });

  it("compliance settings page renders policy heading", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ policies: [] }) })),
    );
    const { default: CompliancePage } = await import("../settings/compliance/page");
    wrap(<CompliancePage />);
    await waitFor(() => expect(screen.getByText(/Compliance/i)).toBeInTheDocument());
  });

  it("blog slug page renders known article", async () => {
    const { default: BlogPostPage } = await import("../blog/[slug]/page");
    const ui = await BlogPostPage({ params: Promise.resolve({ slug: "what-is-agent-memory" }) });
    render(ui);
    expect(screen.getByRole("heading", { name: /What Is Agent Memory/i })).toBeInTheDocument();
  });

  it("vs competitor page renders comparison heading", async () => {
    const { default: CompetitorPage } = await import("../vs/[competitor]/page");
    const ui = await CompetitorPage({ params: Promise.resolve({ competitor: "letta" }) });
    render(ui);
    expect(screen.getByRole("heading", { name: /MemRoOS vs/i })).toBeInTheDocument();
  });
});
