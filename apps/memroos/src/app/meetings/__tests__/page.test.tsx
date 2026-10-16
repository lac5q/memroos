import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/components/voice/consent-dialog", () => ({
  ConsentDialog: ({
    open,
    onConfirm,
    onCancel,
  }: {
    open: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  }) =>
    open ? (
      <div data-testid="consent-dialog">
        <button type="button" onClick={onConfirm}>
          Accept consent
        </button>
        <button type="button" onClick={onCancel}>
          Dismiss consent
        </button>
      </div>
    ) : null,
}));

import MeetingsPage from "../page";

describe("MeetingsPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { roomUrl?: string };
        if (body.roomUrl?.includes("fail.test.local")) {
          return { ok: false, status: 503, json: async () => ({ error: "Room unavailable" }) } as Response;
        }
        return { ok: true, json: async () => ({ meeting_id: "meet-123" }) } as Response;
      }),
    );
  });

  it("renders meetings join form", () => {
    render(<MeetingsPage />);
    expect(screen.getByText("Meetings")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Q2 strategy sync")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Join Meeting" })).toBeDisabled();
  });

  it("requires consent before joining and shows success", async () => {
    render(<MeetingsPage />);
    fireEvent.change(screen.getByPlaceholderText("Q2 strategy sync"), { target: { value: "Daily sync" } });
    fireEvent.change(screen.getByPlaceholderText("https://..."), {
      target: { value: "https://daily.test.local/room" },
    });
    fireEvent.change(screen.getByLabelText("Join token"), { target: { value: "token.test.local" } });

    fireEvent.click(screen.getByRole("button", { name: "Confirm Consent" }));
    fireEvent.click(screen.getByRole("button", { name: "Accept consent" }));
    expect(screen.getByText("Recording consent confirmed")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Join Meeting" }));
    await waitFor(() => {
      expect(screen.getByText("meet-123")).toBeInTheDocument();
    });
  });

  it("clears consent when room changes and surfaces join errors", async () => {
    render(<MeetingsPage />);
    fireEvent.change(screen.getByPlaceholderText("https://..."), {
      target: { value: "https://daily.test.local/room" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Consent" }));
    fireEvent.click(screen.getByRole("button", { name: "Accept consent" }));

    fireEvent.change(screen.getByPlaceholderText("https://..."), {
      target: { value: "https://fail.test.local/room" },
    });
    expect(screen.queryByText("Recording consent confirmed")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Join token"), { target: { value: "token.test.local" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Consent" }));
    fireEvent.click(screen.getByRole("button", { name: "Accept consent" }));
    fireEvent.click(screen.getByRole("button", { name: "Join Meeting" }));

    await waitFor(() => {
      expect(screen.getByText("Room unavailable")).toBeInTheDocument();
    });
  });
});
