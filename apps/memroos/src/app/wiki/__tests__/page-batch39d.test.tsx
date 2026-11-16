/**
 * Wiki page batch39d — initial path from localhost search params.
 * @vitest-environment jsdom
 */
import { randomUUID } from "node:crypto";
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

describe("WikiPageView batch39d", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("initialPath reads path query from /wiki on localhost (line 94)", async () => {
    const slug = `batch39d-${randomUUID().slice(0, 8)}`;
    const pagePath = `memroos-digest/${slug}.md`;
    window.history.replaceState({}, "", `/wiki?path=${encodeURIComponent(pagePath)}`);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input);
      if (url.includes("view=tree")) {
        return Response.json({ ok: true, exists: true, wikiRoot: "/tmp/wiki-b39d", tree: [] });
      }
      if (url.includes("view=graph")) {
        return Response.json({ ok: true, graph: { nodes: [], edges: [] } });
      }
      if (url.includes(encodeURIComponent(pagePath)) || url.includes(slug)) {
        return Response.json({
          ok: true,
          page: { path: pagePath, title: `B39d ${slug}`, content: `# ${slug}`, mtime: "2026-11-16" },
        });
      }
      return Response.json({ ok: false, error: "page_not_found" });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WikiPageView />);
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes(slug))).toBe(true);
    });
  });

  it("initialPath defaults to index.md when query param missing (line 96)", async () => {
    window.history.replaceState({}, "", "/wiki");

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input);
      if (url.includes("view=tree")) {
        return Response.json({ ok: true, exists: true, wikiRoot: "/tmp/wiki-b39d", tree: [] });
      }
      if (url.includes("view=graph")) {
        return Response.json({ ok: true, graph: { nodes: [], edges: [] } });
      }
      if (url.includes("index.md")) {
        return Response.json({
          ok: true,
          page: { path: "index.md", title: "Index", content: "# Index", mtime: "2026-11-16" },
        });
      }
      return Response.json({ ok: false, error: "page_not_found" });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WikiPageView />);
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("index.md"))).toBe(true);
    });
  });
});