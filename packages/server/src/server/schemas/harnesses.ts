import z from 'zod';

// Path parameter schemas
export const harnessIdPathParams = z.object({
  harnessId: z.string().describe('Unique identifier for the harness'),
});

// Body schemas
export const sendMessageBodySchema = z.object({
  content: z.string().describe('The message content to send'),
  images: z
    .array(
      z.object({
        url: z.string().describe('Image URL or base64 data'),
        mimeType: z.string().optional().describe('MIME type of the image'),
      }),
    )
    .optional()
    .describe('Optional images to include with the message'),
});

export const toolApprovalBodySchema = z.object({
  decision: z.enum(['approve', 'decline', 'always_allow_category']).describe('Tool approval decision'),
});

export const questionResponseBodySchema = z.object({
  questionId: z.string().describe('ID of the question being answered'),
  answer: z.string().describe('The user answer'),
});

export const planApprovalBodySchema = z.object({
  planId: z.string().describe('ID of the plan being reviewed'),
  response: z.enum(['approved', 'rejected']).describe('Plan approval decision'),
  feedback: z.string().optional().describe('Optional feedback for the plan'),
});

export const switchModeBodySchema = z.object({
  modeId: z.string().describe('ID of the mode to switch to'),
});

export const switchModelBodySchema = z.object({
  modelId: z.string().describe('ID of the model to switch to'),
  scope: z.enum(['mode', 'subagent', 'om-observer', 'om-reflector']).optional().describe('Scope for the model change'),
  modeId: z.string().optional().describe('Specific mode ID (when scope is "mode")'),
});

export const createThreadBodySchema = z.object({
  title: z.string().optional().describe('Optional title for the new thread'),
});

export const switchThreadBodySchema = z.object({
  threadId: z.string().describe('ID of the thread to switch to'),
});

export const updateStateBodySchema = z.object({
  updates: z.record(z.unknown()).describe('Partial state update to merge into current state'),
});

export const renameThreadBodySchema = z.object({
  title: z.string().describe('New title for the thread'),
});

export const setPermissionCategoryBodySchema = z.object({
  category: z.string().describe('Permission category'),
  policy: z.enum(['allow', 'deny', 'ask']).describe('Permission policy'),
});

export const setPermissionToolBodySchema = z.object({
  toolName: z.string().describe('Tool name'),
  policy: z.enum(['allow', 'deny', 'ask']).describe('Permission policy'),
});

export const grantSessionCategoryBodySchema = z.object({
  category: z.string().describe('Category to grant for this session'),
});

export const grantSessionToolBodySchema = z.object({
  toolName: z.string().describe('Tool name to grant for this session'),
});

export const listMessagesQuerySchema = z.object({
  limit: z.coerce.number().optional().describe('Maximum number of messages to return'),
});

export const listThreadsQuerySchema = z.object({
  allResources: z.string().optional().describe('Set to "true" to list threads across all resources'),
});
