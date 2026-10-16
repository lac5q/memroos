import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/voice/consent-dialog", () => ({
  ConsentDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="consent-dialog" /> : null),
}));

import MeetingsPage from "../page";

describe("MeetingsPage", () => {
  it("renders meetings join form", () => {
    render(<MeetingsPage />);
    expect(screen.getByText("Meetings")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Q2 strategy sync")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Join Meeting" })).toBeInTheDocument();
  });
});
