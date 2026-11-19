import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/schema", () => ({
  JsonLd: () => null,
  faqSchema: (items: unknown) => items,
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import VsIndexPage from "../page";

describe("VsIndexPage", () => {
  it("renders comparison index heading and competitor links", () => {
    render(<VsIndexPage />);
    expect(screen.getByRole("heading", { name: /MemroOS vs Alternatives/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /MemroOS vs Letta/i })).toBeInTheDocument();
    expect(screen.getAllByText(/Benchmark score/i).length).toBeGreaterThan(0);
  });
});
