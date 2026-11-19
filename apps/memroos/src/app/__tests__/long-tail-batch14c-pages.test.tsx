/**
 * @vitest-environment jsdom
 */
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const pageApi = vi.hoisted(() => ({
  useSkillRegistry: vi.fn(),
  useSkillSuggestions: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, ...pageApi };
});

vi.mock("@/lib/schema", () => ({
  JsonLd: () => null,
  articleSchema: (data: unknown) => data,
  breadcrumbSchema: (data: unknown) => data,
  faqSchema: (items: unknown) => items,
}));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function skillItem(index: number) {
  return {
    name: `skill-14c-${index}`,
    description: `Skill ${index}`,
    source_harness: "cursor",
    risk_tier: "standard",
    dispatch_status: index % 2 === 0 ? ("incomplete" as const) : ("enabled" as const),
    completeness_pct: 55,
    missing_fields: index % 2 === 0 ? ["owner", "version"] : [],
    verification_checks_list: [],
    owner: index % 2 === 0 ? "" : "team",
    version: "1.0.0",
    imported_at: "2026-05-01T00:00:00.000Z",
    imported_by: "admin",
  };
}

describe("Long-tail pages batch14c", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pageApi.useSkillSuggestions.mockReturnValue({ data: { suggestions: [] }, isLoading: false, isError: false });
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn(async () => undefined) },
    });
  });

  it("blog page renders known slug content", async () => {
    const { default: BlogPostPage } = await import("../blog/[slug]/page");
    const ui = await BlogPostPage({ params: Promise.resolve({ slug: "what-is-agent-memory" }) });
    render(ui);
    expect(screen.getByRole("heading", { name: /What Is Agent Memory/i })).toBeInTheDocument();
  });

  it("vs competitor page renders comparison heading", async () => {
    const { default: CompetitorPage } = await import("../vs/[competitor]/page");
    const ui = await CompetitorPage({ params: Promise.resolve({ competitor: "letta" }) });
    render(ui);
    expect(screen.getByRole("heading", { name: /MemroOS vs Letta/i })).toBeInTheDocument();
  });

  it("blog generateStaticParams lists markdown slugs", async () => {
    const { generateStaticParams } = await import("../blog/[slug]/page");
    const params = await generateStaticParams();
    expect(Array.isArray(params)).toBe(true);
    expect(params.some((p) => typeof p.slug === "string")).toBe(true);
  });

  it("blog generateMetadata returns empty object for unknown slug", async () => {
    const { generateMetadata } = await import("../blog/[slug]/page");
    const meta = await generateMetadata({ params: Promise.resolve({ slug: "missing-slug-batch14c" }) });
    expect(meta).toEqual({});
  });

  it("vs generateStaticParams lists competitor slugs", async () => {
    const { generateStaticParams } = await import("../vs/[competitor]/page");
    const params = await generateStaticParams();
    expect(params.length).toBeGreaterThan(0);
    expect(params[0]).toHaveProperty("competitor");
  });

  it("vs generateMetadata returns empty object for unknown competitor", async () => {
    const { generateMetadata } = await import("../vs/[competitor]/page");
    const meta = await generateMetadata({
      params: Promise.resolve({ competitor: "not-real-batch14c" }),
    });
    expect(meta).toEqual({});
  });

  it("Skills page shows not-ready banner and paginates backward", async () => {
    const items = Array.from({ length: 21 }, (_, i) => skillItem(i));
    pageApi.useSkillRegistry.mockReturnValue({
      data: { items, total: 21 },
      isLoading: false,
      isError: false,
    });
    const { default: SkillsPage } = await import("../skills/page");
    wrap(<SkillsPage />);
    expect(screen.getAllByText(/Not ready for dispatch/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(/Showing 21–21 of 21 skills/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getByText(/Showing 1–20 of 21 skills/i)).toBeInTheDocument();
  });

  it("Team page closes invite form via Cancel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/api/users")) {
          return { ok: true, json: async () => ({ users: [] }) } as Response;
        }
        return { ok: true, json: async () => ({}) } as Response;
      }),
    );
    const { default: TeamPage } = await import("../team/page");
    wrap(<TeamPage />);
    fireEvent.click(screen.getByRole("button", { name: /Invite user/i }));
    expect(screen.getByText(/Invite team member/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(/Invite team member/i)).not.toBeInTheDocument();
  });

  it("Team page copies generated invite URL to clipboard", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes("/api/users")) {
          return { ok: true, json: async () => ({ users: [] }) } as Response;
        }
        if (String(url).includes("/api/auth/invite") && init?.method === "POST") {
          return { ok: true, json: async () => ({ inviteUrl: "https://memroos.test/invite/14c" }) } as Response;
        }
        return { ok: true, json: async () => ({}) } as Response;
      }),
    );
    const { default: TeamPage } = await import("../team/page");
    wrap(<TeamPage />);
    fireEvent.click(screen.getByRole("button", { name: /Invite user/i }));
    fireEvent.click(screen.getByRole("button", { name: /Generate invite link/i }));
    await waitFor(() => {
      expect(screen.getByText(/Invite link generated/i)).toBeInTheDocument();
    });
    const copyBtn = screen.getByText(/memroos.test\/invite\/14c/i).parentElement?.querySelector("button");
    expect(copyBtn).toBeTruthy();
    fireEvent.click(copyBtn!);
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("https://memroos.test/invite/14c");
    });
  });
});
