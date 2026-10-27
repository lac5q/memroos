import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/schema", () => ({
  JsonLd: () => null,
  faqSchema: (items: unknown) => items,
}));

vi.mock("@/components/blog/post-card", () => ({
  PostCard: ({ post }: { post: { slug: string; frontmatter: { title: string } } }) => (
    <article data-testid="post-card">{post.frontmatter.title}</article>
  ),
}));

import BlogPage from "../page";

describe("BlogPage", () => {
  it("renders blog heading and post list or empty state", () => {
    render(<BlogPage />);
    expect(screen.getByRole("heading", { name: "Blog" })).toBeInTheDocument();
    expect(
      screen.getByText(/Guides, benchmarks, and deep dives on AI agent memory/i)
    ).toBeInTheDocument();

    const cards = screen.queryAllByTestId("post-card");
    if (cards.length === 0) {
      expect(screen.getByText(/No posts yet/i)).toBeInTheDocument();
    } else {
      expect(cards.length).toBeGreaterThan(0);
    }
  });
});
