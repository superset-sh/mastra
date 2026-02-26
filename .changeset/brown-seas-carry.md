---
'@mastra/core': minor
---

Sandbox tool results sent to the model now omit ANSI color codes while streamed output keeps colors. This reduces token usage and improves model readability.

Commands ending with `| tail -N` now stream output live and still return only the last N lines in the final result, preventing long commands from blocking streaming.

Workspace tools that return potentially large output (`grep`, `read_file`, `list_files`, `execute_command`) now enforce a token-based output limit (~3k tokens by default, configurable via `maxOutputTokens` in tool config). Token estimation uses a `words * 1.3` heuristic. This replaces the previous character-based limit with a more model-friendly token budget.

```ts
// ANSI stripping (automatic via toModelOutput on sandbox tools):
// Streamed to user: "\x1b[32mSuccess\x1b[0m" (colored)
// Sent to model:    "Success" (clean text, fewer tokens)

// Tail pipe extraction:
// Agent calls: execute_command({ command: "npm test | tail -20" })
// What actually runs: "npm test" (all output streams live to user)
// What the model gets: last 20 lines only

// Configurable token limit:
const workspace = new Workspace({
  tools: {
    mastra_workspace_execute_command: {
      maxOutputTokens: 5000, // override default 3k
    },
  },
});
```
