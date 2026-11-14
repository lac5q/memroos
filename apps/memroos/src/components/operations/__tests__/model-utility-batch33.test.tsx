/**
 * @vitest-environment jsdom
 */
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/api-client", () => ({
  useModelRoutingDashboard: vi.fn(),
}));

import { useModelRoutingDashboard } from "@/lib/api-client";
import { ModelUtility } from "../model-utility";

const mockRouting = vi.mocked(useModelRoutingDashboard);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ModelUtility batch33", () => {
  it("remote workspace rejects null agent ids and keeps remote rows (lines 13-14)", () => {
    const tag = randomUUID().slice(0, 8);
    mockRouting.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        events: [
          {
            model: `null-b33-${tag}`,
            agentId: null,
            inputTokens: 50,
            outputTokens: 25,
            createdAt: new Date().toISOString(),
          },
          {
            model: `remote-b33-${tag}`,
            agentId: "remote-agent",
            inputTokens: 50,
            outputTokens: 25,
            createdAt: new Date().toISOString(),
          },
          {
            model: `local-b33-${tag}`,
            agentId: "codex",
            inputTokens: 200,
            outputTokens: 100,
            createdAt: new Date().toISOString(),
          },
        ],
      },
    } as ReturnType<typeof useModelRoutingDashboard>);

    render(<ModelUtility filters={{ window: "24h", workspace: "remote" }} />);
    expect(screen.getByText(new RegExp(`remote-b33-${tag}`))).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(`local-b33-${tag}`))).toBeNull();
    expect(screen.queryByText(new RegExp(`null-b33-${tag}`))).toBeNull();
  });

  it("formatTokens renders k and m suffixes (lines 18-19)", () => {
    const tag = randomUUID().slice(0, 8);
    mockRouting.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        events: [
          {
            model: `big-k-b33-${tag}`,
            agentId: "codex",
            inputTokens: 900,
            outputTokens: 200,
            createdAt: new Date().toISOString(),
          },
          {
            model: `big-m-b33-${tag}`,
            agentId: "remote-agent",
            inputTokens: 700_000,
            outputTokens: 400_000,
            createdAt: new Date().toISOString(),
          },
        ],
      },
    } as ReturnType<typeof useModelRoutingDashboard>);

    render(<ModelUtility filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getByText("1.1k")).toBeInTheDocument();
    expect(screen.getByText("1.1m")).toBeInTheDocument();
  });
});
