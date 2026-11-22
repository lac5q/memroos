import { z } from "zod";

const identifier = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/);
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);

/** Which ranking model produced a ranking: its id and revision, and hashes of its content and of the run. */
export const rankingModelIdentitySchema = z.object({ id: identifier, revision: identifier,
  contentHash: hash, runHash: hash }).strict();
export type RankingModelIdentity = z.infer<typeof rankingModelIdentitySchema>;
