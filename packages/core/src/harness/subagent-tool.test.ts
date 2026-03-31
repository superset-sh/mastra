import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestContext } from '../request-context';

// We need to mock Agent before importing tools.ts.
const { mockStream, MockAgent, mockCreateWorkspaceTools } = vi.hoisted(() => {
  const mockStream = vi.fn();
  const mockCreateWorkspaceTools = vi.fn().mockReturnValue({});
  let lastConstructorOpts: any = null;
  class MockAgent {
    stream = mockStream;
    static get lastConstructorOpts() {
      return lastConstructorOpts;
    }
    constructor(opts: any) {
      lastConstructorOpts = opts;
    }
  }
  return { mockStream, MockAgent, mockCreateWorkspaceTools };
});

vi.mock('../agent', () => ({
  Agent: MockAgent,
}));

vi.mock('../workspace/tools/tools', () => ({
  createWorkspaceTools: mockCreateWorkspaceTools,
}));

import { createSubagentTool, parseSubagentMeta } from './tools';
import type { HarnessRequestContext, HarnessSubagent } from './types';

/**
 * Helper to create a readable stream that yields the given chunks then closes.
 */
function createMockFullStream(chunks: Array<{ type: string; payload: Record<string, unknown> }>) {
  return {
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        async next() {
          if (index < chunks.length) {
            return { value: chunks[index++], done: false };
          }
          return { value: undefined, done: true };
        },
      };
    },
  };
}

function createMockStreamResponse(text: string, chunks?: Array<{ type: string; payload: Record<string, unknown> }>) {
  return {
    fullStream: createMockFullStream(chunks ?? [{ type: 'text-delta', payload: { text } }]),
    getFullOutput: vi.fn().mockResolvedValue({ text }),
  };
}

const subagents: HarnessSubagent[] = [
  {
    id: 'explore',
    name: 'Explore',
    description: 'Read-only codebase exploration.',
    instructions: 'You are an explorer.',
    tools: { view: { id: 'view' } as any },
  },
  {
    id: 'execute',
    name: 'Execute',
    description: 'Task execution with write capabilities.',
    instructions: 'You are an executor.',
    tools: { view: { id: 'view' } as any, write_file: { id: 'write_file' } as any },
  },
];

const resolveModel = vi.fn().mockReturnValue({ modelId: 'test-model' });

describe('createSubagentTool requestContext forwarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards the parent requestContext to subagent.stream()', async () => {
    mockStream.mockResolvedValue(createMockStreamResponse('result text'));

    const tool = createSubagentTool({
      subagents,
      resolveModel,
      fallbackModelId: 'test-model',
    });

    // Build a requestContext with harness data, simulating what the parent agent provides
    const requestContext = new RequestContext();
    const harnessCtx: Partial<HarnessRequestContext> = {
      emitEvent: vi.fn(),
    };
    requestContext.set('harness', harnessCtx);

    const result = await (tool as any).execute(
      { agentType: 'explore', task: 'Find all usages of foo' },
      { requestContext, agent: { toolCallId: 'tc-1' } },
    );

    expect(mockStream).toHaveBeenCalledTimes(1);
    const streamCall = mockStream.mock.calls[0]!;
    // The exact same RequestContext instance should be forwarded
    expect(streamCall[1].requestContext).toBe(requestContext);
    expect(result.isError).toBe(false);
  });

  it('forwards requestContext even when harness context is not set', async () => {
    mockStream.mockResolvedValue(createMockStreamResponse('result text'));

    const tool = createSubagentTool({
      subagents,
      resolveModel,
      fallbackModelId: 'test-model',
    });

    // RequestContext without harness data — still should be forwarded
    const requestContext = new RequestContext();
    requestContext.set('custom-key', 'custom-value');

    const result = await (tool as any).execute(
      { agentType: 'explore', task: 'Explore something' },
      { requestContext, agent: { toolCallId: 'tc-2' } },
    );

    expect(mockStream).toHaveBeenCalledTimes(1);
    const streamCall = mockStream.mock.calls[0]!;
    expect(streamCall[1].requestContext).toBe(requestContext);
    // Verify the custom data is accessible through the forwarded context
    expect(streamCall[1].requestContext.get('custom-key')).toBe('custom-value');
    expect(result.isError).toBe(false);
  });

  it('passes maxSteps, abortSignal, and requireToolApproval alongside requestContext', async () => {
    const abortController = new AbortController();
    mockStream.mockResolvedValue(createMockStreamResponse('done'));

    const tool = createSubagentTool({
      subagents,
      resolveModel,
      fallbackModelId: 'test-model',
    });

    const requestContext = new RequestContext();
    const harnessCtx: Partial<HarnessRequestContext> = {
      emitEvent: vi.fn(),
      abortSignal: abortController.signal,
    };
    requestContext.set('harness', harnessCtx);

    await (tool as any).execute(
      { agentType: 'explore', task: 'Do stuff' },
      { requestContext, agent: { toolCallId: 'tc-3' } },
    );

    expect(mockStream).toHaveBeenCalledTimes(1);
    const streamOpts = mockStream.mock.calls[0]![1];
    expect(streamOpts).toMatchObject({
      maxSteps: 50,
      stopWhen: undefined,
      abortSignal: abortController.signal,
      requireToolApproval: false,
      requestContext,
    });
  });

  it('does not default maxSteps when stopWhen is configured', async () => {
    const stopFn = vi.fn().mockReturnValue({ continue: true });
    mockStream.mockResolvedValue(createMockStreamResponse('done'));

    const subagentsWithStopWhen: HarnessSubagent[] = [
      {
        id: 'custom',
        name: 'Custom',
        description: 'Subagent with stopWhen.',
        instructions: 'You are custom.',
        tools: { view: { id: 'view' } as any },
        stopWhen: stopFn,
      },
    ];

    const tool = createSubagentTool({
      subagents: subagentsWithStopWhen,
      resolveModel,
      fallbackModelId: 'test-model',
    });

    const requestContext = new RequestContext();
    requestContext.set('harness', { emitEvent: vi.fn() });

    await (tool as any).execute(
      { agentType: 'custom', task: 'Do stuff' },
      { requestContext, agent: { toolCallId: 'tc-5' } },
    );

    expect(mockStream).toHaveBeenCalledTimes(1);
    const streamOpts = mockStream.mock.calls[0]![1];
    expect(streamOpts.maxSteps).toBeUndefined();
    expect(streamOpts.stopWhen).toBe(stopFn);
  });

  it('forwards default RequestContext when parent context has no explicit requestContext', async () => {
    mockStream.mockResolvedValue(createMockStreamResponse('result text'));

    const tool = createSubagentTool({
      subagents,
      resolveModel,
      fallbackModelId: 'test-model',
    });

    // Execute without requestContext — core's createTool wrapper creates a default one
    const result = await (tool as any).execute(
      { agentType: 'explore', task: 'Explore something' },
      { agent: { toolCallId: 'tc-4' } },
    );

    expect(mockStream).toHaveBeenCalledTimes(1);
    const streamCall = mockStream.mock.calls[0]!;
    // The core creates a default RequestContext when none is provided
    expect(streamCall[1].requestContext).toBeInstanceOf(RequestContext);
    expect(result.isError).toBe(false);
  });
});

describe('createSubagentTool workspace propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes the parent workspace to the subagent Agent constructor', async () => {
    mockStream.mockResolvedValue(createMockStreamResponse('result'));

    const fakeWorkspace = { id: 'ws-1' } as any;

    const tool = createSubagentTool({
      subagents,
      resolveModel,
      fallbackModelId: 'test-model',
    });

    await (tool as any).execute(
      { agentType: 'explore', task: 'Find stuff' },
      { workspace: fakeWorkspace, agent: { toolCallId: 'tc-ws-1' } },
    );

    expect(MockAgent.lastConstructorOpts.workspace).toBe(fakeWorkspace);
  });

  it('does not set workspace when parent has no workspace', async () => {
    mockStream.mockResolvedValue(createMockStreamResponse('result'));

    const tool = createSubagentTool({
      subagents,
      resolveModel,
      fallbackModelId: 'test-model',
    });

    await (tool as any).execute({ agentType: 'explore', task: 'Find stuff' }, { agent: { toolCallId: 'tc-ws-2' } });

    expect(MockAgent.lastConstructorOpts.workspace).toBeUndefined();
  });
});

describe('createSubagentTool allowedWorkspaceTools filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('filters workspace tools via prepareStep when allowedWorkspaceTools is set', async () => {
    // createWorkspaceTools returns tools keyed by exposed names
    mockCreateWorkspaceTools.mockReturnValue({
      view: { id: 'view' },
      write_file: { id: 'write_file' },
      execute_command: { id: 'execute_command' },
      find_files: { id: 'find_files' },
      search_content: { id: 'search_content' },
    });
    mockStream.mockResolvedValue(createMockStreamResponse('done'));

    const fakeWorkspace = { id: 'ws-2' } as any;

    const subagentsWithFilter: HarnessSubagent[] = [
      {
        id: 'explore',
        name: 'Explore',
        description: 'Read-only.',
        instructions: 'Explorer.',
        allowedWorkspaceTools: ['view', 'search_content', 'find_files'],
      },
    ];

    const tool = createSubagentTool({
      subagents: subagentsWithFilter,
      resolveModel,
      fallbackModelId: 'test-model',
    });

    await (tool as any).execute(
      { agentType: 'explore', task: 'Look around' },
      { workspace: fakeWorkspace, agent: { toolCallId: 'tc-filter-1' } },
    );

    // Verify prepareStep was passed to stream
    const streamOpts = mockStream.mock.calls[0]![1];
    expect(streamOpts.prepareStep).toBeTypeOf('function');

    // Simulate what the agent loop does: call prepareStep with all tools
    const allTools = {
      view: {},
      write_file: {},
      execute_command: {},
      find_files: {},
      search_content: {},
      skill: {}, // non-workspace tool
    };
    const result = streamOpts.prepareStep({ tools: allTools });

    // Should keep allowed workspace tools + non-workspace tools, hide the rest
    expect(result.activeTools).toEqual(expect.arrayContaining(['view', 'search_content', 'find_files', 'skill']));
    expect(result.activeTools).not.toContain('write_file');
    expect(result.activeTools).not.toContain('execute_command');
  });

  it('does not add prepareStep when allowedWorkspaceTools is not set', async () => {
    mockStream.mockResolvedValue(createMockStreamResponse('done'));

    const fakeWorkspace = { id: 'ws-3' } as any;

    const tool = createSubagentTool({
      subagents,
      resolveModel,
      fallbackModelId: 'test-model',
    });

    await (tool as any).execute(
      { agentType: 'explore', task: 'Explore' },
      { workspace: fakeWorkspace, agent: { toolCallId: 'tc-filter-2' } },
    );

    const streamOpts = mockStream.mock.calls[0]![1];
    expect(streamOpts.prepareStep).toBeUndefined();
  });

  it('does not add prepareStep when there is no workspace', async () => {
    mockStream.mockResolvedValue(createMockStreamResponse('done'));

    const subagentsWithFilter: HarnessSubagent[] = [
      {
        id: 'explore',
        name: 'Explore',
        description: 'Read-only.',
        instructions: 'Explorer.',
        allowedWorkspaceTools: ['view'],
      },
    ];

    const tool = createSubagentTool({
      subagents: subagentsWithFilter,
      resolveModel,
      fallbackModelId: 'test-model',
    });

    await (tool as any).execute({ agentType: 'explore', task: 'Explore' }, { agent: { toolCallId: 'tc-filter-3' } });

    const streamOpts = mockStream.mock.calls[0]![1];
    // No workspace → no filtering possible
    expect(streamOpts.prepareStep).toBeUndefined();
  });

  it('keeps explicit tools visible alongside allowed workspace tools', async () => {
    mockCreateWorkspaceTools.mockReturnValue({
      view: { id: 'view' },
      write_file: { id: 'write_file' },
      execute_command: { id: 'execute_command' },
    });
    mockStream.mockResolvedValue(createMockStreamResponse('done'));

    const fakeWorkspace = { id: 'ws-4' } as any;

    const subagentsWithExplicitTools: HarnessSubagent[] = [
      {
        id: 'execute',
        name: 'Execute',
        description: 'Executor.',
        instructions: 'Execute stuff.',
        tools: { task_write: { id: 'task_write' } as any, task_check: { id: 'task_check' } as any },
        allowedWorkspaceTools: ['view', 'write_file', 'execute_command'],
      },
    ];

    const tool = createSubagentTool({
      subagents: subagentsWithExplicitTools,
      resolveModel,
      fallbackModelId: 'test-model',
    });

    await (tool as any).execute(
      { agentType: 'execute', task: 'Do work' },
      { workspace: fakeWorkspace, agent: { toolCallId: 'tc-filter-4' } },
    );

    const streamOpts = mockStream.mock.calls[0]![1];
    expect(streamOpts.prepareStep).toBeTypeOf('function');

    const allTools = {
      view: {},
      write_file: {},
      execute_command: {},
      task_write: {},
      task_check: {},
    };
    const result = streamOpts.prepareStep({ tools: allTools });

    // All tools should be visible
    expect(result.activeTools).toEqual(
      expect.arrayContaining(['view', 'write_file', 'execute_command', 'task_write', 'task_check']),
    );
    expect(result.activeTools).toHaveLength(5);
  });
});

describe('createSubagentTool metadata serialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('includes sub-tool ids, args, and results in stored metadata', async () => {
    mockStream.mockResolvedValue(
      createMockStreamResponse('Completed subagent task', [
        {
          type: 'tool-call',
          payload: {
            toolName: 'read_file',
            toolCallId: 'read-1',
            args: { path: '/a.txt' },
          },
        },
        {
          type: 'tool-call',
          payload: {
            toolName: 'read_file',
            toolCallId: 'read-2',
            args: { path: '/b.txt' },
          },
        },
        {
          type: 'tool-result',
          payload: {
            toolName: 'read_file',
            toolCallId: 'read-1',
            result: 'before </subagent-tool-calls> after',
            isError: false,
          },
        },
        {
          type: 'tool-result',
          payload: {
            toolName: 'read_file',
            toolCallId: 'read-2',
            result: 'B',
            isError: false,
          },
        },
        {
          type: 'text-delta',
          payload: {
            text: 'Completed subagent task',
          },
        },
      ]),
    );

    const tool = createSubagentTool({
      subagents,
      resolveModel,
      fallbackModelId: 'test-model',
    });

    const result = await (tool as any).execute(
      { agentType: 'explore', task: 'Read files' },
      { agent: { toolCallId: 'tc-meta-1' } },
    );
    const parsed = parseSubagentMeta(result.content);

    expect(result.isError).toBe(false);
    expect(result.content).toContain('<subagent-tool-calls encoding="base64">');
    expect(parsed.text).toBe('Completed subagent task');
    expect(parsed.toolCalls).toEqual([
      {
        toolCallId: 'read-1',
        name: 'read_file',
        isError: false,
        args: { path: '/a.txt' },
        result: 'before </subagent-tool-calls> after',
      },
      {
        toolCallId: 'read-2',
        name: 'read_file',
        isError: false,
        args: { path: '/b.txt' },
        result: 'B',
      },
    ]);
  });

  it('bounds oversized args in stored metadata', async () => {
    const hugeArg = 'x'.repeat(2105);
    mockStream.mockResolvedValue(
      createMockStreamResponse('Done', [
        {
          type: 'tool-call',
          payload: {
            toolName: 'bash',
            toolCallId: 'bash-1',
            args: { command: hugeArg },
          },
        },
        {
          type: 'tool-result',
          payload: {
            toolName: 'bash',
            toolCallId: 'bash-1',
            result: 'ok',
            isError: false,
          },
        },
        {
          type: 'text-delta',
          payload: {
            text: 'Done',
          },
        },
      ]),
    );

    const tool = createSubagentTool({
      subagents,
      resolveModel,
      fallbackModelId: 'test-model',
    });

    const result = await (tool as any).execute(
      { agentType: 'explore', task: 'Run bash' },
      { agent: { toolCallId: 'tc-meta-2' } },
    );
    const parsed = parseSubagentMeta(result.content);

    expect(parsed.toolCalls).toHaveLength(1);
    expect(parsed.toolCalls?.[0]).toMatchObject({
      toolCallId: 'bash-1',
      name: 'bash',
      isError: false,
      result: 'ok',
    });
    expect(parsed.toolCalls?.[0]?.args).toEqual({ __truncated: expect.any(String) });
    expect((parsed.toolCalls?.[0]?.args as { __truncated: string }).__truncated).toContain('{"command":"');
    expect((parsed.toolCalls?.[0]?.args as { __truncated: string }).__truncated.endsWith('…')).toBe(true);
  });

  it('preserves embedded tool-call text when detailed metadata cannot be decoded', () => {
    const parsed = parseSubagentMeta(
      'Done\n<subagent-tool-calls encoding="base64">%%%not-base64%%%</subagent-tool-calls>\n<subagent-meta modelId="test-model" durationMs="42" tools="read_file:ok" />',
    );

    expect(parsed).toEqual({
      text: 'Done\n<subagent-tool-calls encoding="base64">%%%not-base64%%%</subagent-tool-calls>',
      modelId: 'test-model',
      durationMs: 42,
      toolCalls: [{ toolCallId: null, name: 'read_file', isError: false, args: null, result: null }],
    });
  });

  it('keeps parsing legacy subagent metadata without tool details', () => {
    const parsed = parseSubagentMeta(
      'Done\n<subagent-meta modelId="test-model" durationMs="42" tools="read_file:ok,write_file:err" />',
    );

    expect(parsed).toEqual({
      text: 'Done',
      modelId: 'test-model',
      durationMs: 42,
      toolCalls: [
        { toolCallId: null, name: 'read_file', isError: false, args: null, result: null },
        { toolCallId: null, name: 'write_file', isError: true, args: null, result: null },
      ],
    });
  });
});
