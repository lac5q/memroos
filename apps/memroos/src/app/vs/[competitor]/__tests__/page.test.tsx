import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/schema", () => ({
  JsonLd: () => null,
  faqSchema: (items: unknown) => items,
  breadcrumbSchema: (items: unknown) => items,
}));

import CompetitorPage, { generateMetadata } from "../page";

describe("CompetitorPage", () => {
  it("renders MemroOS vs Letta comparison", async () => {
    const ui = await CompetitorPage({ params: Promise.resolve({ competitor: "letta" }) });
    render(ui);

    expect(screen.getByRole("heading", { name: /MemroOS vs Letta/i })).toBeInTheDocument();
    expect(screen.getByText("Detailed Comparison")).toBeInTheDocument();
    expect(screen.getByText("Why Teams Choose MemroOS")).toBeInTheDocument();
  });

  it("generateMetadata includes competitor name", async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ competitor: "letta" }) });
    expect(meta.title).toMatch(/Letta/i);
  });
});
