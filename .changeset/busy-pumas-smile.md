---
'@mastra/daytona': minor
---

Added S3 and GCS cloud filesystem mounting support via FUSE (s3fs-fuse, gcsfuse). Daytona sandboxes can now mount cloud storage as local directories, matching the mount capabilities of E2B and Blaxel providers.

**New methods:**

- `mount(filesystem, mountPath)` — Mount an S3 or GCS filesystem at a path in the sandbox
- `unmount(mountPath)` — Unmount a previously mounted filesystem

**Features:**

- Automatic s3fs/gcsfuse installation if not present in the sandbox image
- Marker file tracking for mount config change detection on reconnect
- Non-empty directory safety checks before mounting
- Mount reconciliation on sandbox reconnection (cleans up stale mounts)
- Per-mount credential isolation to support concurrent mounts

**Usage:**

```typescript
import { Workspace } from '@mastra/core/workspace';
import { S3Filesystem } from '@mastra/s3';
import { DaytonaSandbox } from '@mastra/daytona';

const workspace = new Workspace({
  mounts: {
    '/data': new S3Filesystem({
      bucket: 'my-bucket',
      region: 'us-east-1',
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }),
  },
  sandbox: new DaytonaSandbox(),
});
```
