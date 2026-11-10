/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import ResetPasswordPage from "../[token]/page";

describe("ResetPasswordPage batch25b", () => {
  it("requires minimum password length before submit", async () => {
    render(<ResetPasswordPage params={{ token: "tok-short-b25b" }} />);
    fireEvent.change(document.getElementById("password")!, { target: { value: "short" } });
    fireEvent.change(document.getElementById("confirm")!, { target: { value: "short" } });
    fireEvent.submit(screen.getByRole("button", { name: /Reset password/i }).closest("form")!);
    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument();
  });
});
