/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/api-client", () => ({
  useSkills: vi.fn(),
  useToolAttention: vi.fn(),
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }) => (
      <div {...props}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/skill-heatmap", () => ({
  SkillHeatmap: () => <div data-testid="skill-heatmap">heatmap</div>,
}));

vi.mock("../paperclip-fleet-panel", () => ({
  PaperclipFleetPanel: () => <div data-testid="paperclip-fleet">fleet</div>,
}));

import { NodeDetailPanel } from "../node-detail-panel";
import { useSkills, useToolAttention } from "@/lib/api-client";

const DEFAULT_PROPS = {
  nodeLabel: "Cookbooks",
  nodeIcon: "📚",
  nodeStats: { Skills: 3 },
  events: [],
  onClose: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("heartbeat down")),
  );
  vi.mocked(useSkills).mockReturnValue({
    data: {
      totalSkills: 4,
      contributionHistory: [],
      coverageGaps: [],
      failuresByAgent: {},
    },
    isLoading: false,
    isError: false,
  } as ReturnType<typeof useSkills>);
  vi.mocked(useToolAttention).mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
  } as ReturnType<typeof useToolAttention>);
});

describe("NodeDetailPanel batch19b", () => {
  it("shows loading state while heartbeat request is unresolved", async () => {
    render(<NodeDetailPanel {...DEFAULT_PROPS} nodeId="codex" />);
    expect(screen.getByText(/Loading state/i)).toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
  });

  it("renders no-activity copy for generic nodes", () => {
    render(<NodeDetailPanel {...DEFAULT_PROPS} nodeId="unknown-node" />);
    expect(screen.getByText(/No recent activity for this node/i)).toBeInTheDocument();
  });
});
