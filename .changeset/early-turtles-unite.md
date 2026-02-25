---
'@mastra/react': patch
---

Fixed dev playground header not being sent when using `mastra studio` with a separate local server (`--server-port`). The `x-mastra-dev-playground` header is now correctly included for localhost and 127.0.0.1 URLs, enabling the `MASTRA_DEV=true` auth bypass.
