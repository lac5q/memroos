/**
 * @vitest-environment jsdom
 */
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  params: { token: "invite-batch13b" },
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
  useParams: () => navigation.params,
  useSearchParams: () => navigation.searchParams,
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== "undefined" && input instanceof Request) return input.url;
  return String(input);
}

describe("Long-tail pages batch13b", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigation.searchParams = new URLSearchParams();
    vi.stubGlobal("fetch", vi.fn());
    window.history.replaceState({}, "", "/wiki");
  });

  describe("WikiPageView", () => {
    it("surfaces tree load failures", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("network down");
        }),
      );
      const { default: WikiPageView } = await import("../wiki/page");
      render(<WikiPageView />);
      await waitFor(() => {
        expect(screen.getByText("network down")).toBeInTheDocument();
      });
    });

    it("opens the path from the query string on first load", async () => {
      window.history.replaceState({}, "", "/wiki?path=guides%2Fstart.md");
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = urlOf(input);
        if (url.includes("view=tree")) {
          return Response.json({ ok: true, exists: true, wikiRoot: "/wiki", tree: [] });
        }
        if (url.includes("view=graph")) {
          return Response.json({ ok: true, graph: { exists: false, nodes: [], edges: [] } });
        }
        if (url.includes("guides%2Fstart.md") || url.includes("guides/start.md")) {
          return Response.json({
            ok: true,
            page: { path: "guides/start.md", title: "Start Here", content: "# Start", mtime: null },
          });
        }
        return Response.json({ ok: false }, { status: 404 });
      });
      vi.stubGlobal("fetch", fetchMock);
      const { default: WikiPageView } = await import("../wiki/page");
      render(<WikiPageView />);
      await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Start Here" })).toBeInTheDocument();
      });
    });
  });

  describe("InvitePage", () => {
    it("marks invite invalid when validation throws", async () => {
      vi.mocked(fetch).mockRejectedValue(new Error("offline"));
      const { default: InvitePage } = await import("../invite/[token]/page");
      render(<InvitePage />);
      await waitFor(() => {
        expect(screen.getByText("Invitation Invalid")).toBeInTheDocument();
      });
    });

    it("shows API registration errors and network catch", async () => {
      const { default: InvitePage } = await import("../invite/[token]/page");

      vi.mocked(fetch).mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.includes("/api/auth/invite/")) {
          return { ok: true, json: async () => ({ role: "reviewer" }) } as Response;
        }
        if (url.endsWith("/api/auth/register") && init?.method === "POST") {
          return {
            ok: false,
            status: 400,
            json: async () => ({ error: "Token expired" }),
          } as Response;
        }
        throw new Error(url);
      });
      render(<InvitePage />);
      await waitFor(() => expect(screen.getByText("Join Memroos")).toBeInTheDocument());
      fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
      fireEvent.change(screen.getByLabelText("Display Name"), { target: { value: "Alex" } });
      fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password1" } });
      fireEvent.click(screen.getByRole("button", { name: "Create account" }));
      await waitFor(() => expect(screen.getByText("Token expired")).toBeInTheDocument());

      vi.mocked(fetch).mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes("/api/auth/invite/")) {
          return { ok: true, json: async () => ({ role: "reviewer" }) } as Response;
        }
        if (url.endsWith("/api/auth/register")) {
          throw new Error("offline");
        }
        throw new Error(url);
      });
      fireEvent.click(screen.getByRole("button", { name: "Create account" }));
      await waitFor(() => {
        expect(screen.getByText("Registration failed. Please try again.")).toBeInTheDocument();
      });
    });
  });

  describe("ResetPasswordPage", () => {
    it("rejects short passwords and surfaces confirm failures", async () => {
      const { default: ResetPasswordPage } = await import("../reset-password/[token]/page");
      render(<ResetPasswordPage params={{ token: "tok-b13b" }} />);

      fireEvent.change(screen.getByLabelText("New password"), { target: { value: "short" } });
      fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "short" } });
      fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
      await waitFor(() => {
        expect(screen.getByText("Password must be at least 8 characters.")).toBeInTheDocument();
      });

      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        json: async () => ({ ok: false, error: "Token invalid" }),
      } as Response);
      fireEvent.change(screen.getByLabelText("New password"), { target: { value: "longpassword" } });
      fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "longpassword" } });
      fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
      await waitFor(() => expect(screen.getByText("Token invalid")).toBeInTheDocument());

      vi.mocked(fetch).mockRejectedValue(new Error("offline"));
      fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
      await waitFor(() => {
        expect(screen.getByText("Reset failed. Please try again.")).toBeInTheDocument();
      });
    });
  });

  describe("marketing pages metadata", () => {
    it("returns empty blog metadata for unknown slugs", async () => {
      const { generateMetadata } = await import("../blog/[slug]/page");
      const meta = await generateMetadata({ params: Promise.resolve({ slug: "does-not-exist-batch13b" }) });
      expect(meta).toEqual({});
    });

    it("returns empty competitor metadata for unknown slugs", async () => {
      const { generateMetadata } = await import("../vs/[competitor]/page");
      const meta = await generateMetadata({
        params: Promise.resolve({ competitor: "not-a-real-competitor" }),
      });
      expect(meta).toEqual({});
    });
  });

});
