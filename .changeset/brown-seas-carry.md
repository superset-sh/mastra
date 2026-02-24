---
'@mastra/core': minor
---

Sandbox tool results sent to the model now omit ANSI color codes while streamed output keeps colors. This reduces token usage and improves model readability.

Commands ending with `| tail -N` now stream output live and still return only the last N lines in the final result, preventing long commands from blocking streaming.

All workspace tools that return potentially large output (`grep`, `read_file`, `list_files`, `search`) now enforce a hard 30k character limit to prevent oversized results from overwhelming the model context window.

```ts
// ANSI stripping (automatic via toModelOutput on sandbox tools):
// Streamed to user: "\x1b[32mSuccess\x1b[0m" (colored)
// Sent to model:    "Success" (clean text, fewer tokens)

// Tail pipe extraction:
// Agent calls: execute_command({ command: "npm test | tail -20" })
// What actually runs: "npm test" (all output streams live to user)
// What the model gets: last 20 lines only
```
