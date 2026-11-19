import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import * as fs from "fs";
import * as path from "path";

// Mock useSkills for NodeDetailPanel tests
vi.mock("@/lib/api-client", () => ({
  useSkills: vi.fn(),
  useToolAttention: vi.fn(() => ({ data: undefined, isLoading: false })),
  useActivity: vi.fn(() => ({ data: undefined })),
}));

// Mock framer-motion to avoid animation complexity in tests
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }) => (
      <div {...props}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { SkillHeatmap } from "@/components/skill-heatmap";
import { NodeDetailPanel } from "@/components/flow/node-detail-panel";
import { useSkills } from "@/lib/api-client";

const mockUseSkills = vi.mocked(useSkills);

// Sample contribution history for tests
function makeSampleHistory(skills: string[], days: number[] = [1]) {
  return skills.flatMap(skill =>
    days.map(d => ({
      skill,
      date: new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      count: d,
    }))
  );
}

const DEFAULT_PANEL_PROPS = {
  nodeLabel: "Test Node",
  nodeIcon: "🔧",
  nodeStats: {},
  events: [],
  onClose: () => {},
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUseSkills.mockReturnValue({
    data: {
      totalSkills: 0,
      contributedByHermes: 0,
      contributedByGwen: 0,
      recentContributions: [],
      lastPruned: null,
      staleCandidates: 0,
      coverageGaps: [],
      lastUpdated: null,
      failuresByAgent: {},
      failuresByErrorType: {},
      contributionHistory: [],
      timestamp: new Date().toISOString(),
    },
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useSkills>);
});

describe("SkillHeatmap component", () => {
  it("Test 1 (renders heading): component renders the exact text 'Contribution Activity'", () => {
    const history = makeSampleHistory(["alpha"], [1]);
    render(<SkillHeatmap contributionHistory={history} />);
    expect(screen.getByText("Contribution Activity")).toBeTruthy();
  });

  it("Test 2 (renders grid with 30 columns): non-empty history → 30 day columns in the grid", () => {
    const history = makeSampleHistory(["alpha"], [1, 2, 3]);
    const { container } = render(<SkillHeatmap contributionHistory={history} days={30} />);
    // Each row has gridTemplateColumns with 30 + 1 (label) columns
    // Verify 30 cells per skill row
    const cells = container.querySelectorAll("[data-testid^='heatmap-cell-alpha-']");
    expect(cells.length).toBe(30);
  });

  it("Test 3 (renders one row per unique skill): 3 skills → 3 rows of cells", () => {
    const history = makeSampleHistory(["alpha", "beta", "gamma"], [1]);
    const { container } = render(<SkillHeatmap contributionHistory={history} />);
    // One set of cells per skill
    const alphaCells = container.querySelectorAll("[data-testid^='heatmap-cell-alpha-']");
    const betaCells = container.querySelectorAll("[data-testid^='heatmap-cell-beta-']");
    const gammaCells = container.querySelectorAll("[data-testid^='heatmap-cell-gamma-']");
    expect(alphaCells.length).toBe(30);
    expect(betaCells.length).toBe(30);
    expect(gammaCells.length).toBe(30);
  });

  it("Test 4 (color intensity scales with count): distinct bg classes for count 0, 1, 3, 6, 11", () => {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const dayBefore = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const history = [
      { skill: "alpha", date: today, count: 1 },
      { skill: "alpha", date: yesterday, count: 6 },
      { skill: "alpha", date: dayBefore, count: 11 },
    ];
    const { container } = render(<SkillHeatmap contributionHistory={history} />);
    // Cell with count=0 (a day not in history)
    const allCells = container.querySelectorAll("[data-count]");
    const zeroCells = Array.from(allCells).filter(c => c.getAttribute("data-count") === "0");
    const oneCells = Array.from(allCells).filter(c => c.getAttribute("data-count") === "1");
    const sixCells = Array.from(allCells).filter(c => c.getAttribute("data-count") === "6");
    const elevenCells = Array.from(allCells).filter(c => c.getAttribute("data-count") === "11");
    expect(zeroCells.length).toBeGreaterThan(0);
    expect(oneCells.length).toBeGreaterThan(0);
    expect(sixCells.length).toBeGreaterThan(0);
    expect(elevenCells.length).toBeGreaterThan(0);
    // Classes should differ between intensity levels
    const zeroClass = zeroCells[0].className;
    const oneClass = oneCells[0].className;
    const sixClass = sixCells[0].className;
    const elevenClass = elevenCells[0].className;
    // All four should have different background classes (at least 3 distinct values across 4)
    const uniqueClasses = new Set([zeroClass, oneClass, sixClass, elevenClass]);
    expect(uniqueClasses.size).toBeGreaterThanOrEqual(3);
  });

  it("Test 5 (empty data — clamp to 1 column minimum): [] contributionHistory renders without crash + shows empty-state", () => {
    const { container } = render(<SkillHeatmap contributionHistory={[]} />);
    // Should not crash — component should be in the document
    expect(container.firstChild).toBeTruthy();
    // Should show "Contribution Activity" heading even in empty state
    expect(screen.getByText("Contribution Activity")).toBeTruthy();
    // Should show at least 1 grid element (placeholder)
    const emptyGrid = container.querySelector("[data-testid='heatmap-grid-empty']");
    expect(emptyGrid).toBeTruthy();
    // Should show an empty-state message
    const emptyMsg = screen.getByText(/No contributions/i);
    expect(emptyMsg).toBeTruthy();
  });

  it("Test 6 (NO new dependency): component only imports from react and project-local paths", () => {
    const componentPath = path.resolve(
      process.cwd(),
      "src/components/skill-heatmap.tsx"
    );
    const source = fs.readFileSync(componentPath, "utf-8");
    // Denylist: chart libraries that must not appear
    const forbidden = ["recharts", "d3", "chart.js", "nivo", "visx", "victory", "highcharts"];
    for (const lib of forbidden) {
      expect(source).not.toMatch(new RegExp(`from ['"]${lib}`));
    }
  });

  it("Test 7 (cell-local hover does not cascade): HeatmapCell is wrapped in React.memo", () => {
    // Verify memo wrapping by reading source — behavioral render-count tests are fragile with React 19
    const componentPath = path.resolve(
      process.cwd(),
      "src/components/skill-heatmap.tsx"
    );
    const source = fs.readFileSync(componentPath, "utf-8");
    // Must use memo() wrapper with a named function
    expect(source).toMatch(/memo\(function HeatmapCell/);
    // Hover state must be useState inside HeatmapCell (local state, not lifted)
    expect(source).toMatch(/useState[\s\S]*isHovered|isHovered[\s\S]*useState/);
    // Verify cell-local hover works: mouseEnter on one cell should not affect others
    const history = makeSampleHistory(["alpha", "beta"], [1, 2]);
    const { container } = render(<SkillHeatmap contributionHistory={history} />);
    const cells = container.querySelectorAll("[data-testid^='heatmap-cell-alpha-']");
    expect(cells.length).toBe(30);
    // Hover first alpha cell
    const firstCell = cells[0];
    fireEvent.mouseEnter(firstCell);
    // First cell should have ring class (hovered state)
    expect(firstCell.className).toMatch(/ring/);
    fireEvent.mouseLeave(firstCell);
    expect(firstCell.className).not.toMatch(/ring/);
    // Second alpha cell should NOT have ring class
    expect(cells[1].className).not.toMatch(/ring/);
  });

  it("Test 8 (NodeDetailPanel renders SkillHeatmap when cookbooks node selected): heading visible", () => {
    mockUseSkills.mockReturnValue({
      data: {
        totalSkills: 5,
        contributedByHermes: 2,
        contributedByGwen: 1,
        recentContributions: [],
        lastPruned: null,
        staleCandidates: 0,
        coverageGaps: [],
        lastUpdated: null,
        failuresByAgent: {},
        failuresByErrorType: {},
        contributionHistory: [
          { skill: "alpha", date: new Date().toISOString().slice(0, 10), count: 3 },
        ],
        timestamp: new Date().toISOString(),
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useSkills>);

    render(
      <NodeDetailPanel
        {...DEFAULT_PANEL_PROPS}
        nodeId="cookbooks"
        nodeLabel="Cookbooks"
      />
    );
    expect(screen.getByText("Contribution Activity")).toBeTruthy();
  });

  it("Test 9 (NodeDetailPanel does NOT render SkillHeatmap for other nodes): heading absent for non-cookbooks", () => {
    render(
      <NodeDetailPanel
        {...DEFAULT_PANEL_PROPS}
        nodeId="claude"
        nodeLabel="Claude"
      />
    );
    expect(screen.queryByText("Contribution Activity")).toBeNull();
  });
});
