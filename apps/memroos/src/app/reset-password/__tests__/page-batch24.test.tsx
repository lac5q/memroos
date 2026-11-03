/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

import ResetPasswordPage from "../[token]/page";

describe("ResetPasswordPage batch24", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("validates mismatched passwords and surfaces API errors", async () => {
    render(<ResetPasswordPage params={{ token: "tok-batch24" }} />);
    fireEvent.change(document.getElementById("password")!, { target: { value: "password123" } });
    fireEvent.change(document.getElementById("confirm")!, { target: { value: "password999" } });
    fireEvent.submit(screen.getByRole("button", { name: /Reset password/i }).closest("form")!);
    expect(await screen.findByText(/Passwords do not match/i)).toBeInTheDocument();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ ok: false, error: "token expired batch24" }),
      })),
    );
    fireEvent.change(document.getElementById("confirm")!, { target: { value: "password123" } });
    fireEvent.submit(screen.getByRole("button", { name: /Reset password/i }).closest("form")!);
    expect(await screen.findByText(/token expired batch24/i)).toBeInTheDocument();
  });

  it("shows success state and redirects to login", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ ok: true }),
      })),
    );
    render(<ResetPasswordPage params={{ token: "tok-ok-batch24" }} />);
    fireEvent.change(document.getElementById("password")!, { target: { value: "password123" } });
    fireEvent.change(document.getElementById("confirm")!, { target: { value: "password123" } });
    fireEvent.submit(screen.getByRole("button", { name: /Reset password/i }).closest("form")!);

    await waitFor(() => expect(screen.getByText(/Password reset/i)).toBeInTheDocument());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"), { timeout: 2500 });
  });
});
