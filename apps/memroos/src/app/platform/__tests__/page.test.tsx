import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/schema", () => ({
  JsonLd: () => null,
  faqSchema: (items: unknown) => items,
  softwareApplicationSchema: () => ({}),
  speakableSchema: () => ({}),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import PlatformPage from "../page";

describe("PlatformPage", () => {
  it("renders platform capabilities and CTA", () => {
    render(<PlatformPage />);
    expect(
      screen.getByRole("heading", { name: /Company-Owned Memory & Governance/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Company-Owned Context Layer")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Get Started/i })).toBeInTheDocument();
  });
});
