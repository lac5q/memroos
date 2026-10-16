import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import GlobalError from "../global-error";

describe("GlobalError", () => {
  it("renders critical fault UI and retries via reset", () => {
    const reset = vi.fn();
    render(<GlobalError error={new Error("root")} reset={reset} />);

    expect(screen.getByText("MemroOS could not finish loading.")).toBeInTheDocument();
    expect(screen.getByText("Critical workspace fault")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry loading workspace" }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Open Workflow Map" })).toHaveAttribute("href", "/flow");
  });
});
