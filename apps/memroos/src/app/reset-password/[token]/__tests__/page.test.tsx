import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));

import ResetPasswordPage from "../page";

describe("ResetPasswordPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("validates password mismatch client-side", async () => {
    render(<ResetPasswordPage params={{ token: "tok-1" }} />);

    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "password1" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "other" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    await waitFor(() => {
      expect(screen.getByText("Passwords do not match.")).toBeInTheDocument();
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows success and redirects after confirm", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    render(<ResetPasswordPage params={{ token: "tok-1" }} />);
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "password1" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "password1" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    await waitFor(() => {
      expect(screen.getByText(/Password reset. Redirecting/i)).toBeInTheDocument();
    });

    await waitFor(
      () => {
        expect(navigation.push).toHaveBeenCalledWith("/login");
      },
      { timeout: 3000 },
    );
  });
});
