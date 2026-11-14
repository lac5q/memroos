/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    useUpdateSkillReviewMutation: vi.fn(),
  };
});

import { SkillsList } from "@/components/cookbooks/skills-list";
import { useUpdateSkillReviewMutation, type SkillWorkflowItem } from "@/lib/api-client";

const mutateAsync = vi.fn();
const mockUseUpdateSkillReviewMutation = vi.mocked(useUpdateSkillReviewMutation);

const skillA: SkillWorkflowItem = {
  name: "alpha-skill",
  title: "Alpha Skill",
  path: "/tmp/alpha/SKILL.md",
  description: "First skill in list.",
  bodyPreview: "Alpha body.",
  stage: "general",
  reviewStatus: "approved",
  reviewNotes: "",
  draftBody: "",
  changeReason: "",
  owner: "ops-team",
  tags: ["alpha"],
  health: "ready",
  lastActivityAt: "2026-05-17T10:00:00.000Z",
  maturityScore: 70,
  updatedAt: "2026-05-17T11:00:00.000Z",
  approvedAt: "2026-05-17T11:00:00.000Z",
  usageCount: 1,
};

const skillB: SkillWorkflowItem = {
  ...skillA,
  name: "beta-skill",
  title: "Beta Skill",
  description: "Second skill for selection.",
  bodyPreview: "Beta body.",
  owner: "platform",
  tags: ["beta"],
  usageCount: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  mutateAsync.mockResolvedValue({ ok: true });
  mockUseUpdateSkillReviewMutation.mockReturnValue({
    mutateAsync,
    isPending: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useUpdateSkillReviewMutation>);
});

describe("SkillsList batch21", () => {
  it("filters the skill list and selects another skill from search results", () => {
    render(
      <SkillsList
        totalSkills={2}
        allSkills={["alpha-skill", "beta-skill"]}
        skillDetails={[skillA, skillB]}
        coverageGaps={[]}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/Search skill/i), {
      target: { value: "platform" },
    });
    expect(screen.getByText("Beta Skill")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Alpha Skill/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Beta Skill/i }));
    expect(screen.getByLabelText("Skill edit draft")).toBeInTheDocument();
  });

  it("includes change reason on save draft and shows draft notice", async () => {
    render(
      <SkillsList totalSkills={1} allSkills={["alpha-skill"]} skillDetails={[skillA]} coverageGaps={[]} />,
    );

    fireEvent.change(screen.getByLabelText("Reason for this change"), {
      target: { value: "Tighten operator guidance" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save draft/i }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "save-draft",
          changeReason: "Tighten operator guidance",
        }),
      );
      expect(screen.getByText("Draft saved.")).toBeInTheDocument();
    });
  });
});
