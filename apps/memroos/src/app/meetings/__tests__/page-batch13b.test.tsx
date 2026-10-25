/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/components/voice/consent-dialog", () => ({
  ConsentDialog: ({
    open,
    onConfirm,
  }: {
    open: boolean;
    onConfirm: () => void;
  }) =>
    open ? (
      <button type="button" onClick={onConfirm}>
        Accept consent batch13b
      </button>
    ) : null,
}));

import MeetingsPage from "../page";

describe("MeetingsPage batch13b", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("surfaces join failures when the response body is not JSON", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("not json");
      },
    } as Response);
    render(<MeetingsPage />);
    fireEvent.change(screen.getByPlaceholderText("https://..."), {
      target: { value: "https://daily.test.local/room" },
    });
    fireEvent.change(screen.getByLabelText("Join token"), { target: { value: "token" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Consent" }));
    fireEvent.click(screen.getByRole("button", { name: "Accept consent batch13b" }));
    fireEvent.click(screen.getByRole("button", { name: "Join Meeting" }));
    await waitFor(() => {
      expect(screen.getByText(/Join failed: 502/i)).toBeInTheDocument();
    });
  });

  it("surfaces network failures during join", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    render(<MeetingsPage />);
    fireEvent.change(screen.getByPlaceholderText("https://..."), {
      target: { value: "https://daily.test.local/room" },
    });
    fireEvent.change(screen.getByLabelText("Join token"), { target: { value: "token" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Consent" }));
    fireEvent.click(screen.getByRole("button", { name: "Accept consent batch13b" }));
    fireEvent.click(screen.getByRole("button", { name: "Join Meeting" }));
    await waitFor(() => {
      expect(screen.getByText("offline")).toBeInTheDocument();
    });
  });
});
