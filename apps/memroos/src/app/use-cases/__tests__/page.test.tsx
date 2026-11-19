import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/schema", () => ({
  JsonLd: () => null,
  faqSchema: (items: unknown) => items,
}));

import UseCasesPage from "../page";

describe("UseCasesPage", () => {
  it("renders use case hub and team cards", () => {
    render(<UseCasesPage />);
    expect(screen.getByRole("heading", { name: /AI Agent Memory Use Cases/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Product Teams" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sales Teams" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Engineering Teams" })).toBeInTheDocument();
  });
});
