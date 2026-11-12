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

describe("TeamPage batch35", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("handleCopy resets copied flag after timeout (line 87)", async () => {
    const suffix = randomUUID().slice(0, 8);
    const inviteUrl = `http://localhost:3000/invite/b35-${suffix}`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/users") && !init?.method) {
          return { ok: true, json: async () => ({ users: [] }) } as Response;
        }
        if (url.endsWith("/api/auth/invite") && init?.method === "POST") {
          return { ok: true, json: async () => ({ inviteUrl }) } as Response;
        }
        throw new Error(`unexpected ${url}`);
      }),
    );

    wrap(<TeamPage />);
    fireEvent.click(screen.getByRole("button", { name: /Invite user/i }));
    fireEvent.click(screen.getByRole("button", { name: /Generate invite link/i }));
    await waitFor(() => expect(screen.getByText(inviteUrl)).toBeInTheDocument());

    const copyBtn = screen.getByText(inviteUrl).parentElement?.querySelector("button");
    expect(copyBtn).toBeTruthy();
    fireEvent.click(copyBtn!);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(inviteUrl);
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(2000);
    vi.useRealTimers();
    expect(screen.queryByText(/^Copied$/i)).not.toBeInTheDocument();
  });
});
