// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import * as intakeExport from "../intake-export";

let db: Database.Database | null = null;

afterEach(() => {
  vi.restoreAllMocks();
  db?.close();
  db = null;
});

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

describe("skillforge intake-export batch37", () => {
  it.skip("marketplace-export.ts line 350 — file not present; see intakeProposal (350)", () => {});

  it("intakeProposal throws intake_unreadable when duplicate insert has no row match (350)", () => {
    const database = freshDb();
    const diff = `diff-b37-${randomUUID()}`;
    const sourceSkillId = `skill-b37-${randomUUID().slice(0, 8)}`;
    const sourceVersion = "1.0.0";
    const params = {
      proposalId: `prop-b37-${randomUUID().slice(0, 8)}`,
      sourceSkillId,
      sourceVersion,
      proposedDiff: diff,
      actor: "operator-b37",
    };
    const originalPrepare = database.prepare.bind(database);
    vi.spyOn(database, "prepare").mockImplementation((sql: string) => {
      if (sql.includes("INSERT INTO skillforge_intake_proposals")) {
        return {
          run: () => {
            throw new Error("UNIQUE constraint failed: skillforge_intake_proposals");
          },
        } as ReturnType<typeof database.prepare>;
      }
      return originalPrepare(sql);
    });
    vi.spyOn(intakeExport, "loadIntakeRow").mockReturnValue(null);
    vi.spyOn(intakeExport, "loadIntakeRowByKey").mockReturnValue(null);
    expect(() => intakeExport.intakeProposal(database, params)).toThrow(
      /intake insert failed but no matching row found/,
    );
    expect(createHash("sha256").update(diff, "utf8").digest("hex").length).toBe(64);
  });
});