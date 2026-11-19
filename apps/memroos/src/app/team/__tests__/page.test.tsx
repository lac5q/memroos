import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, mutations: { retry: false } } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

import TeamPage from "../page";

describe("TeamPage", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
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
                {
                  id: "u2",
                  email: "operator@memroos.com",
                  displayName: "Operator",
                  role: "operator",
                  createdAt: "2026-01-01T00:00:00.000Z",
                  lastLoginAt: "2026-06-01T00:00:00.000Z",
                },
              ],
            }),
          } as Response;
        }
        if (url.endsWith("/api/auth/invite") && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as { role: string; emailHint?: string };
          if (body.role === "admin") {
            return { ok: false, json: async () => ({ error: "401 admin only" }) } as Response;
          }
          return {
            ok: true,
            json: async () => ({ inviteUrl: "https://memroos.test.local/invite/token.test.local" }),
          } as Response;
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  it("renders team members", async () => {
    wrap(<TeamPage />);
    expect(screen.getByText("Team")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("ops@memroos.com")).toBeInTheDocument();
    });
    expect(screen.getByText("admin")).toBeInTheDocument();
    expect(screen.getByText("Never")).toBeInTheDocument();
  });

  it("creates invite links and copies them", async () => {
    wrap(<TeamPage />);
    await waitFor(() => expect(screen.getByText("operator@memroos.com")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Invite user/i }));
    fireEvent.change(screen.getByLabelText("Email hint (optional)"), {
      target: { value: "new@memroos.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Generate invite link/i }));

    await waitFor(() => {
      expect(screen.getByText(/token\.test\.local/)).toBeInTheDocument();
    });

    const copyButtons = screen.getAllByRole("button").filter((btn) => btn.className.includes("flex-shrink-0"));
    fireEvent.click(copyButtons[0]);
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
  });

  it("shows load error for unauthorized viewers", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/users")) {
        return { ok: false, status: 401, json: async () => ({ error: "401" }) } as Response;
      }
      throw new Error(url);
    });

    wrap(<TeamPage />);
    await waitFor(() => {
      expect(screen.getByText(/Failed to load team members/i)).toBeInTheDocument();
    });
  });

  it("shows invite mutation errors", async () => {
    wrap(<TeamPage />);
    await waitFor(() => expect(screen.getByText("ops@memroos.com")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Invite user/i }));
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "admin" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate invite link/i }));
    await waitFor(() => expect(screen.getByText("401 admin only")).toBeInTheDocument());
  });
});
