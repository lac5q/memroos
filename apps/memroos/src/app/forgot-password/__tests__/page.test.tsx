import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import ForgotPasswordPage from "../page";

describe("ForgotPasswordPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("renders reset request form", () => {
    render(<ForgotPasswordPage />);
    expect(screen.getByText("Reset your password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send reset link" })).toBeInTheDocument();
  });

  it("shows queued delivery message", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, delivery: "queued" }),
    } as Response);

    render(<ForgotPasswordPage />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ops@memroos.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    await waitFor(() => {
      expect(screen.getByText(/If an account exists for that email/i)).toBeInTheDocument();
    });
  });

  it("shows manual reset link in dev delivery mode", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        delivery: "manual",
        resetUrl: "https://example.test/reset/abc",
      }),
    } as Response);

    render(<ForgotPasswordPage />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ops@memroos.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    await waitFor(() => {
      expect(screen.getByTestId("password-reset-link")).toHaveAttribute(
        "href",
        "https://example.test/reset/abc",
      );
    });
  });
});
