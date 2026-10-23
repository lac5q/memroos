import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { ConsentDialog } from "../consent-dialog";

describe("ConsentDialog", () => {
  it("returns null when closed", () => {
    const { container } = render(
      <ConsentDialog open={false} onCancel={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("requires consent checkbox before confirm", () => {
    const onConfirm = vi.fn();
    render(<ConsentDialog open onCancel={vi.fn()} onConfirm={onConfirm} />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm Consent" })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Consent" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
