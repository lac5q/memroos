// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const TMP = mkdtempSync(path.join(tmpdir(), "skill-workflow-"));
const skillsRoot = path.join(TMP, "skills");
const statePath = path.join(TMP, "skill-review-state.json");

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

function writeSkill(name: string, body: string) {
  const dir = path.join(skillsRoot, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "SKILL.md"), body, "utf8");
}

describe("skill-workflow review state", () => {
  beforeEach(() => {
    process.env.SKILL_REVIEW_STATE_PATH = statePath;
    rmSync(statePath, { force: true });
    rmSync(skillsRoot, { recursive: true, force: true });
    mkdirSync(skillsRoot, { recursive: true });
  });

  it("updateSkillReviewState persists approve-general transitions", async () => {
    writeSkill(
      "demo-skill",
      `---
name: demo-skill
description: Demo workflow skill for operators
owner: ops
stage: agent-limited
tags: workflow, testing
---
# Demo Skill
Use when validating workflow state.
`
    );
    const {
      updateSkillReviewState,
      readSkillReviewState,
      buildSkillWorkflowItems,
    } = await import("../skill-workflow");

    const saved = await updateSkillReviewState({
      skillName: "demo-skill",
      action: "approve-general",
      notes: "looks good",
      actor: "alice",
    });
    expect(saved.status).toBe("approved");
    expect(saved.stage).toBe("general");
    expect(saved.approvedAt).toBeTruthy();

    const state = await readSkillReviewState();
    expect(state["demo-skill"]?.status).toBe("approved");
    expect(readFileSync(statePath, "utf8")).toContain("demo-skill");

    const items = await buildSkillWorkflowItems({
      skillsPath: skillsRoot,
      skillNames: ["demo-skill"],
      coverageGaps: [],
      skillUsage: { "demo-skill": { count: 3 } },
      reviewState: state,
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.reviewStatus).toBe("approved");
    expect(items[0]?.usageCount).toBe(3);
    expect(items[0]?.health).toBe("ready");
  });

  it("request-changes clears approval and promote-enterprise requires prior approval", async () => {
    const {
      updateSkillReviewState,
      readSkillReviewState,
    } = await import("../skill-workflow");

    await updateSkillReviewState({
      skillName: "gate-skill",
      action: "approve-general",
      actor: "alice",
    });
    const changes = await updateSkillReviewState({
      skillName: "gate-skill",
      action: "request-changes",
      notes: "needs work",
      actor: "bob",
    });
    expect(changes.status).toBe("changes-requested");
    expect(changes.approvedAt).toBeNull();

    let promoteErr: Error | undefined;
    try {
      await updateSkillReviewState({
        skillName: "gate-skill",
        action: "promote-enterprise",
        actor: "alice",
      });
    } catch (e) {
      promoteErr = e as Error;
    }
    expect(promoteErr?.message).toContain("approved at general stage");

    await updateSkillReviewState({
      skillName: "gate-skill",
      action: "approve-general",
      actor: "alice",
    });
    const promoted = await updateSkillReviewState({
      skillName: "gate-skill",
      action: "promote-enterprise",
      actor: "alice",
    });
    expect(promoted.stage).toBe("enterprise");
    expect(promoted.status).toBe("enterprise-ready");
    expect((await readSkillReviewState())["gate-skill"]?.stage).toBe("enterprise");
  });

  it("rejects invalid skill names", async () => {
    const { updateSkillReviewState } = await import("../skill-workflow");
    let invalidErr: Error | undefined;
    try {
      await updateSkillReviewState({
        skillName: "bad/skill",
        action: "save-draft",
        actor: "alice",
      });
    } catch (e) {
      invalidErr = e as Error;
    }
    expect(invalidErr?.message).toBe("Invalid skill name");
  });

  it("save-draft preserves the previous status when no explicit transition applies", async () => {
    const { updateSkillReviewState } = await import("../skill-workflow");
    await updateSkillReviewState({
      skillName: "draft-skill",
      action: "approve-general",
      actor: "alice",
    });
    const saved = await updateSkillReviewState({
      skillName: "draft-skill",
      action: "save-draft",
      notes: "wip",
      actor: "alice",
    });
    expect(saved.status).toBe("approved");
    expect(saved.notes).toBe("wip");
  });

  it("buildSkillWorkflowItems leaves agent-limited skills unreviewed when source exists", async () => {
    writeSkill(
      "limited-skill",
      `---
name: limited-skill
description: Internal helper with no promotion keywords
---
# Limited
Body present.
`
    );
    const { buildSkillWorkflowItems } = await import("../skill-workflow");
    const items = await buildSkillWorkflowItems({
      skillsPath: skillsRoot,
      skillNames: ["limited-skill"],
      coverageGaps: [],
      skillUsage: {},
      reviewState: {},
    });
    expect(items[0]?.stage).toBe("agent-limited");
    expect(items[0]?.reviewStatus).toBe("unreviewed");
  });

  it("buildSkillWorkflowItems infers enterprise and general stages from skill metadata", async () => {
    writeSkill(
      "enterprise-skill",
      `---
name: enterprise-skill
description: Governance and compliance controls for regulated tenants
---
# Enterprise
`
    );
    writeSkill(
      "general-skill",
      `---
name: general-skill
description: Use when coordinating operator workflows
---
# General
`
    );
    const { buildSkillWorkflowItems } = await import("../skill-workflow");
    const items = await buildSkillWorkflowItems({
      skillsPath: skillsRoot,
      skillNames: ["enterprise-skill", "general-skill"],
      coverageGaps: [],
      skillUsage: {},
      reviewState: {},
    });
    const enterprise = items.find((i) => i.name === "enterprise-skill");
    const general = items.find((i) => i.name === "general-skill");
    expect(enterprise?.stage).toBe("enterprise");
    expect(enterprise?.reviewStatus).toBe("enterprise-ready");
    expect(general?.stage).toBe("general");
    expect(general?.reviewStatus).toBe("approved");
  });

  it("buildSkillWorkflowItems marks coverage gaps and missing sources", async () => {
    writeSkill(
      "gap-skill",
      `---
name: gap-skill
description: Short
---
# Gap
`
    );
    const { buildSkillWorkflowItems } = await import("../skill-workflow");
    const withGap = await buildSkillWorkflowItems({
      skillsPath: skillsRoot,
      skillNames: ["gap-skill", "missing-skill"],
      coverageGaps: ["gap-skill"],
      skillUsage: {},
      reviewState: {},
    });
    const gap = withGap.find((i) => i.name === "gap-skill");
    const missing = withGap.find((i) => i.name === "missing-skill");
    expect(gap?.health).toBe("coverage-gap");
    expect(missing?.health).toBe("needs-source");
  });
});
