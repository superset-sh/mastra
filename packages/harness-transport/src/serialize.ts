import type { HarnessDisplayState, HarnessEvent } from '@mastra/core/harness';

import type { SerializedDisplayState, SerializedMode } from './types.js';

/**
 * Convert HarnessDisplayState (which contains Map fields) to a
 * JSON-serializable format.
 */
export function serializeDisplayState(ds: Readonly<HarnessDisplayState>): SerializedDisplayState {
  return {
    isRunning: ds.isRunning,
    currentMessage: ds.currentMessage,
    tokenUsage: ds.tokenUsage,
    pendingApproval: ds.pendingApproval,
    pendingQuestion: ds.pendingQuestion,
    pendingPlanApproval: ds.pendingPlanApproval,
    omProgress: ds.omProgress,
    bufferingMessages: ds.bufferingMessages,
    bufferingObservations: ds.bufferingObservations,
    tasks: ds.tasks,
    previousTasks: ds.previousTasks,
    activeTools: Object.fromEntries(ds.activeTools),
    toolInputBuffers: Object.fromEntries(ds.toolInputBuffers),
    activeSubagents: Object.fromEntries(ds.activeSubagents),
    modifiedFiles: Object.fromEntries(
      [...ds.modifiedFiles].map(([path, info]) => [
        path,
        { operations: info.operations, firstModified: info.firstModified.toISOString() },
      ]),
    ),
  };
}

/**
 * Serialize a HarnessEvent for wire transport.
 * Most events serialize directly; display_state_changed needs Map conversion.
 */
export function serializeEvent(event: HarnessEvent): unknown {
  if (event.type === 'display_state_changed') {
    return {
      type: event.type,
      displayState: serializeDisplayState(event.displayState),
    };
  }

  if (event.type === 'error') {
    return {
      type: event.type,
      error: { message: event.error.message, name: event.error.name },
      errorType: event.errorType,
      retryable: event.retryable,
      retryDelay: event.retryDelay,
    };
  }

  return event;
}

/**
 * Serialize a HarnessMode for wire transport (strips the agent reference).
 */
export function serializeMode(mode: { id: string; name?: string; default?: boolean; color?: string; defaultModelId?: string }): SerializedMode {
  return {
    id: mode.id,
    name: mode.name,
    default: mode.default,
    color: mode.color,
    defaultModelId: mode.defaultModelId,
  };
}
