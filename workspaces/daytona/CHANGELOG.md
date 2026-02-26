# @mastra/daytona

## 0.1.0-alpha.0

### Minor Changes

- Add DaytonaSandbox workspace provider — Daytona cloud sandbox integration for Mastra workspaces, implementing the WorkspaceSandbox interface with support for command execution, environment variables, resource configuration, snapshots, and Daytona volumes. ([#13112](https://github.com/mastra-ai/mastra/pull/13112))

  **Basic usage**

  ```ts
  import { Workspace } from '@mastra/core/workspace';
  import { DaytonaSandbox } from '@mastra/daytona';

  const sandbox = new DaytonaSandbox({
    id: 'my-sandbox',
    env: { NODE_ENV: 'production' },
  });

  const workspace = new Workspace({ sandbox });
  await workspace.init();

  const result = await workspace.sandbox.executeCommand('echo', ['Hello!']);
  console.log(result.stdout); // "Hello!"

  await workspace.destroy();
  ```

### Patch Changes

- Updated dependencies [[`88de7e8`](https://github.com/mastra-ai/mastra/commit/88de7e8dfe4b7e1951a9e441bb33136e705ce24e), [`edee4b3`](https://github.com/mastra-ai/mastra/commit/edee4b37dff0af515fc7cc0e8d71ee39e6a762f0), [`09c3b18`](https://github.com/mastra-ai/mastra/commit/09c3b1802ff14e243a8a8baea327440bc8cc2e32), [`524c0f3`](https://github.com/mastra-ai/mastra/commit/524c0f3c434c3d9d18f66338dcef383d6161b59c), [`b03c0e0`](https://github.com/mastra-ai/mastra/commit/b03c0e0389a799523929a458b0509c9e4244d562), [`191e5bd`](https://github.com/mastra-ai/mastra/commit/191e5bd29b82f5bda35243945790da7bc7b695c2), [`31c78b3`](https://github.com/mastra-ai/mastra/commit/31c78b3eb28f58a8017f1dcc795c33214d87feac)]:
  - @mastra/core@1.9.0-alpha.0
