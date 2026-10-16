import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

import TeamPage from "../page";

describe("TeamPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
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
      })),
    );
  });

  it("renders team members", async () => {
    wrap(<TeamPage />);
    expect(screen.getByText("Team")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("ops@memroos.com")).toBeInTheDocument();
    });
    expect(screen.getByText("admin")).toBeInTheDocument();
  });
});
