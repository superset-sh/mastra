---
'@mastra/server': patch
---

Fixed MCP server list and detail endpoints returning stale version and name after edits. Stored server data is now always read from the latest draft in storage.
