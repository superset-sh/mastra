---
'@mastra/blaxel': patch
---

Fixed command timeouts in Blaxel sandboxes so long-running commands now respect configured limits.

Changed the default Blaxel image to `blaxel/node:latest`, so Node.js is available by default.

Improved sandbox instructions to show the actual working directory instead of a fixed path.
