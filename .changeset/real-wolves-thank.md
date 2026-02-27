---
'mastracode': minor
'@mastra/core': patch
---

Added pre/post hook wrapping for tool execution via `HookManager` and exported `createAuthStorage` for standalone auth provider initialization.

`@mastra/core` receives a patch bump as a peer dependency of `mastracode`.

**New API: `createAuthStorage`**

```ts
import { createAuthStorage } from 'mastracode';

const authStorage = createAuthStorage();
// authStorage is now wired into Claude Max and OpenAI Codex providers
```
