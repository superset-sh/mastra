---
'@mastra/core': minor
'@mastra/server': patch
---

Added Harness as a first-class Mastra component. You can now register harnesses with the Mastra instance using the `harnesses` config field or `addHarness()` method. Registered harnesses inherit shared resources (logger, storage, memory, workspace) as fallbacks from Mastra, so you don't need to pass them separately.

**Registration example:**

```typescript
import { Mastra } from '@mastra/core';
import { Harness } from '@mastra/core/harness';
import { Agent } from '@mastra/core/agent';

const agent = new Agent({ id: 'my-agent', model: 'openai:gpt-4o', instructions: '...' });
const harness = new Harness({
  id: 'my-harness',
  modes: { default: { id: 'default', agent, default: true } },
});

const mastra = new Mastra({
  agents: { agent },
  harnesses: { myHarness: harness },
});

// Retrieve later
const h = mastra.getHarness('myHarness');
const h2 = mastra.getHarnessById('my-harness');
const all = mastra.listHarnesses();
```
