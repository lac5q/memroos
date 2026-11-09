// @vitest-environment node
import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { promptSaveArtifact } from "@/lib/artifact-gate";
import { createSpace, addSpaceMember } from "@/lib/space";
import { loadWorkspace } from "@/lib/workspace";
import { createSubjectErasurePlan, listSubjectErasurePlans } from "@/lib/memory/subject-erasure";
import { readSkillReviewState, skillReviewStatePath } from "@/lib/skill-workflow";

describe("misc lib batch28d — artifact-gate, subject-erasure, skill-workflow", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
    const statePath = skillReviewStatePath();
    if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
  });

  it("promptSaveArtifact builds a human-readable save prompt for a space", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const space = createSpace(db, { tenantId: "default-tenant", name: "Batch28d Space" });
    addSpaceMember(db, { spaceId: space.id, memberId: "actor-b28d", memberType: "human" });
    loadWorkspace(db, { spaceId: space.id, actorId: "actor-b28d" });
    const prompt = promptSaveArtifact(db, {
      spaceId: space.id,
      artifactName: "report-b28d",
      artifactType: "report",
    });
    expect(prompt.prompt).toBe("Save to Batch28d Space?");
    db.close();
  });

  it("createSubjectErasurePlan denies incomplete scope", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const result = createSubjectErasurePlan(db, {
      actorId: "operator-b28d",
      subject: {},
      scope: { tenantId: "default-tenant" },
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/missing_purpose|subject|scope/i);
    expect(listSubjectErasurePlans(db, { limit: 5 })).toHaveLength(0);
    db.close();
  });

  it("readSkillReviewState returns empty object when state file is missing", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `skill-state-b28d-${randomUUID()}-`));
    tmpDirs.push(dir);
    process.env.SKILL_REVIEW_STATE_PATH = path.join(dir, "missing-state.json");
    const state = await readSkillReviewState();
    expect(state).toEqual({});
    delete process.env.SKILL_REVIEW_STATE_PATH;
  });

  it("readSkillReviewState drops records with invalid stage or status", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `skill-state-b28d-${randomUUID()}-`));
    tmpDirs.push(dir);
    const statePath = path.join(dir, "state.json");
    process.env.SKILL_REVIEW_STATE_PATH = statePath;
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        "valid-skill-b28d": {
          stage: "general",
          status: "approved",
          notes: "",
          draftBody: "",
          changeReason: "",
          updatedAt: "2026-07-17T00:00:00.000Z",
          updatedBy: "operator-b28d",
        },
        "invalid-skill-b28d": {
          stage: "not-a-stage",
          status: "approved",
          notes: "",
          draftBody: "",
          changeReason: "",
          updatedAt: "2026-07-17T00:00:00.000Z",
          updatedBy: "operator-b28d",
        },
      }),
      "utf8",
    );
    const state = await readSkillReviewState();
    expect(Object.keys(state)).toEqual(["valid-skill-b28d"]);
    delete process.env.SKILL_REVIEW_STATE_PATH;
  });
});
