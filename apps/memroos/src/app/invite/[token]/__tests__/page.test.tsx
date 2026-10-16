import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  useParams: () => ({ token: "invite-token" }),
}));

import InvitePage from "../page";

describe("InvitePage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("shows loading while validating", () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => undefined));
    render(<InvitePage />);
    expect(screen.getByText("Validating invitation…")).toBeInTheDocument();
  });

  it("shows invalid invitation state", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);
    render(<InvitePage />);

    await waitFor(() => {
      expect(screen.getByText("Invitation Invalid")).toBeInTheDocument();
    });
  });

  it("renders join form for valid invite", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ role: "reviewer", emailHint: "new@memroos.com" }),
    } as Response);

    render(<InvitePage />);

    await waitFor(() => {
      expect(screen.getByText("Join Memroos")).toBeInTheDocument();
      expect(screen.getByText(/reviewer/)).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue("new@memroos.com")).toBeInTheDocument();
  });
});
