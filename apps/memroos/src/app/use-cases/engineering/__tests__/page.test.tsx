import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/schema", () => ({
  JsonLd: () => null,
  faqSchema: (items: unknown) => items,
}));

import EngineeringUseCasePage from "../page";

describe("EngineeringUseCasePage", () => {
  it("renders engineering use case content", () => {
    render(<EngineeringUseCasePage />);
    expect(screen.getByRole("heading", { name: /Engineering Agent Memory/i })).toBeInTheDocument();
    expect(screen.getByText(/Architecture decisions and their rationale/i)).toBeInTheDocument();
  });
});
