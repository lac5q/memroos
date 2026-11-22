import crypto from "node:crypto";

import type { MemoryLabelSnapshot, MemoryUseActor, MemoryUsePurpose } from "./memory-policy.js";

export type BeliefStage =
  | "silver_candidate_claim"
  | "gold_claim"
  | "revoked"
  | "superseded";

/** Complete authorization identity used to bind memory engine operations. */
export interface MemoryEngineScope {
  tenantId: string;
  projectId: string;
  userId: string;
  agentId: string;
  spaceId: string;
  label: MemoryLabelSnapshot;
  purpose: MemoryUsePurpose;
  beliefStage: BeliefStage;
}

/**
 * Server-owned resolver. Implementations must load memberships, labels, and
 * belief state from authenticated storage; request objects are hints only.
 */
export type MemoryEngineScopeAuthority = (input: {
  actor: MemoryUseActor;
  requestedScope: MemoryEngineScope;
}) => Promise<MemoryEngineScope | null>;

function cleanDimension(name: string, value: string): string {
  const normalized = value.normalize("NFKC").trim();
  if (!normalized) throw new Error(`incomplete_scope:${name}`);
  if (normalized.length > 256) throw new Error(`invalid_scope:${name}`);
  return normalized;
}

export function stableScope(scope: MemoryEngineScope): Record<string, unknown> {
  return {
    tenantId: cleanDimension("tenantId", scope.tenantId),
    projectId: cleanDimension("projectId", scope.projectId),
    userId: cleanDimension("userId", scope.userId),
    agentId: cleanDimension("agentId", scope.agentId),
    spaceId: cleanDimension("spaceId", scope.spaceId),
    label: {
      visibility: scope.label.visibility ?? "private",
      policy: scope.label.policy ?? "sealed",
      domain: scope.label.domain ?? null,
      sensitivity: scope.label.sensitivity ?? null,
    },
    purpose: scope.purpose,
    beliefStage: scope.beliefStage,
  };
}

export function hashMemoryEngineScope(scope: MemoryEngineScope): string {
  const canonical = JSON.stringify(stableScope(scope));
  return `sha256:${crypto.createHash("sha256").update(canonical).digest("hex")}`;
}

export function assertEngineActorScope(actor: MemoryUseActor, scope: MemoryEngineScope): void {
  stableScope(scope);
  if (actor.tenantId && actor.tenantId !== scope.tenantId) throw new Error("scope_tenant_mismatch");
  if (actor.role === "admin") return;
  if (actor.role === "system" && actor.capability === "memory_engine") return;
  if (actor.role === "agent" && actor.id === scope.agentId) return;
  if (["operator", "reviewer"].includes(actor.role) && actor.id === scope.userId) return;
  throw new Error("scope_actor_mismatch");
}

export async function resolveAuthorizedEngineScope(
  authority: MemoryEngineScopeAuthority,
  actor: MemoryUseActor,
  requestedScope: MemoryEngineScope,
): Promise<MemoryEngineScope> {
  const resolved = await authority({ actor, requestedScope });
  if (!resolved) throw new Error("scope_authorization_denied");
  assertEngineActorScope(actor, resolved);
  stableScope(resolved);
  return resolved;
}

export function hashBackendNamespace(namespace: string): string {
  return `sha256:${crypto.createHash("sha256").update(namespace).digest("hex")}`;
}

export function sanitizeEngineMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  const record = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
  const allowed = new Set([
    "visibility",
    "policy",
    "domain",
    "sensitivity",
    "belief_stage",
    "source_hash",
    "canonical_id_hash",
    "source_ref_hash",
    "raw_vault_ref_hash",
    "redacted",
    "occurred_at",
    "valid_from",
    "valid_until",
  ]);
  for (const [key, value] of Object.entries(record)) {
    if (!allowed.has(key)) continue;
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) sanitized[key] = value;
  }
  return sanitized;
}

export function hashProviderPointer(value: string): string {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}
