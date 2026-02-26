import type {
  AvailableModel,
  HarnessDisplayState,
  HarnessEvent,
  HarnessMessage,
  HarnessMode,
  HarnessSession,
  HarnessThread,
  ModelAuthStatus,
  PermissionPolicy,
  PermissionRules,
  TokenUsage,
  ToolCategory,
} from '@mastra/core/harness';

// ─── Wire-safe versions of types with Maps ──────────────────────────────────

export interface SerializedActiveToolState {
  name: string;
  args: unknown;
  status: 'streaming_input' | 'running' | 'completed' | 'error';
  partialResult?: string;
  result?: unknown;
  isError?: boolean;
  shellOutput?: string;
}

export interface SerializedActiveSubagentState {
  agentType: string;
  task: string;
  modelId?: string;
  toolCalls: Array<{ name: string; isError: boolean }>;
  textDelta: string;
  status: 'running' | 'completed' | 'error';
  durationMs?: number;
  result?: string;
}

export interface SerializedModifiedFile {
  operations: string[];
  firstModified: string;
}

/**
 * JSON-serializable version of HarnessDisplayState.
 * Maps are converted to Record<string, T>.
 */
export interface SerializedDisplayState {
  isRunning: boolean;
  currentMessage: HarnessMessage | null;
  tokenUsage: TokenUsage;
  activeTools: Record<string, SerializedActiveToolState>;
  toolInputBuffers: Record<string, { text: string; toolName: string }>;
  pendingApproval: {
    toolCallId: string;
    toolName: string;
    args: unknown;
  } | null;
  pendingQuestion: {
    questionId: string;
    question: string;
    options?: Array<{ label: string; description?: string }>;
  } | null;
  pendingPlanApproval: {
    planId: string;
    title?: string;
    plan: string;
  } | null;
  activeSubagents: Record<string, SerializedActiveSubagentState>;
  omProgress: HarnessDisplayState['omProgress'];
  bufferingMessages: boolean;
  bufferingObservations: boolean;
  modifiedFiles: Record<string, SerializedModifiedFile>;
  tasks: Array<{
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    activeForm: string;
  }>;
  previousTasks: Array<{
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    activeForm: string;
  }>;
}

// ─── Snapshot sent on connection ─────────────────────────────────────────────

export interface HarnessSnapshot {
  state: Record<string, unknown>;
  displayState: SerializedDisplayState;
  modeId: string;
  modelId: string;
  threadId: string | null;
  resourceId: string;
  running: boolean;
  modes: SerializedMode[];
}

export interface SerializedMode {
  id: string;
  name?: string;
  default?: boolean;
  color?: string;
  defaultModelId?: string;
}

// ─── WebSocket protocol frames ───────────────────────────────────────────────

export interface EventFrame {
  type: 'event';
  event: HarnessEvent['type'];
  payload: unknown;
  seq: number;
}

export interface SnapshotFrame {
  type: 'snapshot';
  snapshot: HarnessSnapshot;
}

export interface ResponseFrame {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: string;
}

export interface RequestFrame {
  type: 'req';
  id: string;
  method: string;
  params?: unknown;
}

export type ServerFrame = EventFrame | SnapshotFrame | ResponseFrame;
export type ClientFrame = RequestFrame;

// ─── Transport configuration ─────────────────────────────────────────────────

export interface HarnessTransportConfig {
  harness: import('@mastra/core/harness').Harness;
  auth?: {
    validateToken: (token: string) => Promise<boolean> | boolean;
  };
}

// ─── Re-exports for consumer convenience ─────────────────────────────────────

export type {
  AvailableModel,
  HarnessEvent,
  HarnessMessage,
  HarnessMode,
  HarnessSession,
  HarnessThread,
  ModelAuthStatus,
  PermissionPolicy,
  PermissionRules,
  TokenUsage,
  ToolCategory,
};
