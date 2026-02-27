---
name: build-and-test
description: Rebuild server dist and run vitest unit tests
disable-model-invocation: true
---

After modifying server/src/ files, run the full rebuild pipeline:

1. `cd server && npm run build` — compile TypeScript to dist/
2. `cd server && npm test` — run vitest unit tests

Report any failures. If the build or tests fail, stop and show the errors.
