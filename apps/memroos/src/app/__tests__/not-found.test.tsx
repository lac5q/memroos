import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import NotFound from "../not-found";

describe("NotFound", () => {
  it("renders 404 fallback with navigation links", () => {
    render(<NotFound />);

    expect(screen.getByText("This workspace route does not exist.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Workflow Map" })).toHaveAttribute("href", "/flow");
    expect(screen.getByRole("link", { name: "Agents" })).toHaveAttribute("href", "/agents");
  });
});
