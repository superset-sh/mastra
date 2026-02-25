---
'@mastra/core': minor
---

**Added** local symlink mounts in `LocalSandbox` so sandboxed commands can access locally-mounted filesystem paths.
**Improved** mount path resolution under the sandbox working directory and cleanup on stop/destroy.
**Improved** workspace instructions to show the resolved mount location.

**Why:** Local sandboxes can now run commands against locally-mounted data without manual path workarounds.

Related issues: COR-495, COR-554.

**Usage example:**

```typescript
const workspace = new Workspace({
  mounts: {
    '/data': new LocalFilesystem({ basePath: '/path/to/data' }),
  },
  sandbox: new LocalSandbox({ workingDirectory: './workspace' }),
});

await workspace.init();
// Sandboxed commands can access the mount path via symlink
await workspace.sandbox.executeCommand('ls', ['data']);
```
