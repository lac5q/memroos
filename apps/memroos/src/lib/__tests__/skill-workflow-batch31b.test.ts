// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const TMP = mkdtempSync(path.join(tmpdir(), `skill-workflow-b31b-${randomUUID()}-`));
const skillsRoot = path.join(TMP, "skills");
const statePath = path.join(TMP, "skill-review-state.json");

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("skill-workflow batch31b — review state and stage inference", () => {
  beforeEach(() => {
    process.env.SKILL_REVIEW_STATE_PATH = statePath;
    rmSync(statePath, { force: true });
    rmSync(skillsRoot, { recursive: true, force: true });
    mkdirSync(skillsRoot, { recursive: true });
  });

  it("readSkillReviewState ignores array root documents (line 85)", async () => {
    writeFileSync(statePath, JSON.stringify([{ stage: "general", status: "approved" }]), "utf8");
    const { readSkillReviewState } = await import("../skill-workflow");
    expect(await readSkillReviewState()).toEqual({});
  });

  it("metadataStage maps governance-heavy skills to enterprise (line 277)", async () => {
    const skillDir = path.join(skillsRoot, "enterprise-b31b");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---
name: enterprise-b31b
description: Governance and compliance workflow for regulated tenants
---
# Enterprise workflow
`,
      "utf8",
    );
    const { buildSkillWorkflowItems } = await import("../skill-workflow");
    const items = await buildSkillWorkflowItems({
      skillsPath: skillsRoot,
      skillNames: ["enterprise-b31b"],
      coverageGaps: [],
      skillUsage: {},
      reviewState: {},
    });
    expect(items[0]?.stage).toBe("enterprise");
  });
});
