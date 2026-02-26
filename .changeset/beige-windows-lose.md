---
'@mastra/blaxel': patch
---

Fixed timeout not being enforced in `executeCommand()` — added client-side timeout via `Promise.race` as a safety net when the Blaxel API does not honor its timeout parameter. Changed default image from `blaxel/py-app:latest` to `blaxel/node:latest` so Node.js is available out of the box (matching E2B and Daytona defaults). Fixed `getInstructions()` to dynamically detect the sandbox working directory via `pwd` instead of hardcoding `/home/user`, which was incorrect for Blaxel's actual working directory.
