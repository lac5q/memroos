import { z } from "zod";
import { hashEngineRequest } from "./hash.js";
import { contentTokens, countEvidenceTokenMatches } from "./retrieval-query.js";
import { rankingModelIdentitySchema } from "./trained-ranking-contract.js";

export const EVIDENCE_RANKING_VERSION = "evidence-ranking-v1" as const;
export const LOCAL_CROSS_ENCODER_VERSION = "local-cross-encoder-v1" as const;
export const BASELINE_RANKING_PROVIDER = Object.freeze({
  id: "memroos-local-ranker", revision: LOCAL_CROSS_ENCODER_VERSION,
});

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const providerSchema = z.object({ id: z.string().min(1), revision: z.string().min(1) }).strict();
const inputCandidateSchema = z.object({
  id: z.string().min(1), text: z.string(), sourceHash: z.string().nullable(), sourceRevision: z.string().nullable(),
  fusedScore: z.number().finite().nonnegative(), intentPriority: z.number().finite().nonnegative(),
}).strict();
const candidateSchema = inputCandidateSchema.extend({ evidenceRevision: digestSchema });
const profileBindingSchema = z.object({ id: z.string().min(1), revision: z.string().min(1),
  configurationHash: digestSchema }).strict();
const requestBodySchema = z.object({
  version: z.literal(EVIDENCE_RANKING_VERSION), capability: z.literal("rank-evidence"),
  operationKey: digestSchema, scopeHash: digestSchema,
  query: z.string(), intentQuery: z.string(), candidates: z.array(candidateSchema),
  profile: profileBindingSchema.optional(),
}).strict();
const requestSchema = requestBodySchema.extend({ requestHash: digestSchema });
const resultSchema = z.object({
  version: z.literal(EVIDENCE_RANKING_VERSION), capability: z.literal("rank-evidence"),
  operationKey: digestSchema, scopeHash: digestSchema, requestHash: digestSchema,
  provider: providerSchema, status: z.enum(["ranked", "abstained"]),
  artifact: rankingModelIdentitySchema.optional(),
  reasonCode: z.enum(["ranking_complete", "no_candidates", "engine_abstained"]),
  scoreMeaning: z.literal("relative-relevance-not-probability"),
  selection: z.literal("runtime-owned"), sufficiency: z.literal("not-assessed"),
  ranked: z.array(z.object({ id: z.string().min(1), evidenceRevision: digestSchema,
    score: z.number().finite().min(0).max(1) }).strict()),
}).strict();

export type EvidenceRankingCandidateInput = z.infer<typeof inputCandidateSchema>;
export type EvidenceRankingProvider = Readonly<z.infer<typeof providerSchema>>;
export type EvidenceRankingProfileBinding = Readonly<z.infer<typeof profileBindingSchema>>;
export type EvidenceRankingRequest = Readonly<Omit<z.infer<typeof requestSchema>, "candidates" | "profile">> & {
  readonly candidates: readonly Readonly<z.infer<typeof candidateSchema>>[];
  readonly profile?: EvidenceRankingProfileBinding;
};
export type EvidenceRankingResult = z.infer<typeof resultSchema>;

/** Constant reason codes only: validation must not echo query or provider payloads. */
export class EvidenceRankingError extends Error {
  constructor(readonly code: "ranking_request_invalid" | "ranking_result_invalid"
    | "ranking_binding_mismatch" | "ranking_provider_mismatch" | "ranking_evidence_mismatch") {
    super(code);
    this.name = "EvidenceRankingError";
  }
}

/** Runtime supplies authorized evidence. Hashes bind inputs; they grant no authority. */
export function createEvidenceRankingRequest(input: {
  operationId: string; scopeHash: string; query: string; intentQuery: string;
  candidates: EvidenceRankingCandidateInput[];
  profile?: EvidenceRankingProfileBinding;
}): EvidenceRankingRequest {
  const parsed = z.object({ operationId: z.string().min(1), scopeHash: digestSchema,
    query: z.string(), intentQuery: z.string(), candidates: z.array(inputCandidateSchema),
    profile: profileBindingSchema.optional() }).strict().safeParse(input);
  if (!parsed.success || new Set(parsed.data.candidates.map((item) => item.id)).size !== parsed.data.candidates.length) {
    throw new EvidenceRankingError("ranking_request_invalid");
  }
  const value = parsed.data;
  const body = {
    version: EVIDENCE_RANKING_VERSION, capability: "rank-evidence" as const,
    operationKey: hashEngineRequest([value.scopeHash, value.operationId]), scopeHash: value.scopeHash,
    query: value.query, intentQuery: value.intentQuery,
    ...(value.profile ? { profile: Object.freeze(value.profile) } : {}),
    candidates: value.candidates.map((candidate) => Object.freeze({ ...candidate,
      evidenceRevision: hashEngineRequest([candidate.text, candidate.sourceHash, candidate.sourceRevision]) })),
  };
  return Object.freeze({ ...body, candidates: Object.freeze(body.candidates), requestHash: hashEngineRequest(body) });
}

function checkedRequest(request: unknown): z.infer<typeof requestSchema> {
  const parsed = requestSchema.safeParse(request);
  if (!parsed.success) throw new EvidenceRankingError("ranking_request_invalid");
  const { requestHash, ...body } = parsed.data;
  if (requestHash !== hashEngineRequest(body)
    || new Set(body.candidates.map((candidate) => candidate.id)).size !== body.candidates.length
    || body.candidates.some((candidate) => candidate.evidenceRevision !== hashEngineRequest(
      [candidate.text, candidate.sourceHash, candidate.sourceRevision]))) {
    throw new EvidenceRankingError("ranking_request_invalid");
  }
  return parsed.data;
}

/** Validate a proposal against the runtime's original request and pinned provider. */
export function validateEvidenceRankingResult(
  request: EvidenceRankingRequest, result: unknown, expectedProvider: EvidenceRankingProvider,
  expectedArtifact?: z.infer<typeof rankingModelIdentitySchema>,
): EvidenceRankingResult {
  const bound = checkedRequest(request);
  const parsed = resultSchema.safeParse(result);
  if (!parsed.success) throw new EvidenceRankingError("ranking_result_invalid");
  const value = parsed.data;
  if (hashEngineRequest(value.artifact ?? null) !== hashEngineRequest(expectedArtifact ?? null)) {
    throw new EvidenceRankingError("ranking_provider_mismatch");
  }
  if (value.operationKey !== bound.operationKey || value.scopeHash !== bound.scopeHash || value.requestHash !== bound.requestHash) {
    throw new EvidenceRankingError("ranking_binding_mismatch");
  }
  if (value.provider.id !== expectedProvider.id || value.provider.revision !== expectedProvider.revision) {
    throw new EvidenceRankingError("ranking_provider_mismatch");
  }
  if (value.status === "abstained") {
    if (value.ranked.length !== 0 || value.reasonCode !== "engine_abstained") throw new EvidenceRankingError("ranking_result_invalid");
    return value;
  }
  const expected = new Map(bound.candidates.map((candidate) => [candidate.id, candidate.evidenceRevision]));
  if (value.ranked.length !== expected.size || new Set(value.ranked.map((item) => item.id)).size !== expected.size
    || value.ranked.some((item) => expected.get(item.id) !== item.evidenceRevision)) {
    throw new EvidenceRankingError("ranking_evidence_mismatch");
  }
  if (value.reasonCode !== (expected.size === 0 ? "no_candidates" : "ranking_complete")) {
    throw new EvidenceRankingError("ranking_result_invalid");
  }
  return value;
}

/** Existing deterministic pair scorer, preserved for the open local baseline. */
export function localCrossEncoderScore(query: string, text: string): number {
  const queryTokens = contentTokens(query).map((token) => token.toLocaleLowerCase());
  const candidateTokens = contentTokens(text).map((token) => token.toLocaleLowerCase());
  if (queryTokens.length === 0 || candidateTokens.length === 0) return 0;
  const overlap = countEvidenceTokenMatches(queryTokens, candidateTokens) / queryTokens.length;
  const lowered = text.toLocaleLowerCase();
  const phrase = queryTokens.some((token) => token.length >= 4 && lowered.includes(token))
    ? (lowered.includes(query.trim().toLocaleLowerCase()) ? 1 : 0.45)
    : (lowered.includes(query.trim().toLocaleLowerCase()) ? 1 : 0);
  const density = Math.min(1, overlap / Math.max(1, Math.sqrt(candidateTokens.length / 8)));
  return Number((overlap * 0.6 + phrase * 0.25 + density * 0.15).toFixed(6));
}

/** No credentials, model, network, storage or tool execution. Returns advice only. */
export function rankEvidenceBaseline(request: EvidenceRankingRequest): EvidenceRankingResult {
  const bound = checkedRequest(request);
  const ranked = bound.candidates.map((candidate) => ({ ...candidate,
    score: localCrossEncoderScore(bound.query, candidate.text) }))
    .sort((left, right) => right.intentPriority - left.intentPriority || right.score - left.score
      || right.fusedScore - left.fusedScore || left.id.localeCompare(right.id))
    .map(({ id, evidenceRevision, score }) => ({ id, evidenceRevision, score }));
  return {
    version: EVIDENCE_RANKING_VERSION, capability: "rank-evidence",
    operationKey: bound.operationKey, scopeHash: bound.scopeHash, requestHash: bound.requestHash,
    provider: { ...BASELINE_RANKING_PROVIDER }, status: "ranked",
    reasonCode: ranked.length ? "ranking_complete" : "no_candidates",
    scoreMeaning: "relative-relevance-not-probability", selection: "runtime-owned", sufficiency: "not-assessed", ranked,
  };
}
