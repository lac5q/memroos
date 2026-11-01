import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/schema", () => ({
  JsonLd: () => null,
  faqSchema: (items: unknown) => items,
}));

import SalesUseCasePage from "../page";

describe("SalesUseCasePage", () => {
  it("renders sales use case content", () => {
    render(<SalesUseCasePage />);
    expect(screen.getByRole("heading", { name: /AI Agent CRM Memory for Sales/i })).toBeInTheDocument();
  });
});
