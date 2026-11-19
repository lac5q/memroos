import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/schema", () => ({
  JsonLd: () => null,
  articleSchema: (data: unknown) => data,
  breadcrumbSchema: (data: unknown) => data,
}));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));

import BlogPostPage, { generateMetadata } from "../page";

describe("BlogPostPage", () => {
  it("renders a known blog post", async () => {
    const ui = await BlogPostPage({ params: Promise.resolve({ slug: "what-is-agent-memory" }) });
    render(ui);

    expect(screen.getByRole("heading", { name: /What Is Agent Memory/i })).toBeInTheDocument();
    expect(screen.getByTestId("markdown")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Blog" })).toHaveAttribute("href", "/blog");
  });

  it("generateMetadata returns title for a known slug", async () => {
    const meta = await generateMetadata({
      params: Promise.resolve({ slug: "what-is-agent-memory" }),
    });
    expect(meta.title).toMatch(/What Is Agent Memory/i);
  });
});
