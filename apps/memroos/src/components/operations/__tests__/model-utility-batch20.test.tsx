/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/api-client", () => ({
  useModelRoutingDashboard: vi.fn(),
}));

import { useModelRoutingDashboard } from "@/lib/api-client";
import { ModelUtility } from "../model-utility";

const mockRouting = useModelRoutingDashboard as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ModelUtility batch20", () => {
  it("shows window_empty when history exists outside selected window", () => {
    mockRouting.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        events: [
          {
            model: "gpt-old",
            agentId: "codex",
            inputTokens: 100,
            outputTokens: 50,
            createdAt: new Date(Date.now() - 7 * 86_400_000).toISOString(),
          },
        ],
      },
    });
    render(<ModelUtility filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getByText(/Nothing in/i)).toBeInTheDocument();
    expect(screen.getByText(/Widen the window/i)).toBeInTheDocument();
  });

  it("filters to local workspace agents only", () => {
    mockRouting.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        events: [
          {
            model: "gpt-local",
            agentId: "codex",
            inputTokens: 200,
            outputTokens: 100,
            createdAt: new Date().toISOString(),
          },
          {
            model: "gpt-remote",
            agentId: "remote-agent",
            inputTokens: 500,
            outputTokens: 200,
            createdAt: new Date().toISOString(),
          },
        ],
      },
    });
    render(<ModelUtility filters={{ window: "24h", workspace: "local" }} />);
    expect(screen.getByText(/gpt-local/)).toBeInTheDocument();
    expect(screen.queryByText("gpt-remote")).toBeNull();
  });

  it("shows stale_or_error block when routing query fails", () => {
    mockRouting.mockReturnValue({ isLoading: false, isError: true, data: undefined });
    render(<ModelUtility />);
    expect(screen.getByText(/stale or unavailable/i)).toBeInTheDocument();
  });
});
