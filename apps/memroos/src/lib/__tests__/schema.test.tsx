import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  articleSchema,
  breadcrumbSchema,
  faqSchema,
  JsonLd,
  organizationSchema,
  softwareApplicationSchema,
  speakableSchema,
} from "@/lib/schema";

describe("schema helpers", () => {
  it("organizationSchema includes MemroOS metadata", () => {
    const schema = organizationSchema();
    expect(schema["@type"]).toBe("Organization");
    expect(schema.name).toBe("MemroOS");
    expect(schema.url).toBeTruthy();
  });

  it("articleSchema uses updatedAt when provided", () => {
    const schema = articleSchema({
      title: "Hello",
      description: "World",
      url: "https://memroos.com/blog/hello",
      publishedAt: "2026-01-01",
      updatedAt: "2026-02-01",
    });
    expect(schema.dateModified).toBe("2026-02-01");
  });

  it("faqSchema and breadcrumbSchema shape entities", () => {
    const faq = faqSchema([{ question: "Q?", answer: "A." }]);
    expect(faq.mainEntity).toHaveLength(1);
    const crumbs = breadcrumbSchema([{ name: "Home", url: "https://memroos.com" }]);
    expect(crumbs.itemListElement[0]?.position).toBe(1);
  });

  it("JsonLd renders escaped JSON in a script tag", () => {
    const data = softwareApplicationSchema();
    const { container } = render(<JsonLd data={data} />);
    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script).toBeTruthy();
    const html = script?.innerHTML ?? "";
    expect(html).not.toContain("<");
    expect(JSON.parse(html)).toMatchObject({ "@type": "SoftwareApplication" });
  });

  it("speakableSchema lists css selectors", () => {
    expect(speakableSchema(["h1", ".lead"]).speakable).toEqual({
      "@type": "SpeakableSpecification",
      cssSelector: ["h1", ".lead"],
    });
  });
});
