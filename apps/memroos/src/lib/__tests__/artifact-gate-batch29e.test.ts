// @vitest-environment node
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { createSpace } from "@/lib/space";
import { saveArtifact, setAutoReadmeUpdate } from "@/lib/artifact-gate";
import { loadWorkspace } from "@/lib/workspace";
import { addSpaceMember } from "@/lib/space";

describe("artifact-gate batch29e — validation branches", () => {
  let db: Database.Database;
  let spaceId: string;
  const actorId = `actor-b29e-${randomUUID().slice(0, 8)}`;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    const space = createSpace(db, { tenantId: "default-tenant", name: "batch29e-space" });
    spaceId = space.id;
    addSpaceMember(db, { spaceId, memberId: actorId, memberType: "human" });
    loadWorkspace(db, { spaceId, actorId });
  });

  it("setAutoReadmeUpdate requires spaceId and actorId (lines 165–166)", () => {
    expect(() =>
      setAutoReadmeUpdate(db, { spaceId: "   ", enabled: true, actorId }),
    ).toThrow(/spaceId is required/);
    expect(() =>
      setAutoReadmeUpdate(db, { spaceId, enabled: true, actorId: "  " }),
    ).toThrow(/actorId is required/);
  });

  it("saveArtifact requires artifact fields (lines 252–257)", () => {
    expect(() =>
      saveArtifact(db, {
        spaceId,
        artifactName: "  ",
        artifactType: "report",
        resourceId: "res-1",
        beliefStage: "gold_claim",
        actorId,
      }),
    ).toThrow(/artifactName is required/);
    expect(() =>
      saveArtifact(db, {
        spaceId,
        artifactName: "doc",
        artifactType: "",
        resourceId: "res-1",
        beliefStage: "gold_claim",
        actorId,
      }),
    ).toThrow(/artifactType is required/);
    expect(() =>
      saveArtifact(db, {
        spaceId,
        artifactName: "doc",
        artifactType: "report",
        resourceId: "",
        beliefStage: "gold_claim",
        actorId,
      }),
    ).toThrow(/resourceId is required/);
    expect(() =>
      saveArtifact(db, {
        spaceId,
        artifactName: "doc",
        artifactType: "report",
        resourceId: "res-1",
        beliefStage: "",
        actorId,
      }),
    ).toThrow(/beliefStage is required/);
    expect(() =>
      saveArtifact(db, {
        spaceId,
        artifactName: "doc",
        artifactType: "report",
        resourceId: "res-1",
        beliefStage: "gold_claim",
        actorId: "",
      }),
    ).toThrow(/actorId is required/);
  });
});
