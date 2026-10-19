import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const api = vi.hoisted(() => ({
  useSkillRegistry: vi.fn(),
  useSkillSuggestions: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  useSkillRegistry: api.useSkillRegistry,
  useSkillSuggestions: api.useSkillSuggestions,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

import SkillsRegistryPage from "../page";
import type { SkillRegistryItem, SkillSuggestion } from "@/lib/api-client";

const SKILL: SkillRegistryItem = {
  id: 1,
  name: "deploy-check",
  description: "Pre-deploy verification contract",
  owner: "platform",
  source_harness: "codex",
  risk_tier: "medium",
  dispatch_status: "incomplete",
  version: "1.0.0",
  completeness_pct: 72,
  missing_fields: ["owner_email", "rollback_plan"],
  missing_fields_json: null,
  verification_checks_list: ["lint passes", "tests green"],
  verification_checks: null,
  imported_by: "operator",
  imported_at: "2026-07-01T12:00:00.000Z",
};

const SUGGESTION: SkillSuggestion = {
  id: "sug-1",
  name: "incident-triage",
  slug: "incident-triage",
  sourcePattern: "escalation-loop",
  recommendation: "Promote to governed registry after harness parity review.",
  confidence: 0.82,
  evidence: ["3 repeated escalations", "shared playbook gap"],
  comparedHarnesses: {
    codex: { exists: true, path: "/skills/incident-triage" },
    claude: { exists: false, path: null },
  },
  status: "proposed",
};

function mockHappyPath(items: SkillRegistryItem[] = [SKILL], total = 1) {
  api.useSkillRegistry.mockReturnValue({
    data: { items, total, limit: 20, offset: 0 },
    isLoading: false,
    isError: false,
  });
  api.useSkillSuggestions.mockReturnValue({
    data: { suggestions: [SUGGESTION], timestamp: "2026-07-13T12:00:00.000Z", ok: true, windowDays: 30 },
    isLoading: false,
    isError: false,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHappyPath();
});

describe("SkillsRegistryPage", () => {
  it("renders governed registry header and skill rows", () => {
    render(<SkillsRegistryPage />);

    expect(screen.getByText("Governed Skill Registry")).toBeInTheDocument();
    expect(screen.getByText("deploy-check")).toBeInTheDocument();
    expect(screen.getByText("Incomplete")).toBeInTheDocument();
    expect(screen.getAllByText("codex").length).toBeGreaterThan(0);
    expect(screen.getByText("medium")).toBeInTheDocument();
    expect(screen.getByText("72%")).toBeInTheDocument();
  });

  it("shows not-ready banner and expands verification checks", () => {
    render(<SkillsRegistryPage />);

    expect(screen.getByText(/Not ready for dispatch/i)).toBeInTheDocument();
    expect(screen.getByText(/owner_email, rollback_plan/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Show verification checks/i }));
    expect(screen.getByText("lint passes")).toBeInTheDocument();
    expect(screen.getByText("tests green")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Hide verification checks/i }));
    expect(screen.queryByText("lint passes")).not.toBeInTheDocument();
  });

  it("renders suggested skills with missing harness coverage", () => {
    render(<SkillsRegistryPage />);

    expect(screen.getByText("incident-triage")).toBeInTheDocument();
    expect(screen.getByText("Proposed")).toBeInTheDocument();
    expect(screen.getByText("82%")).toBeInTheDocument();
    expect(screen.getByText(/Missing in:/)).toBeInTheDocument();
    expect(screen.getByText(/claude/)).toBeInTheDocument();
  });

  it("shows loading and error states for registry and suggestions", () => {
    api.useSkillRegistry.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });
    api.useSkillSuggestions.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    const { rerender } = render(<SkillsRegistryPage />);
    expect(document.querySelector(".animate-spin")).toBeTruthy();
    expect(screen.getByText(/Loading suggested skills/i)).toBeInTheDocument();

    api.useSkillRegistry.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });
    api.useSkillSuggestions.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });
    rerender(<SkillsRegistryPage />);

    expect(screen.getByText(/Failed to load governed registry skills/i)).toBeInTheDocument();
    expect(screen.getByText(/Failed to load suggested skills/i)).toBeInTheDocument();
  });

  it("shows empty states when no skills or suggestions are returned", () => {
    api.useSkillRegistry.mockReturnValue({
      data: { items: [], total: 0, limit: 20, offset: 0 },
      isLoading: false,
      isError: false,
    });
    api.useSkillSuggestions.mockReturnValue({
      data: { suggestions: [], timestamp: "2026-07-13T12:00:00.000Z", ok: true, windowDays: 30 },
      isLoading: false,
      isError: false,
    });

    render(<SkillsRegistryPage />);

    expect(screen.getByText(/No governed skills found/i)).toBeInTheDocument();
    expect(screen.getByText(/No activity-backed suggestions found/i)).toBeInTheDocument();
  });

  it("filters by dispatch status and source harness", () => {
    mockHappyPath([
      SKILL,
      {
        ...SKILL,
        id: 2,
        name: "ready-skill",
        source_harness: "claude",
        dispatch_status: "enabled",
        completeness_pct: 100,
        missing_fields: [],
      },
    ], 2);

    render(<SkillsRegistryPage />);

    fireEvent.click(screen.getByRole("button", { name: "enabled" }));
    expect(api.useSkillRegistry).toHaveBeenLastCalledWith(
      expect.objectContaining({ dispatch_status: "enabled", offset: 0 }),
    );

    fireEvent.click(screen.getByRole("button", { name: "claude" }));
    expect(api.useSkillRegistry).toHaveBeenLastCalledWith(
      expect.objectContaining({ source_harness: "claude", offset: 0 }),
    );
  });

  it("renders pagination controls when more than one page exists", () => {
    mockHappyPath([SKILL], 45);

    render(<SkillsRegistryPage />);

    expect(screen.getByText(/Showing 1–20 of 45 skills/i)).toBeInTheDocument();
    const next = screen.getByRole("button", { name: "Next" });
    expect(next).not.toBeDisabled();

    fireEvent.click(next);
    expect(api.useSkillRegistry).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 20 }),
    );
  });

  it("shows registry loading spinner while fetch is pending", () => {
    api.useSkillRegistry.mockReturnValue({
      data: undefined,
      error: null,
      isLoading: true,
      isError: false,
    });
    api.useSkillSuggestions.mockReturnValue({
      data: { suggestions: [], ok: true, windowDays: 30, timestamp: "2026-01-01T00:00:00.000Z" },
      isLoading: false,
      isError: false,
    });
    const { container } = render(<SkillsRegistryPage />);
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("links to the cookbooks page for filesystem-discovered skills", () => {
    render(<SkillsRegistryPage />);

    const link = screen.getByRole("link", { name: /Skills \(Cookbooks\)/i });
    expect(link).toHaveAttribute("href", "/cookbooks");
  });
});
