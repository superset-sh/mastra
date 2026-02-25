---
'@mastra/core': minor
---

Added `allSettled` mode for parallel workflow steps. Use `.parallel([step1, step2], { mode: 'allSettled' })` to allow the workflow to continue even when individual parallel steps fail. Failed steps are excluded from the output, while successful steps' results are preserved. This is useful for resilient patterns like running multiple research agents in parallel where partial results are acceptable.
