import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import AppError from "../error";

describe("AppError", () => {
  it("renders route failure fallback and calls reset", () => {
    const reset = vi.fn();
    render(<AppError error={new Error("boom")} reset={reset} />);

    expect(screen.getByText("This workflow could not finish.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Workflow Map" })).toHaveAttribute("href", "/flow");
    fireEvent.click(screen.getByRole("button", { name: "Retry this route" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
