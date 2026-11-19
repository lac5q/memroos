import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/ui/info-tip", () => ({
  InfoTip: () => null,
}));
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { HealthPanel } from "../health-panel";

describe("Cookbooks HealthPanel", () => {
  it("renders skill health stats", () => {
    render(
      <HealthPanel
        totalSkills={12}
        coverageGaps={["old-skill"]}
        coverageTelemetryStatus="tracked"
        failuresByAgent={{ "agent-a": 2 }}
        failuresByErrorType={{ timeout: 1 }}
        lastUpdated="2026-05-20T12:00:00.000Z"
        staleCandidates={3}
        skillBudget={{
          status: "ok",
          budgetTokens: 1000,
          metadataTokens: 200,
          metadataChars: 800,
          utilization: 0.2,
          uniqueSkills: 12,
          averageDescriptionChars: 120,
          recommendations: [],
        }}
      />
    );

    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Total Skills")).toBeInTheDocument();
    expect(screen.getByText("Stale Candidates")).toBeInTheDocument();
    expect(screen.getByText("agent-a")).toBeInTheDocument();
  });
});
