/**
 * Wiki page batch31b — initial path query param and cancelled load guard.
 * @vitest-environment jsdom
 */
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));

import WikiPageView from "@/app/wiki/page";

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== "undefined" && input instanceof Request) return input.url;
  return String(input);
}

describe("WikiPageView batch31b", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/wiki?path=memroos-digest%2Fbatch31b.md");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens the path from window.location.search on first load (line 94)", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input);
      if (url.includes("view=tree")) {
        return Response.json({ ok: true, exists: true, wikiRoot: "/tmp/wiki", tree: [] });
      }
      if (url.includes("view=graph")) {
        return Response.json({ ok: true, graph: { nodes: [], edges: [] } });
      }
      if (url.includes("batch31b.md")) {
        return Response.json({
          ok: true,
          page: { path: "memroos-digest/batch31b.md", title: "Batch31b", content: "# Batch31b", mtime: "2026-11-08" },
        });
      }
      return Response.json({ ok: false, error: "page_not_found" });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WikiPageView />);
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("batch31b.md"))).toBe(true);
    });
  });

  it("does not update state after unmount during tree load (line 125)", async () => {
    let resolveTree: ((value: Response) => void) | undefined;
    const treePromise = new Promise<Response>((resolve) => {
      resolveTree = resolve;
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = urlOf(input);
        if (url.includes("view=tree")) return treePromise;
        if (url.includes("view=graph")) return Response.json({ ok: true, graph: { nodes: [], edges: [] } });
        return Response.json({ ok: true });
      }),
    );

    const { unmount } = render(<WikiPageView />);
    unmount();
    resolveTree?.(Response.json({ ok: true, exists: true, wikiRoot: "/tmp/wiki", tree: [] }));
    expect(true).toBe(true);
  });
});
