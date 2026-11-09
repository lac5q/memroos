# @memroos/memory-core

`@memroos/memory-core` is a standalone Apache-2.0 package containing
source-available deterministic memory primitives under the current repository
license. It is not the OSS edition, its API is unstable, and release or
publication remains subject to review:

- evidence request/result binding and the open local baseline ranker;
- offline retrieval-query planning and content-token extraction;
- trained-ranking identity and observation contract schemas;
- canonical key-sorted SHA-256 request hashing;
- pure memory-label decisions and complete engine-scope checks and hashes.

It is not a full memory server. It has no learner, remote provider, network, storage,
evaluation corpus, or storage-backed authorization service. Policy decisions
are pure helpers and do not replace authenticated identity, tenant and source
admission, resolved memberships, lifecycle checks, or required audit.
Request and evidence hashes bind inputs and revisions; they do not authorize
access to evidence.

The package is licensed under Apache-2.0. The
root `LICENSE` is carried here byte-for-byte for the current workspace; this
package has no publication permission or release claim.

Hash and ranking behavior can depend on the runtime locale. Callers that need
reproducible results should pin and document the runtime locale alongside
their inputs and package version.

Import the package root or one of its explicit subpaths:

```ts
import { planRetrievalQuery, rankEvidenceBaseline } from "@memroos/memory-core";
import { hashEngineRequest } from "@memroos/memory-core/hash";
import { authorizeMemoryUse } from "@memroos/memory-core/memory-policy";
import { hashMemoryEngineScope } from "@memroos/memory-core/memory-scope";
```

Development commands:

```bash
npm run build
npm run typecheck
npm test
npm run check:build
```

Rebuild after editing package source. In the monorepo, use
`npm run build:memory-core`; app build, dev and typecheck commands build it
explicitly, and Vitest global setup rebuilds it before tests. Direct Next
build/dev and the source CLI loader reject missing or stale output. Run app
typechecks through the npm command, rather than invoking `tsc` against old
declarations. The build records source/output hashes, cleans old output and
serializes concurrent builds and reuses unchanged output. After a crashed build,
remove `.build-lock` before
retrying. Restart running app/test processes after rebuilding this package.

The build-state file checks development freshness. It does not grant publication
permission or prove artifact authenticity. The library itself has no build-time
filesystem requirement when installed as compiled JavaScript.
