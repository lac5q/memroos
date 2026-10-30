/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConsentDialog } from "../consent-dialog";

describe("ConsentDialog batch22c", () => {
  it("returns null when closed", () => {
    const { container } = render(<ConsentDialog open={false} onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("requires checkbox before confirm and resets on cancel", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<ConsentDialog open onCancel={onCancel} onConfirm={onConfirm} />);

    const confirm = screen.getByRole("button", { name: /Confirm Consent/i });
    expect(confirm).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(confirm).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalled();
  });
});
