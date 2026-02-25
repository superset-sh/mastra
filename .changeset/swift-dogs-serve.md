---
'@mastra/server': patch
---

Added HTTP request logging infrastructure. This enables `apiReqLogs: true` (or a detailed `HttpLoggingConfig`) in the server config to log method, path, status, and duration for every request, with optional header redaction and path exclusions.
