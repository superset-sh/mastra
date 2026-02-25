---
'@mastra/server': minor
'@mastra/core': patch
---

Added HTTP API endpoints for harnesses. When harnesses are registered with the Mastra instance, the server automatically exposes routes for managing sessions, sending messages, streaming events, thread management, tool approval, mode/model switching, state management, and permissions. All four server adapters (Hono, Express, Fastify, Koa) serve these routes automatically.
