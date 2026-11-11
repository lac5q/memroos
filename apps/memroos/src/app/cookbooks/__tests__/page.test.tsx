import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const api = vi.hoisted(() => ({
  useSkills: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  useSkills: api.useSkills,
}));

vi.mock("@/components/cookbooks/skills-list", () => ({
  SkillsList: () => <div data-testid="skills-list" />,
}));
vi.mock("@/components/cookbooks/health-panel", () => ({
  HealthPanel: () => <div data-testid="health-panel" />,
}));
vi.mock("@/components/cookbooks/tool-attention-panel", () => ({
  ToolAttentionPanel: () => <div data-testid="tool-attention" />,
}));
vi.mock("@/components/cookbooks/similar-task-panel", () => ({
  SimilarTaskPanel: () => <div data-testid="similar-task" />,
}));
vi.mock("@/components/cookbooks/analytics-panel", () => ({
  CookbooksAnalyticsPanel: () => <div data-testid="analytics-panel" />,
}));
vi.mock("@/components/skill-heatmap", () => ({
  SkillHeatmap: () => <div data-testid="skill-heatmap" />,
}));
vi.mock("@/components/ui/info-tip", () => ({
  InfoTip: () => null,
}));
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import CookbooksPage from "../page";

describe("CookbooksPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading spinner while skills load", () => {
    api.useSkills.mockReturnValue({ data: undefined, isLoading: true });
    const { container } = render(<CookbooksPage />);
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("renders skills workflow sections when loaded", () => {
    api.useSkills.mockReturnValue({
      isLoading: false,
      data: {
        totalSkills: 2,
        allSkills: ["a", "b"],
        skillDetails: [],
        coverageGaps: [],
        coverageTelemetryStatus: "tracked",
        failuresByAgent: {},
        failuresByErrorType: {},
        lastUpdated: null,
        staleCandidates: 0,
        contributionHistory: [],
      },
    });

    render(<CookbooksPage />);
    expect(screen.getByRole("heading", { name: "Skills" })).toBeInTheDocument();
    expect(screen.getByTestId("skills-list")).toBeInTheDocument();
    expect(screen.getByTestId("health-panel")).toBeInTheDocument();
    expect(screen.getByTestId("tool-attention")).toBeInTheDocument();
    expect(screen.getByTestId("similar-task")).toBeInTheDocument();
    expect(screen.getByTestId("analytics-panel")).toBeInTheDocument();
    expect(screen.getByTestId("skill-heatmap")).toBeInTheDocument();
  });
});
