import type { HarnessMode, HarnessSubagent, HeartbeatHandler } from "@mastra/core/harness";
import type { StorageConfig } from "./utils/project";

export interface MastraCodeConfig {
    /** Working directory for project detection. Default: process.cwd() */
    cwd?: string;
    /** Override modes (model IDs, colors, which modes exist). Default: build/plan/fast */
    modes?: HarnessMode[];
    /** Override or extend subagent definitions. Default: explore/plan/execute */
    subagents?: HarnessSubagent[];
    /** Extra tools merged into the dynamic tool set */
    extraTools?: Record<string, any>;
    /** Custom storage config instead of auto-detected default */
    storage?: StorageConfig;
    /** Initial state overrides (yolo, thinkingLevel, etc.) */
    initialState?: Record<string, unknown>;
    /** Override heartbeat handlers. Default: gateway-sync */
    heartbeatHandlers?: HeartbeatHandler[];
    /** Disable MCP server discovery. Default: false */
    disableMcp?: boolean;
    /** Disable hooks. Default: false */
    disableHooks?: boolean;
}