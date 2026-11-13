import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/blog", () => ({
  getAllPostSlugs: () => ["hello-world"],
}));

import sitemap from "../sitemap";
import { BASE_URL } from "@/lib/metadata";

describe("sitemap", () => {
  it("includes static routes and blog slugs", async () => {
    const routes = await sitemap();
    const urls = routes.map((r) => r.url);

    expect(urls).toContain(BASE_URL);
    expect(urls).toContain(`${BASE_URL}/blog`);
    expect(urls).toContain(`${BASE_URL}/blog/hello-world`);
    expect(routes.length).toBeGreaterThan(10);
  });
});
