---
'@mastra/e2b': patch
---

Fixed `getInstructions()` to dynamically detect the sandbox working directory via `pwd` instead of hardcoding `/home/user`, which may be incorrect for custom E2B templates with a different `WORKDIR`.
