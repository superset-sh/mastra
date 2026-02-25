import {
  LIST_HARNESSES_ROUTE,
  GET_HARNESS_ROUTE,
  CREATE_HARNESS_THREAD_ROUTE,
  LIST_HARNESS_THREADS_ROUTE,
  SWITCH_HARNESS_THREAD_ROUTE,
  RENAME_HARNESS_THREAD_ROUTE,
  SEND_HARNESS_MESSAGE_ROUTE,
  STREAM_HARNESS_MESSAGE_ROUTE,
  ABORT_HARNESS_ROUTE,
  HARNESS_EVENTS_ROUTE,
  RESPOND_TOOL_APPROVAL_ROUTE,
  RESPOND_QUESTION_ROUTE,
  RESPOND_PLAN_APPROVAL_ROUTE,
  LIST_HARNESS_MODES_ROUTE,
  SWITCH_HARNESS_MODE_ROUTE,
  SWITCH_HARNESS_MODEL_ROUTE,
  GET_HARNESS_STATE_ROUTE,
  UPDATE_HARNESS_STATE_ROUTE,
  GET_HARNESS_DISPLAY_STATE_ROUTE,
  LIST_HARNESS_MESSAGES_ROUTE,
  SET_PERMISSION_CATEGORY_ROUTE,
  SET_PERMISSION_TOOL_ROUTE,
  GRANT_SESSION_CATEGORY_ROUTE,
  GRANT_SESSION_TOOL_ROUTE,
  GET_PERMISSION_RULES_ROUTE,
  GET_TOKEN_USAGE_ROUTE,
} from '../../handlers/harnesses';
import type { ServerRoute } from '.';

export const HARNESS_ROUTES: ServerRoute<any, any, any>[] = [
  // ============================================================================
  // Discovery
  // ============================================================================
  LIST_HARNESSES_ROUTE,
  GET_HARNESS_ROUTE,

  // ============================================================================
  // Thread Management
  // ============================================================================
  CREATE_HARNESS_THREAD_ROUTE,
  LIST_HARNESS_THREADS_ROUTE,
  SWITCH_HARNESS_THREAD_ROUTE,
  RENAME_HARNESS_THREAD_ROUTE,

  // ============================================================================
  // Messaging
  // ============================================================================
  SEND_HARNESS_MESSAGE_ROUTE,
  STREAM_HARNESS_MESSAGE_ROUTE,
  ABORT_HARNESS_ROUTE,

  // ============================================================================
  // Event Stream
  // ============================================================================
  HARNESS_EVENTS_ROUTE,

  // ============================================================================
  // Interactive Responses
  // ============================================================================
  RESPOND_TOOL_APPROVAL_ROUTE,
  RESPOND_QUESTION_ROUTE,
  RESPOND_PLAN_APPROVAL_ROUTE,

  // ============================================================================
  // Mode / Model
  // ============================================================================
  LIST_HARNESS_MODES_ROUTE,
  SWITCH_HARNESS_MODE_ROUTE,
  SWITCH_HARNESS_MODEL_ROUTE,

  // ============================================================================
  // State
  // ============================================================================
  GET_HARNESS_STATE_ROUTE,
  UPDATE_HARNESS_STATE_ROUTE,
  GET_HARNESS_DISPLAY_STATE_ROUTE,

  // ============================================================================
  // Messages
  // ============================================================================
  LIST_HARNESS_MESSAGES_ROUTE,

  // ============================================================================
  // Permissions
  // ============================================================================
  SET_PERMISSION_CATEGORY_ROUTE,
  SET_PERMISSION_TOOL_ROUTE,
  GRANT_SESSION_CATEGORY_ROUTE,
  GRANT_SESSION_TOOL_ROUTE,
  GET_PERMISSION_RULES_ROUTE,

  // ============================================================================
  // Token Usage
  // ============================================================================
  GET_TOKEN_USAGE_ROUTE,
];
