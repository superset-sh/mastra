---
'@mastra/core': patch
'mastracode': patch
---

Support file attachments in harness with filename preservation and text file handling.

- Rename `images` to `files` in `sendMessage` API to support all file types
- Preserve `filename` field through AIV4Adapter and AIV5Adapter when storing file parts to DB
- Decode text-based files (`text/*`, `application/json`) to text content parts instead of binary file parts
- Add `file` type to `HarnessMessageContent` for proper round-tripping through `convertToHarnessMessage`
