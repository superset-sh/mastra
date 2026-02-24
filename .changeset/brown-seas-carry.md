---
'@mastra/core': minor
---

Added `sandboxToModelOutput` to sandbox tools (execute_command, get_process_output, kill_process) — strips ANSI escape codes from tool results sent to the model while preserving colors in the stream. This saves tokens and prevents the model from seeing raw escape sequences like `[31m`.

Added tail pipe extraction to execute_command — strips `| tail -N` from commands before execution so output streams in real time, then applies tail programmatically to the final result. LLMs are trained to pipe to tail for long outputs, which blocks streaming.

```ts
// ANSI stripping happens automatically via toModelOutput:
// Stream sees: "\x1b[32mSuccess\x1b[0m"
// Model sees:  "Success"

// Tail pipe extraction:
// Agent sends: "npm test | tail -20"
// Actual command run: "npm test" (streams all output)
// Model result: last 20 lines only
```
