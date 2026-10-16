import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
  useParams: () => ({ token: "invite-token" }),
}));

import InvitePage from "../page";

describe("InvitePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("registers account and navigates on success", async () => {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/auth/invite/")) {
        return { ok: true, json: async () => ({ role: "operator" }) } as Response;
      }
      if (url.endsWith("/api/auth/register") && init?.method === "POST") {
        return { ok: true, json: async () => ({ id: "u-new" }) } as Response;
      }
      throw new Error(url);
    });

    render(<InvitePage />);
    await waitFor(() => expect(screen.getByText("Join Memroos")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@memroos.com" } });
    fireEvent.change(screen.getByLabelText("Display Name"), { target: { value: "New User" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password.test.local" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(navigation.push).toHaveBeenCalledWith("/login?message=account-created");
    });
  });

  it("shows duplicate email and registration errors", async () => {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/auth/invite/")) {
        return { ok: true, json: async () => ({ role: "reviewer" }) } as Response;
      }
      if (url.endsWith("/api/auth/register") && init?.method === "POST") {
        return { ok: false, status: 409, json: async () => ({ error: "duplicate" }) } as Response;
      }
      throw new Error(url);
    });

    render(<InvitePage />);
    await waitFor(() => expect(screen.getByText("Join Memroos")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "exists@memroos.com" } });
    fireEvent.change(screen.getByLabelText("Display Name"), { target: { value: "Exists" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password.test.local" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(screen.getByText("This email is already registered.")).toBeInTheDocument();
    });
  });
});
