---
'@mastra/playground-ui': patch
'@mastra/client-js': patch
'@mastra/server': patch
'@mastra/mongodb': patch
'@mastra/core': patch
'@mastra/libsql': patch
'@mastra/pg': patch
---

Fixed MCP server tools endpoints to return fresh tool data from storage instead of stale in-memory instances after editing a stored server
