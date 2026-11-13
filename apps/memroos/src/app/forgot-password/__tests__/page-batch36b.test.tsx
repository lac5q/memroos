/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import ForgotPasswordPage from "../page";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ForgotPasswordPage batch36b", () => {
  it("json().catch tolerates malformed success bodies (35)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => {
          throw new SyntaxError("not json");
        },
      })),
    );
    render(<ForgotPasswordPage />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "ops-b36b@memroos.test" } });
    fireEvent.submit(screen.getByRole("button", { name: /send reset link/i }).closest("form")!);
    await waitFor(() =>
      expect(screen.getByText(/If an account exists for that email/i)).toBeInTheDocument(),
    );
  });
});
