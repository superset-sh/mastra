---
'@mastra/core': minor
---

Added subagent tool call details to `@mastra/core` harness metadata and live display state so UIs can render per-tool inputs and outputs instead of only tool names and status.

**Before:**

```typescript
const parsed = parseSubagentMeta(content);

parsed.toolCalls;
// [{ name: 'read_file', isError: false }]
```

**After:**

```typescript
const parsed = parseSubagentMeta(content);

parsed.toolCalls;
// [{ name: 'read_file', isError: false, args: { path: '/hello.txt' }, result: '1 | Hello from workspace!' }]
```
