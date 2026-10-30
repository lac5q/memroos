import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  params: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  useSearchParams: () => navigation.params,
}));

import LoginPage from "../login/page";
import ForgotPasswordPage from "../forgot-password/page";
import RegisterPage from "../register/page";
import TeamPage from "../team/page";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("Long-tail pages batch13", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigation.params = new URLSearchParams();
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("location", { assign: vi.fn() });
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("LoginPage handles network failures and onInput sync", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    render(<LoginPage />);

    const email = screen.getByLabelText("Email");
    fireEvent.input(email, { target: { value: "ops@memroos.com" } });
    fireEvent.input(screen.getByLabelText("Password"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(screen.getByText("Login failed. Please try again.")).toBeInTheDocument();
    });
  });

  it("ForgotPasswordPage handles API errors, catch, and onInput", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "rate limited" }),
      } as Response)
      .mockRejectedValueOnce(new Error("network"));

    render(<ForgotPasswordPage />);
    const email = screen.getByLabelText("Email");
    fireEvent.input(email, { target: { value: "ops@memroos.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    await waitFor(() => expect(screen.getByText("rate limited")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    await waitFor(() => {
      expect(screen.getByText("Could not request a reset. Please try again.")).toBeInTheDocument();
    });
  });

  it("RegisterPage shows invite copy and handles registration catch", async () => {
    navigation.params = new URLSearchParams({ token: "invite-abc" });
    vi.mocked(fetch).mockRejectedValue(new Error("down"));

    render(<RegisterPage />);
    expect(screen.getByText("Accept your invitation")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Alex" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(screen.getByText("Registration failed. Please try again.")).toBeInTheDocument();
    });
  });

  it("TeamPage closes invite modal after copy", async () => {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/users") && (!init || !init.method)) {
        return {
          ok: true,
          json: async () => ({
            users: [
              {
                id: "u1",
                email: "ops@memroos.com",
                displayName: "Ops",
                role: "admin",
                createdAt: "2026-01-01T00:00:00.000Z",
                lastLoginAt: null,
              },
            ],
          }),
        } as Response;
      }
      if (url.endsWith("/api/auth/invite") && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({ inviteUrl: "https://memroos.test.local/invite/token.test.local" }),
        } as Response;
      }
      throw new Error(url);
    });

    wrap(<TeamPage />);
    await waitFor(() => expect(screen.getByText("ops@memroos.com")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Invite user/i }));
    fireEvent.click(screen.getByRole("button", { name: /Generate invite link/i }));
    await waitFor(() => expect(screen.getByText(/token\.test\.local/)).toBeInTheDocument());

    const copyButtons = screen.getAllByRole("button").filter((btn) => btn.className.includes("flex-shrink-0"));
    fireEvent.click(copyButtons[0]);
    expect(navigator.clipboard.writeText).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByText(/Invite link generated/i)).not.toBeInTheDocument();
    });
  });
});
