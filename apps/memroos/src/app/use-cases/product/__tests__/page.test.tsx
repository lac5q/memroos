import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/schema", () => ({
  JsonLd: () => null,
  faqSchema: (items: unknown) => items,
}));

import ProductUseCasePage from "../page";

describe("ProductUseCasePage", () => {
  it("renders product use case content", () => {
    render(<ProductUseCasePage />);
    expect(screen.getByRole("heading", { name: /AI Memory for Product Teams/i })).toBeInTheDocument();
    expect(screen.getByText(/Customer interviews and feedback sessions/i)).toBeInTheDocument();
  });
});
