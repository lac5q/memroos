/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({
  useMemoryProposals: vi.fn(),
  useMemoryProposalActionMutation: vi.fn(),
  useRunPolicyLabMutation: vi.fn(),
  useContextSourceHealth: vi.fn(),
  useLibraryFreshness: vi.fn(),
  useTriggerQmdUpdate: vi.fn(),
  useUpdateSkillReviewMutation: vi.fn(),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    useMemoryProposals: api.useMemoryProposals,
    useMemoryProposalActionMutation: api.useMemoryProposalActionMutation,
    useRunPolicyLabMutation: api.useRunPolicyLabMutation,
    useContextSourceHealth: api.useContextSourceHealth,
    useLibraryFreshness: api.useLibraryFreshness,
    useTriggerQmdUpdate: api.useTriggerQmdUpdate,
    useUpdateSkillReviewMutation: api.useUpdateSkillReviewMutation,
  };
});

import { AgentRegistrationForm } from "@/components/agents/agent-registration-form";
import { MemoryProposalsPanel } from "@/components/memory/memory-proposals-panel";
import { PolicyLabPanel } from "@/components/memory/policy-lab-panel";
import { ContextSourcesPanel } from "@/components/library/context-sources-panel";
import { SkillsList } from "@/components/cookbooks/skills-list";
import type { SkillWorkflowItem } from "@/lib/api-client";

const proposal = {
  id: "prop-1",
  agentId: "ops-agent",
  proposalType: "memory_rewrite",
  status: "pending" as const,
  rationale: "Tune recall",
  baselineW: 0.5,
  forecastWDelta: 0.02,
  createdAt: "2026-05-01T00:00:00.000Z",
  diff: { field: "salience" },
  baselineLayers: { l1: { score: 0.5 }, l2: { score: 0.4 }, l3: { score: 0.3 } },
};

describe("Long-tail components batch13b", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ role: "operator" }) })));
  });

  describe("AgentRegistrationForm", () => {
    it("submits manual REST registration with normalized id", () => {
      const onSubmit = vi.fn();
      render(<AgentRegistrationForm onSubmit={onSubmit} />);
      fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
      fireEvent.change(screen.getByLabelText("Agent name"), { target: { value: "Ops Bot" } });
      fireEvent.change(screen.getByLabelText("Agent role"), { target: { value: "Operator" } });
      fireEvent.change(screen.getByLabelText("Agent capabilities"), { target: { value: "Search, Dispatch" } });
      fireEvent.click(screen.getByRole("button", { name: "Register" }));
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "ops-bot",
          name: "Ops Bot",
          role: "Operator",
          capabilities: expect.arrayContaining([
            expect.objectContaining({ id: "search" }),
            expect.objectContaining({ id: "dispatch" }),
          ]),
        }),
      );
    });

    it("registers via A2A card URL in advanced mode", () => {
      const onA2aSubmit = vi.fn();
      render(<AgentRegistrationForm onA2aSubmit={onA2aSubmit} />);
      fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
      fireEvent.click(screen.getByRole("button", { name: "A2A card URL" }));
      fireEvent.change(screen.getByLabelText("A2A agent-card URL"), {
        target: { value: "http://localhost:8001/.well-known/agent-card.json" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Register A2A Agent" }));
      expect(onA2aSubmit).toHaveBeenCalledWith({
        cardUrl: "http://localhost:8001/.well-known/agent-card.json",
        source: "adk",
      });
    });

    it("fires onboarding invite creation from Copy Invite", () => {
      const onCreateInvite = vi.fn();
      render(<AgentRegistrationForm onCreateInvite={onCreateInvite} />);
      fireEvent.click(screen.getByRole("button", { name: "Copy Invite" }));
      expect(onCreateInvite).toHaveBeenCalledWith(
        expect.objectContaining({ platform: "cursor", protocol: "rest", ttlMinutes: 60 }),
      );
    });
  });

  describe("MemoryProposalsPanel", () => {
    it("loads proposals and approves pending rows", async () => {
      const mutate = vi.fn();
      api.useMemoryProposals.mockReturnValue({
        data: { proposals: [proposal], types: { memory_rewrite: { label: "Rewrite" } } },
        isLoading: false,
      });
      api.useMemoryProposalActionMutation.mockReturnValue({
        mutate,
        isPending: false,
        isError: false,
      });
      render(<MemoryProposalsPanel />);
      expect(screen.getByText("1 pending")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Approve" }));
      expect(mutate).toHaveBeenCalledWith({ id: "prop-1", action: "approve" });
      fireEvent.click(screen.getByRole("button", { name: "▼" }));
      expect(screen.getByText(/salience/i)).toBeInTheDocument();
    });

    it("shows spinner while loading and empty copy when none exist", () => {
      api.useMemoryProposals.mockReturnValue({ data: undefined, isLoading: true });
      api.useMemoryProposalActionMutation.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false });
      const { rerender } = render(<MemoryProposalsPanel />);
      expect(document.querySelector(".animate-spin")).toBeTruthy();
      api.useMemoryProposals.mockReturnValue({ data: { proposals: [], types: {} }, isLoading: false });
      rerender(<MemoryProposalsPanel />);
      expect(screen.getByText("No memory proposals yet.")).toBeInTheDocument();
    });
  });

  describe("PolicyLabPanel", () => {
    it("validates variant JSON before running", () => {
      const mutate = vi.fn();
      api.useRunPolicyLabMutation.mockReturnValue({ mutate, isPending: false, isError: false, data: undefined });
      render(<PolicyLabPanel />);
      const variantEditor = screen.getAllByRole("textbox")[1];
      fireEvent.change(variantEditor, { target: { value: "not-json" } });
      fireEvent.click(screen.getByRole("button", { name: "Run ranking" }));
      expect(screen.getByText("Invalid JSON in variants field")).toBeInTheDocument();
      expect(mutate).not.toHaveBeenCalled();
    });

    it("renders ranked results and expands variant config", () => {
      api.useRunPolicyLabMutation.mockReturnValue({
        mutate: vi.fn(),
        isPending: false,
        isError: false,
        data: {
          goldenSetId: "./golden-sets/business-ops-50.jsonl",
          ranked: [
            {
              rank: 1,
              name: "k=5 multi-tier",
              compositeW: 0.82,
              layerScores: { l1: 0.8, l2: 0.7, l3: 0.6 },
              variantConfig: { k: 5 },
              evalRunId: "run-1",
            },
          ],
        },
      });
      render(<PolicyLabPanel />);
      expect(screen.getByText(/W Rankings \(1 variants\)/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "▼" }));
      expect(screen.getAllByText(/"k": 5/).length).toBeGreaterThan(0);
    });
  });

  describe("ContextSourcesPanel", () => {
    beforeEach(() => {
      api.useTriggerQmdUpdate.mockReturnValue({
        events: [],
        isStreaming: false,
        trigger: vi.fn(),
      });
      api.useLibraryFreshness.mockReturnValue({
        data: { collections: [] },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it("hides refresh index for non-operator roles", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({ ok: true, json: async () => ({ role: "reviewer" }) })),
      );
      api.useContextSourceHealth.mockReturnValue({
        data: { sources: [{ id: "gmail", status: "ok", ageMinutes: 1, documentCount: 2, repairHint: "none" }] },
        isLoading: false,
        error: null,
      });
      render(<ContextSourcesPanel />);
      await waitFor(() => expect(screen.queryByRole("button", { name: "Refresh Index" })).not.toBeInTheDocument());
    });

    it("renders failed qmd stream events for operators", async () => {
      api.useContextSourceHealth.mockReturnValue({ data: { sources: [] }, isLoading: false, error: null });
      api.useTriggerQmdUpdate.mockReturnValue({
        events: [{ type: "failed", error: "qmd crashed" }],
        isStreaming: false,
        trigger: vi.fn(),
      });
      render(<ContextSourcesPanel />);
      await waitFor(() => expect(screen.getByText(/Failed: qmd crashed/i)).toBeInTheDocument());
    });
  });

  describe("SkillsList", () => {
    const skillDetails: SkillWorkflowItem[] = [
      {
        name: "enterprise-review",
        title: "Enterprise Review",
        path: "/tmp/enterprise-review/SKILL.md",
        description: "Approve governed skills.",
        bodyPreview: "Body",
        stage: "enterprise",
        reviewStatus: "enterprise-ready",
        reviewNotes: "",
        draftBody: "",
        changeReason: "",
        owner: "admin",
        tags: [],
        health: "ready",
        lastActivityAt: null,
        maturityScore: 92,
        updatedAt: null,
        approvedAt: null,
      },
    ];

    it("promotes an enterprise-ready skill from the review desk", async () => {
      const mutateAsync = vi.fn().mockResolvedValue({ ok: true });
      api.useUpdateSkillReviewMutation.mockReturnValue({
        mutateAsync,
        isPending: false,
        isError: false,
      } as never);
      render(
        <SkillsList
          totalSkills={1}
          allSkills={["enterprise-review"]}
          skillDetails={skillDetails}
          coverageGaps={[]}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /Promote enterprise/i }));
      await waitFor(() => {
        expect(mutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({ skillName: "enterprise-review", action: "promote-enterprise" }),
        );
      });
    });
  });

});
