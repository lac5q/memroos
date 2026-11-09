import { z } from "zod";

const identifier = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/);
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const rankingModelIdentitySchema = z.object({ id: identifier, revision: identifier,
  contentHash: hash, runHash: hash }).strict();
export const trainedRankingArtifactSchema = rankingModelIdentitySchema.extend({
  trainingUse: z.literal("approved-derived"), eligibilityHash: hash,
}).strict();
export type TrainedRankingArtifact = z.infer<typeof trainedRankingArtifactSchema>;
export const trainedRankingObservationSchema = rankingModelIdentitySchema.extend({
  version: z.literal("trained-ranking-observation-v1"), eligibilityHash: hash,
  eligibility: z.literal("shadow-only"), provenance: z.literal("operator-attested"),
}).strict();
export type TrainedRankingObservation = z.infer<typeof trainedRankingObservationSchema>;

export function artifactIdentity(artifact: TrainedRankingArtifact) {
  return { id: artifact.id, revision: artifact.revision, contentHash: artifact.contentHash, runHash: artifact.runHash };
}
