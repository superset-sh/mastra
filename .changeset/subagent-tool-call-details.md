---
'@mastra/core': minor
---

Added subagent tool call details to `@mastra/core` harness metadata and live display state so UIs can render repeated subagent tool calls with their nested tool IDs, bounded inputs, and outputs.

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
// [{ toolCallId: 'read-1', name: 'read_file', isError: false, args: { path: '/hello.txt' }, result: '1 | Hello' }]
```
