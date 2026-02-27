---
'@mastra/core': patch
'mastracode': patch
---

Renamed `images` to `files` in `harness.sendMessage(...)` to align with the AI SDK `FilePart` shape.

**Migration**

Before:
```ts
await harness.sendMessage({ content: "Hi", images: [{ data, mimeType }] });
```

After:
```ts
await harness.sendMessage({ content: "Hi", files: [{ data, mediaType, filename }] });
```
