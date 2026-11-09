import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe("ResetPasswordPage batch30", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("treats unreadable confirm JSON as empty and fires onInput handlers (49, 106, 122)", async () => {
    const { default: ResetPasswordPage } = await import("../page");
    render(<ResetPasswordPage params={{ token: "tok-batch30" }} />);

    const password = screen.getByLabelText("New password");
    const confirm = screen.getByLabelText("Confirm new password");
    fireEvent.input(password, { target: { value: "passwordbatch30" } });
    fireEvent.input(confirm, { target: { value: "passwordbatch30" } });

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => {
        throw new Error("invalid json batch30");
      },
    } as Response);

    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
    await waitFor(() => expect(screen.getByText("Reset failed")).toBeInTheDocument());
  });
});
