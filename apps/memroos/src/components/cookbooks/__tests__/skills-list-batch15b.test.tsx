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

const generalSkill: SkillWorkflowItem = {
  name: "general-skill",
  title: "General Skill",
  path: "/tmp/general/SKILL.md",
  description: "Ready for broad use.",
  bodyPreview: "Current body text.",
  stage: "general",
  reviewStatus: "approved",
  reviewNotes: "ok",
  draftBody: "",
  changeReason: "Improve clarity",
  owner: "ops",
  tags: ["workflow", "ops"],
  health: "ready",
  lastActivityAt: "2026-05-17T10:00:00.000Z",
  maturityScore: 72,
  updatedAt: "2026-05-17T11:00:00.000Z",
  approvedAt: "2026-05-17T11:00:00.000Z",
  usageCount: 3,
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

describe("SkillsList batch15b", () => {
  it("shows diff badges, tags, usage metrics, and start-from-current control", () => {
    render(
      <SkillsList
        totalSkills={1}
        allSkills={["general-skill"]}
        skillDetails={[{ ...generalSkill, draftBody: "Edited body text." }]}
        coverageGaps={[]}
      />,
    );
    expect(screen.getByText("edit proposed")).toBeInTheDocument();
    expect(screen.getByText("3×")).toBeInTheDocument();
    expect(screen.getByText("workflow")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Skill edit draft"), {
      target: { value: "Edited body text." },
    });
    expect(screen.getByText("differs from current")).toBeInTheDocument();

  });

  it("seeds the review draft from current body preview", () => {
    render(
      <SkillsList totalSkills={1} allSkills={["general-skill"]} skillDetails={[generalSkill]} coverageGaps={[]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Start from current content" }));
    expect(screen.getByLabelText("Skill edit draft")).toHaveValue("Current body text.");
  });

  it("runs promote-enterprise and request-changes actions with notices", async () => {
    render(
      <SkillsList totalSkills={1} allSkills={["general-skill"]} skillDetails={[generalSkill]} coverageGaps={[]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Promote enterprise/i }));
    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ action: "promote-enterprise", skillName: "general-skill" }),
      );
      expect(screen.getByText("Skill promoted to enterprise review.")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Request changes/i }));
    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ action: "request-changes" }));
      expect(screen.getByText("Changes requested and saved.")).toBeInTheDocument();
    });
  });

  it("surfaces mutation failures from runReviewAction and isError state", async () => {
    mutateAsync.mockRejectedValueOnce(new Error("review write failed"));
    mockUseUpdateSkillReviewMutation.mockReturnValueOnce({
      mutateAsync,
      isPending: false,
      isError: true,
      error: new Error("persist failed"),
    } as unknown as ReturnType<typeof useUpdateSkillReviewMutation>);

    render(
      <SkillsList totalSkills={1} allSkills={["general-skill"]} skillDetails={[generalSkill]} coverageGaps={[]} />,
    );
    expect(screen.getByText("persist failed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Save draft/i }));
    await waitFor(() => {
      expect(screen.getByText(/Error: review write failed/i)).toBeInTheDocument();
    });
  });

  it("renders changes-requested status pill tone", () => {
    render(
      <SkillsList
        totalSkills={1}
        allSkills={["blocked-skill"]}
        skillDetails={[
          {
            ...generalSkill,
            name: "blocked-skill",
            title: "Blocked Skill",
            reviewStatus: "changes-requested",
            stage: "agent-limited",
            tags: [],
            usageCount: 0,
            lastActivityAt: null,
            draftBody: "",
          },
        ]}
        coverageGaps={[]}
      />,
    );
    expect(screen.getAllByText("Changes requested").length).toBeGreaterThan(0);
  });
});
