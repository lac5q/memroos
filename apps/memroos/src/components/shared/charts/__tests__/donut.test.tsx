import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Donut } from "../donut";

describe("Donut", () => {
  it("renders percentage and optional label", () => {
    render(<Donut value={25} max={100} label="Hit rate" />);
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText("Hit rate")).toBeInTheDocument();
  });
});
