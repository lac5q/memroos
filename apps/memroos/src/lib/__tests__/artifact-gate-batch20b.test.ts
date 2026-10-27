// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";

import {
  getLastArtifactPointer,
  isAutoReadmeUpdateEnabled,
  promptSaveArtifact,
  saveArtifact,
  setAutoReadmeUpdate,
} from "@/lib/artifact-gate";
import { initSchema } from "@/lib/db-schema";
import { createSpace, addSpaceMember } from "@/lib/space";
import { loadWorkspace } from "@/lib/workspace";

function setupWorkspace() {
  const db = new Database(":memory:");
  initSchema(db);
  const space = createSpace(db, { tenantId: "default-tenant", name: "batch20b-space" });
  const actorId = "actor-batch20b";
  addSpaceMember(db, { spaceId: space.id, memberId: actorId, memberType: "human" });
  loadWorkspace(db, { spaceId: space.id, actorId });
  return { db, spaceId: space.id, actorId };
}

describe("artifact-gate batch20b — pointer and validation edges", () => {
  let db: Database.Database;
  let spaceId: string;
  let actorId: string;

  beforeEach(() => {
    ({ db, spaceId, actorId } = setupWorkspace());
  });

  it("isAutoReadmeUpdateEnabled treats blank spaceId as default-enabled", () => {
    expect(isAutoReadmeUpdateEnabled(db, "")).toBe(true);
    expect(isAutoReadmeUpdateEnabled(db, "   ")).toBe(true);
  });

  it("getLastArtifactPointer returns null for blank spaceId", () => {
    expect(getLastArtifactPointer(db, "")).toBeNull();
  });

  it("getLastArtifactPointer returns null when settings row has only null pointer columns", () => {
    setAutoReadmeUpdate(db, { spaceId, enabled: false, actorId });
    expect(getLastArtifactPointer(db, spaceId)).toBeNull();
  });

  it("saveArtifact validates required fields before workspace gates", () => {
    expect(() =>
      saveArtifact(db, {
        spaceId,
        artifactName: "",
        artifactType: "report",
        resourceId: "res-x",
        beliefStage: "silver_candidate_claim",
        actorId,
      }),
    ).toThrow(/artifactName/);
    expect(() =>
      saveArtifact(db, {
        spaceId,
        artifactName: "a",
        artifactType: "report",
        resourceId: "",
        beliefStage: "silver_candidate_claim",
        actorId,
      }),
    ).toThrow(/resourceId/);
  });

  it("promptSaveArtifact trims whitespace on inputs", () => {
    const result = promptSaveArtifact(db, {
      spaceId: `  ${spaceId}  `,
      artifactName: "  trimmed-name  ",
      artifactType: "  doc  ",
    });
    expect(result.artifactName).toBe("trimmed-name");
    expect(result.artifactType).toBe("doc");
  });

  it("saveArtifact with purpose updates document directory purpose field", () => {
    const { documentDirectoryEntry } = saveArtifact(db, {
      spaceId,
      artifactName: "purpose-artifact",
      artifactType: "note",
      resourceId: "res-purpose",
      beliefStage: "bronze_raw_source",
      actorId,
      purpose: "batch20b coverage",
    });
    expect(documentDirectoryEntry.purpose).toBe("batch20b coverage");
  });
});
