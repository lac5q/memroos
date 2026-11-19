/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/api-client", () => ({
  useHiveFeed: vi.fn(),
}));

import { useHiveFeed } from "@/lib/api-client";
import { HiveFeed } from "../hive-feed";

const mockUseHiveFeed = useHiveFeed as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("HiveFeed batch20", () => {
  it("uses default color chip for unknown action_type", () => {
    mockUseHiveFeed.mockReturnValue({
      data: {
        actions: [
          {
            id: 1,
            agent_id: "unknown-agent",
            action_type: "custom_action",
            summary: "Custom event",
            artifacts: null,
            timestamp: new Date().toISOString(),
          },
        ],
        timestamp: new Date().toISOString(),
      },
      isLoading: false,
    });
    render(<HiveFeed limit={5} />);
    const chip = screen.getByText("custom_action");
    expect(chip.className).toMatch(/slate/);
  });

  it("formats invalid timestamps via fallback slice", () => {
    mockUseHiveFeed.mockReturnValue({
      data: {
        actions: [
          {
            id: 2,
            agent_id: "hermes",
            action_type: "continue",
            summary: "Bad clock",
            artifacts: null,
            timestamp: "not-a-valid-date",
          },
        ],
        timestamp: new Date().toISOString(),
      },
      isLoading: false,
    });
    render(<HiveFeed />);
    expect(screen.getByText("not-a-valid-date".slice(0, 16))).toBeInTheDocument();
  });

  it("shows day-relative timestamps for older actions", () => {
    mockUseHiveFeed.mockReturnValue({
      data: {
        actions: [
          {
            id: 3,
            agent_id: "codex",
            action_type: "stop",
            summary: "Old stop",
            artifacts: null,
            timestamp: new Date(Date.now() - 2 * 86_400_000).toISOString(),
          },
        ],
        timestamp: new Date().toISOString(),
      },
      isLoading: false,
    });
    render(<HiveFeed />);
    expect(screen.getByText("2d ago")).toBeInTheDocument();
  });
});
