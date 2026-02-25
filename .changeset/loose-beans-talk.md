---
'mastracode': patch
---

Simplified startup by removing explicit Mastra instance creation. The Harness now manages its own internal Mastra, so `createMastraCode` no longer needs to wire up Mastra separately.
