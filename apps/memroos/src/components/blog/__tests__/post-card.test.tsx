import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { PostCard } from "../post-card";
import type { Post } from "@/lib/blog";

const post: Post = {
  slug: "sample-post",
  content: "# Hello",
  frontmatter: {
    title: "Sample Post Title",
    description: "Sample description for the card.",
    publishedAt: "2026-05-20",
    tags: ["memory", "agents"],
    keywords: ["sample"],
    author: "MemroOS",
  },
};

describe("PostCard", () => {
  it("renders title, description, date, and tags", () => {
    render(<PostCard post={post} />);
    expect(screen.getByRole("link", { name: "Sample Post Title" })).toHaveAttribute(
      "href",
      "/blog/sample-post"
    );
    expect(screen.getByText("Sample description for the card.")).toBeInTheDocument();
    expect(screen.getByText("memory")).toBeInTheDocument();
    expect(screen.getByText("agents")).toBeInTheDocument();
  });
});
