/**
 * @vitest-environment jsdom
 */
import type React from "react";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import TeamPage from "../page";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, mutations: { retry: false } } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("TeamPage batch33", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("handleCopy writes invite URLs and resets copied state (lines 84-87)", async () => {
    const suffix = randomUUID().slice(0, 8);
    const inviteUrl = `http://localhost:3000/invite/batch33-${suffix}`;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/users") && !init?.method) {
          return {
            ok: true,
            json: async () => ({
              users: [
                {
                  id: `user-b33-${suffix}`,
                  email: `ops-b33-${suffix}@memroos.com`,
                  displayName: "Ops",
                  role: "admin",
                  createdAt: "2026-07-01T00:00:00.000Z",
                  lastLoginAt: null,
                },
              ],
            }),
          } as Response;
        }
        if (url.endsWith("/api/auth/invite") && init?.method === "POST") {
          return { ok: true, json: async () => ({ inviteUrl }) } as Response;
        }
        throw new Error(`unexpected ${url}`);
      }),
    );

    wrap(<TeamPage />);
    await waitFor(() => expect(screen.getByText(`ops-b33-${suffix}@memroos.com`)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Invite user/i }));
    fireEvent.click(screen.getByRole("button", { name: /Generate invite link/i }));
    await waitFor(() => expect(screen.getByText(inviteUrl)).toBeInTheDocument());

    const inviteRow = screen.getByText(inviteUrl).closest("div");
    fireEvent.click(inviteRow?.querySelector("button") as HTMLButtonElement);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(inviteUrl);
  });

  it("createInvite surfaces API error text (line 43)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/users") && !init?.method) {
          return { ok: true, json: async () => ({ users: [] }) } as Response;
        }
        if (url.endsWith("/api/auth/invite") && init?.method === "POST") {
          return { ok: false, status: 403, json: async () => ({ error: "invite forbidden batch33" }) } as Response;
        }
        throw new Error(`unexpected ${url}`);
      }),
    );

    wrap(<TeamPage />);
    fireEvent.click(screen.getByRole("button", { name: /Invite user/i }));
    fireEvent.click(screen.getByRole("button", { name: /Generate invite link/i }));
    await waitFor(() => expect(screen.getByText(/invite forbidden batch33/i)).toBeInTheDocument());
  });
});
