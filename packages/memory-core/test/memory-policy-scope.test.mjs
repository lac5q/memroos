import assert from "node:assert/strict";
import { test } from "node:test";

import {
  authorizeMemoryUse,
  extractMemoryLabelSnapshot,
} from "@memroos/memory-core/memory-policy";
import {
  assertEngineActorScope,
  hashBackendNamespace,
  hashMemoryEngineScope,
  hashProviderPointer,
  resolveAuthorizedEngineScope,
  sanitizeEngineMetadata,
  stableScope,
} from "@memroos/memory-core/memory-scope";

const VALID_SCOPE = {
  tenantId: "synthetic-tenant",
  projectId: "synthetic-project",
  userId: "synthetic-user",
  agentId: "synthetic-agent",
  spaceId: "synthetic-space",
  label: {
    visibility: "internal",
    policy: "indexable",
    domain: "engineering",
    sensitivity: "pii",
  },
  purpose: "recall",
  beliefStage: "gold_claim",
};

function decide(actor, label) {
  return authorizeMemoryUse({ actor, purpose: "recall", label });
}

test("memory policy defaults closed and enforces owner, space, and admin rules", () => {
  const missingLabel = decide({ id: "synthetic-user", role: "operator" }, {});
  assert.equal(missingLabel.decision, "deny");
  assert.equal(missingLabel.reason, "sealed_content");
  assert.deepEqual(missingLabel.label, {
    visibility: "private",
    domain: null,
    sensitivity: null,
    policy: "sealed",
  });

  const privateOwned = {
    visibility: "private",
    policy: "indexable",
    ownerUserId: "synthetic-owner",
  };
  assert.deepEqual(
    decide({ id: "synthetic-owner", role: "operator" }, privateOwned),
    {
      decision: "allow",
      reason: "owner_or_admin_private",
      label: {
        visibility: "private",
        domain: null,
        sensitivity: null,
        policy: "indexable",
      },
    },
  );
  assert.equal(
    decide({ id: "synthetic-other-user", role: "reviewer" }, privateOwned).reason,
    "private_content",
  );
  assert.equal(
    decide({ id: "synthetic-owner", role: "agent" }, privateOwned).reason,
    "private_content",
  );
  assert.equal(
    decide(
      { id: "synthetic-admin", role: "admin", spaceIds: [] },
      { ...privateOwned, ownerUserId: "synthetic-someone-else", spaceId: "synthetic-space" },
    ).reason,
    "owner_or_admin_private",
  );

  const spaceLabel = {
    visibility: "internal",
    policy: "indexable",
    spaceId: "synthetic-space",
  };
  assert.equal(
    decide({ id: "synthetic-user", role: "operator" }, spaceLabel).reason,
    "space_not_member",
  );
  assert.equal(
    decide({ id: "synthetic-user", role: "operator", spaceIds: [] }, spaceLabel).reason,
    "space_not_member",
  );
  assert.equal(
    decide({ id: "synthetic-user", role: "operator", spaceIds: ["synthetic-space"] }, spaceLabel).decision,
    "allow",
  );
});

test("sealed, review, and redaction policies take precedence over ownership and space", () => {
  const actor = { id: "synthetic-owner", role: "operator", spaceIds: [] };
  const common = { visibility: "private", ownerUserId: actor.id, spaceId: "synthetic-space" };

  assert.equal(decide(actor, { ...common, policy: "sealed" }).reason, "sealed_content");
  assert.equal(
    decide(actor, { ...common, policy: "requires_human_review" }).reason,
    "human_review_required",
  );
  assert.equal(
    decide(actor, { ...common, policy: "requires_redaction" }).reason,
    "redaction_required",
  );
  assert.equal(
    decide({ id: "synthetic-admin", role: "admin" }, { ...common, policy: "sealed" }).reason,
    "sealed_content",
  );
});

test("label extraction merges only recognized label fields and trims owner and space ids", () => {
  assert.deepEqual(
    extractMemoryLabelSnapshot({
      metadata: {
        visibility: "internal",
        policy: "indexable",
        label: { owner_user_id: " synthetic-owner ", space_id: " synthetic-space " },
      },
    }),
    {
      visibility: "internal",
      domain: undefined,
      sensitivity: undefined,
      policy: "indexable",
      ownerUserId: "synthetic-owner",
      spaceId: "synthetic-space",
    },
  );
  assert.equal(extractMemoryLabelSnapshot({ metadata: { content: "synthetic-only" } }), undefined);
});

test("engine scope retains its pre-extraction canonical hash vectors", () => {
  const expectedValid = "sha256:ff1cd017401aee65e826cb9e92790c1f945f8f1c9e5d7584dd8d820f9608e97a";
  const reorderedScope = {
    beliefStage: VALID_SCOPE.beliefStage,
    purpose: VALID_SCOPE.purpose,
    label: {
      sensitivity: VALID_SCOPE.label.sensitivity,
      domain: VALID_SCOPE.label.domain,
      policy: VALID_SCOPE.label.policy,
      visibility: VALID_SCOPE.label.visibility,
    },
    spaceId: VALID_SCOPE.spaceId,
    agentId: VALID_SCOPE.agentId,
    userId: VALID_SCOPE.userId,
    projectId: VALID_SCOPE.projectId,
    tenantId: VALID_SCOPE.tenantId,
  };
  assert.equal(hashMemoryEngineScope(VALID_SCOPE), expectedValid);
  assert.equal(hashMemoryEngineScope(reorderedScope), expectedValid);
  assert.equal(
    hashMemoryEngineScope({ ...VALID_SCOPE, label: {} }),
    "sha256:f925082f273231b978a0b8fb30f1bf2dede0f68214d5e44756c7d7696949afc8",
  );
  assert.equal(
    hashMemoryEngineScope({
      ...VALID_SCOPE,
      tenantId: "  Ｔｅｎａｎｔ　Ａ  ",
      projectId: "Cafe\u0301",
    }),
    "sha256:f10ff4b34219f8eb8c61981168a33f3a9bd5fd087b1a259f3c58d7b88ed79ce2",
  );

  assert.deepEqual(stableScope({ ...VALID_SCOPE, label: {} }).label, {
    visibility: "private",
    policy: "sealed",
    domain: null,
    sensitivity: null,
  });
  for (const dimension of ["tenantId", "projectId", "userId", "agentId", "spaceId"]) {
    assert.throws(
      () => hashMemoryEngineScope({ ...VALID_SCOPE, [dimension]: "   " }),
      { message: `incomplete_scope:${dimension}` },
    );
    assert.throws(
      () => hashMemoryEngineScope({ ...VALID_SCOPE, [dimension]: "x".repeat(257) }),
      { message: `invalid_scope:${dimension}` },
    );
  }
});

test("engine actor checks and authorized resolution refuse mismatched authority", async () => {
  assert.equal(
    assertEngineActorScope(
      { id: "synthetic-admin", role: "admin", tenantId: VALID_SCOPE.tenantId },
      VALID_SCOPE,
    ),
    undefined,
  );
  assert.throws(
    () => assertEngineActorScope({ id: "synthetic-admin", role: "admin", tenantId: "synthetic-other-tenant" }, VALID_SCOPE),
    { message: "scope_tenant_mismatch" },
  );
  assert.throws(
    () => assertEngineActorScope({ id: "synthetic-other-agent", role: "agent", tenantId: VALID_SCOPE.tenantId }, VALID_SCOPE),
    { message: "scope_actor_mismatch" },
  );

  const actor = { id: VALID_SCOPE.agentId, role: "agent", tenantId: VALID_SCOPE.tenantId };
  await assert.rejects(
    resolveAuthorizedEngineScope(async () => null, actor, VALID_SCOPE),
    { message: "scope_authorization_denied" },
  );
  await assert.rejects(
    resolveAuthorizedEngineScope(async () => VALID_SCOPE, {
      ...actor,
      tenantId: "synthetic-other-tenant",
    }, VALID_SCOPE),
    { message: "scope_tenant_mismatch" },
  );
});

test("backend namespace, metadata filtering, and provider pointer hashes stay stable", () => {
  assert.equal(
    hashBackendNamespace("synthetic-backend-namespace"),
    "sha256:c7844c533a5d29de49d1181d84f2abbc0851ceb1b6656a866ccefebff3565e72",
  );
  assert.deepEqual(
    sanitizeEngineMetadata({
      visibility: "internal",
      policy: "indexable",
      domain: "engineering",
      sensitivity: "pii",
      belief_stage: "gold_claim",
      source_hash: "sha256:synthetic-source",
      canonical_id_hash: "sha256:synthetic-canonical-id",
      source_ref_hash: "sha256:synthetic-source-ref",
      raw_vault_ref_hash: "sha256:synthetic-vault-ref",
      redacted: true,
      occurred_at: 1700000000,
      valid_from: "2026-01-01T00:00:00.000Z",
      valid_until: null,
      content: "synthetic private body",
      email: "synthetic@example.invalid",
      nested: { private: true },
    }),
    {
      visibility: "internal",
      policy: "indexable",
      domain: "engineering",
      sensitivity: "pii",
      belief_stage: "gold_claim",
      source_hash: "sha256:synthetic-source",
      canonical_id_hash: "sha256:synthetic-canonical-id",
      source_ref_hash: "sha256:synthetic-source-ref",
      raw_vault_ref_hash: "sha256:synthetic-vault-ref",
      redacted: true,
      occurred_at: 1700000000,
      valid_from: "2026-01-01T00:00:00.000Z",
      valid_until: null,
    },
  );
  assert.deepEqual(
    sanitizeEngineMetadata({ visibility: ["private"], source_hash: { value: "synthetic" } }),
    {},
  );
  assert.deepEqual(sanitizeEngineMetadata(["not", "a", "record"]), {});

  assert.equal(
    hashProviderPointer("synthetic-pointer-alpha"),
    "sha256:39d4695496996f2425a19396eca70a853c44adffc0d10a033adf6e31f75c4286",
  );
  assert.notEqual(
    hashProviderPointer("synthetic-pointer-alpha"),
    hashProviderPointer("synthetic-pointer-beta"),
  );
});
