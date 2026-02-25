---
'@mastra/core': minor
---

Added standalone Harness support. The Harness now auto-creates a minimal internal Mastra instance during `init()` when not registered with an external one, ensuring mode agents receive proper dependency injection for features like tool approval.

**New public API**

```ts
const harness = new Harness({
  id: 'my-harness',
  storage,
  modes: [{ id: 'build', default: true, agent: myAgent }],
  stateSchema: z.object({}),
});

await harness.init();

// Access the auto-created Mastra instance
const mastra = harness.getMastra();

// Access the current mode agent
const agent = harness.getCurrentAgent();
```

**Improved addHarness()**

When registering a Harness with Mastra via `addHarness()`, static mode agents are now automatically registered with Mastra so they receive full dependency injection. Previously, mode agents had to be separately registered via `agents` in the Mastra config.
