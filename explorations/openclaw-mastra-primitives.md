# Building OpenClaw with Mastra Primitives

## Overview

This document explores how the core architectural patterns of [OpenClaw](https://docs.openclaw.ai/) — an open-source autonomous AI agent platform — map onto Mastra's primitive building blocks. The goal is not to replicate OpenClaw verbatim, but to understand which Mastra primitives naturally fulfill each architectural responsibility, where Mastra's abstractions provide stronger guarantees, and what gaps would need to be filled.

OpenClaw's architecture centers around a **Gateway** process that routes messages from multiple channels (WhatsApp, Telegram, Discord, Slack, etc.) through an LLM-powered **Agent Runtime** with access to **Tools**, **Memory**, and **Plugins**. It runs as a self-hosted, long-lived process.

---

## Architecture Comparison

| OpenClaw Concept | Mastra Primitive | Notes |
|---|---|---|
| Gateway (Control Plane) | `Mastra` class + Server adapter | Central orchestration hub |
| Agent Runtime | `Agent` | LLM interaction with tools, memory, instructions |
| Tools system | `Tool` / `createTool()` | Type-safe, schema-validated tools |
| Plugins / Skills | MCP Servers + Toolsets | Extensible tool registration |
| Memory (persistence) | `Memory` + `Storage` | Thread-based conversations, semantic recall, working memory |
| Session management | Threads + Resources | Thread-per-session with resource-scoped state |
| Multi-channel messaging | Custom tools + Input/Output Processors | Channel abstraction via processors |
| Message queueing | Workflows (event-driven) | Step-based execution with suspend/resume |
| Workspace / file system | `Workspace` | File storage and code execution |
| Multi-agent delegation | Supervisor / Network patterns | Built-in multi-agent orchestration |
| Configuration files (USER.md, IDENTITY.md) | `instructions` (dynamic) | Agent instructions, dynamically resolved |
| Cron / scheduling | Workflow triggers | Event-driven workflow execution |

---

## 1. The Gateway — `Mastra` Class as Control Plane

OpenClaw's Gateway is the central process through which all operations flow. It manages channel connections, routes messages, and orchestrates the agent runtime. In Mastra, the `Mastra` class fills this exact role — it's the dependency injection hub that wires together agents, tools, memory, storage, and server endpoints.

```typescript
import { Mastra } from '@mastra/core';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { PgVector } from '@mastra/pg-vector';

const storage = new LibSQLStore({
  id: 'openclaw-storage',
  url: process.env.DATABASE_URL!,
});

const vectorStore = new PgVector({
  connectionString: process.env.VECTOR_DB_URL!,
});

const memory = new Memory({
  options: {
    lastMessages: 40,
    semanticRecall: {
      topK: 5,
      messageRange: { before: 2, after: 2 },
    },
    workingMemory: {
      enabled: true,
      template: `
## User Profile
- Name: {{name}}
- Preferences: {{preferences}}

## Active Tasks
{{tasks}}

## Context
{{context}}
      `,
    },
  },
});

const gateway = new Mastra({
  agents: {
    claw: clawAgent,           // Primary agent
    coder: coderAgent,         // Specialized coding agent
    researcher: researchAgent, // Web research agent
  },
  tools: {
    webSearch: webSearchTool,
    webFetch: webFetchTool,
    sendMessage: sendMessageTool,
    execBash: execBashTool,
    fileRead: fileReadTool,
    fileWrite: fileWriteTool,
    memorySearch: memorySearchTool,
  },
  memory: { default: memory },
  storage,
  vectors: { default: vectorStore },
});
```

**Key insight**: OpenClaw's Gateway is an imperative process that manages connections. Mastra's `Mastra` class is a declarative registry — you describe _what_ components exist and Mastra handles the wiring. This is a meaningful difference: Mastra's DI model means components discover each other through the registry rather than being manually wired.

---

## 2. Agent Runtime — `Agent` with Dynamic Instructions

OpenClaw's agent runtime uses bootstrap files (`USER.md`, `IDENTITY.md`, `SOUL.md`) injected into the workspace to configure behavior. Mastra's `Agent` supports dynamic instructions that can be resolved per-request, giving the same flexibility with stronger type safety.

```typescript
import { Agent } from '@mastra/core/agent';

const clawAgent = new Agent({
  id: 'claw',
  name: 'OpenClaw Agent',
  model: 'anthropic/claude-sonnet-4-20250514',

  // Dynamic instructions — resolved per-request, equivalent to OpenClaw's
  // USER.md + IDENTITY.md + SOUL.md bootstrap files
  instructions: async (requestContext) => {
    const channelId = requestContext?.channelId;
    const userId = requestContext?.userId;

    const identity = `You are Claw, an autonomous AI assistant.
You can execute tasks, search the web, manage files, and communicate
across messaging platforms.`;

    const channelRules = getChannelRules(channelId);
    const userProfile = await loadUserProfile(userId);

    return `${identity}

## Channel Rules
${channelRules}

## User Profile
${userProfile}

## Capabilities
- Execute shell commands and scripts
- Read, write, and edit files
- Search the web and fetch pages
- Send messages across channels
- Remember context across conversations`;
  },

  // Tools available to the agent — equivalent to OpenClaw's tool profiles
  tools: {
    webSearch: webSearchTool,
    webFetch: webFetchTool,
    sendMessage: sendMessageTool,
    execBash: execBashTool,
    fileRead: fileReadTool,
    fileWrite: fileWriteTool,
  },

  memory,
});
```

**What Mastra adds**: OpenClaw's bootstrap files are static markdown injected at startup. Mastra's `instructions` can be an async function receiving request context, meaning the agent's personality, rules, and knowledge can adapt per-channel, per-user, or per-session without restarting.

---

## 3. Tools System — `createTool()` with Type Safety

OpenClaw exposes tools across domains: file system, web, runtime, messaging, memory. Mastra's `createTool()` provides the same categorization with added benefits: Zod schema validation for inputs/outputs, suspend/resume for long-running operations, and approval workflows.

### File System Tools

```typescript
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';

const fileReadTool = createTool({
  id: 'file-read',
  description: 'Read a file from the workspace',
  inputSchema: z.object({
    path: z.string().describe('Relative path within the workspace'),
    encoding: z.enum(['utf-8', 'base64']).default('utf-8'),
  }),
  outputSchema: z.object({
    content: z.string(),
    size: z.number(),
  }),
  execute: async ({ path, encoding }, context) => {
    const workspace = context?.mastra?.getWorkspace();
    const fullPath = resolve(workspace?.root ?? '.', path);
    const content = await readFile(fullPath, encoding);
    return { content, size: content.length };
  },
});

const fileWriteTool = createTool({
  id: 'file-write',
  description: 'Write content to a file in the workspace',
  inputSchema: z.object({
    path: z.string(),
    content: z.string(),
    createDirs: z.boolean().default(true),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    bytesWritten: z.number(),
  }),
  // Require human approval for file writes — OpenClaw's device-pairing
  // approval model mapped to Mastra's tool approval primitive
  requireApproval: true,
  execute: async ({ path, content, createDirs }) => {
    await writeFile(path, content, 'utf-8');
    return { success: true, bytesWritten: content.length };
  },
});
```

### Shell Execution Tool (with Suspend/Resume)

```typescript
const execBashTool = createTool({
  id: 'exec-bash',
  description: 'Execute a shell command',
  inputSchema: z.object({
    command: z.string(),
    cwd: z.string().optional(),
    timeout: z.number().default(30000),
  }),
  outputSchema: z.object({
    stdout: z.string(),
    stderr: z.string(),
    exitCode: z.number(),
  }),
  // Suspend schema for long-running commands — the agent can check back later
  suspendSchema: z.object({
    pid: z.number(),
    reason: z.string(),
  }),
  resumeSchema: z.object({
    action: z.enum(['wait', 'kill', 'signal']),
    signal: z.string().optional(),
  }),
  requireApproval: true,
  execute: async ({ command, cwd, timeout }, context) => {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout,
      });
      return { stdout, stderr, exitCode: 0 };
    } catch (error: any) {
      return {
        stdout: error.stdout ?? '',
        stderr: error.stderr ?? error.message,
        exitCode: error.code ?? 1,
      };
    }
  },
});
```

### Web Tools

```typescript
const webSearchTool = createTool({
  id: 'web-search',
  description: 'Search the web for information',
  inputSchema: z.object({
    query: z.string(),
    numResults: z.number().default(5),
  }),
  outputSchema: z.object({
    results: z.array(z.object({
      title: z.string(),
      url: z.string(),
      snippet: z.string(),
    })),
  }),
  execute: async ({ query, numResults }) => {
    const response = await fetch(
      `https://api.search-provider.com/search?q=${encodeURIComponent(query)}&n=${numResults}`,
      { headers: { Authorization: `Bearer ${process.env.SEARCH_API_KEY}` } },
    );
    const data = await response.json();
    return { results: data.results };
  },
});

const webFetchTool = createTool({
  id: 'web-fetch',
  description: 'Fetch and extract content from a URL',
  inputSchema: z.object({
    url: z.string().url(),
    selector: z.string().optional().describe('CSS selector to extract specific content'),
  }),
  outputSchema: z.object({
    content: z.string(),
    title: z.string().optional(),
    statusCode: z.number(),
  }),
  execute: async ({ url, selector }) => {
    const response = await fetch(url);
    const html = await response.text();
    // Content extraction logic here
    return {
      content: extractText(html, selector),
      title: extractTitle(html),
      statusCode: response.status,
    };
  },
});
```

### Tool Profiles (Allow/Deny Policies)

OpenClaw supports tool profiles (`full`, `messaging`, `coding`, `minimal`) that control which tools an agent can access. In Mastra, this maps naturally to dynamic tool resolution:

```typescript
type ToolProfile = 'full' | 'messaging' | 'coding' | 'minimal';

const TOOL_PROFILES: Record<ToolProfile, string[]> = {
  full: ['file-read', 'file-write', 'exec-bash', 'web-search', 'web-fetch', 'send-message'],
  messaging: ['send-message', 'web-search'],
  coding: ['file-read', 'file-write', 'exec-bash', 'web-search'],
  minimal: ['web-search'],
};

const profiledAgent = new Agent({
  id: 'profiled-claw',
  name: 'Profiled Agent',
  model: 'anthropic/claude-sonnet-4-20250514',
  instructions: 'You are an assistant with role-based tool access.',

  // Dynamic tools — resolved per-request based on channel or user role
  tools: async (requestContext) => {
    const profile = requestContext?.toolProfile ?? 'minimal';
    const allowed = TOOL_PROFILES[profile];
    const allTools = { webSearch: webSearchTool, fileRead: fileReadTool, /* ... */ };

    return Object.fromEntries(
      Object.entries(allTools).filter(([_, tool]) => allowed.includes(tool.id))
    );
  },
});
```

---

## 4. Memory System — Thread-Based Conversations with Semantic Recall

OpenClaw stores session transcripts as JSONL files and provides `memory_search` / `memory_get` tools. Mastra's memory system is significantly more structured: thread-based conversations, semantic recall via vector embeddings, and working memory for structured state that persists across turns.

```typescript
import { Memory } from '@mastra/memory';

const memory = new Memory({
  options: {
    // Keep last 40 messages in context (OpenClaw default is similar)
    lastMessages: 40,

    // Semantic recall — when the agent needs context beyond the recent window,
    // it searches the vector store for semantically relevant past messages
    semanticRecall: {
      topK: 5,
      messageRange: { before: 2, after: 2 },
    },

    // Working memory — structured state that persists across turns.
    // This replaces OpenClaw's workspace-level state files.
    workingMemory: {
      enabled: true,
      template: `
## Current Task
- Description: {{taskDescription}}
- Status: {{taskStatus}}
- Steps completed: {{stepsCompleted}}

## User Preferences
- Language: {{language}}
- Timezone: {{timezone}}
- Notification channel: {{notificationChannel}}

## Session State
- Active channel: {{activeChannel}}
- Queue mode: {{queueMode}}
      `,
    },
  },
});
```

### Session Management via Threads

OpenClaw's session concept maps directly to Mastra's threads. Each conversation session is a thread, and threads can be associated with resources (users, channels):

```typescript
async function handleIncomingMessage(channelId: string, userId: string, message: string) {
  const agent = gateway.getAgent('claw');
  const threadId = `${channelId}:${userId}`;
  const resourceId = userId;

  const response = await agent.generate({
    prompt: message,
    threadId,
    resourceId,
    requestContext: {
      channelId,
      userId,
      toolProfile: getToolProfile(channelId),
    },
  });

  return response.text;
}
```

**What Mastra adds over OpenClaw's memory**:

1. **Semantic recall** — OpenClaw's `memory_search` is a tool the agent must explicitly call. Mastra's semantic recall is automatic: relevant past context is injected into the prompt via input processors without the agent needing to "decide" to search memory.

2. **Working memory** — Structured state (as opposed to raw conversation history) that the LLM maintains across turns. This replaces the ad-hoc state management OpenClaw does via workspace files.

3. **Resource scoping** — Memory can be scoped to a user across threads, not just per-session. A user's preferences and context carry across channels.

---

## 5. Multi-Channel Messaging — Processors and Channel Tools

OpenClaw's multi-channel gateway routes messages across WhatsApp, Telegram, Discord, Slack, and more. In Mastra, this can be modeled as a combination of:

1. **Input/Output Processors** — Transform messages between channel-specific formats and the agent's internal format
2. **Channel-specific tools** — Let the agent send messages back through specific channels
3. **A routing layer** — HTTP endpoints or webhooks that receive channel events

### Channel Abstraction

```typescript
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

interface ChannelAdapter {
  id: string;
  sendMessage(to: string, content: string, options?: Record<string, unknown>): Promise<void>;
  formatIncoming(raw: unknown): { text: string; from: string; metadata: Record<string, unknown> };
}

// Channel registry — analogous to OpenClaw's channel configuration
const channels: Record<string, ChannelAdapter> = {};

function registerChannel(adapter: ChannelAdapter) {
  channels[adapter.id] = adapter;
}

// Telegram adapter
registerChannel({
  id: 'telegram',
  async sendMessage(chatId, content) {
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: content }),
    });
  },
  formatIncoming(raw: any) {
    return {
      text: raw.message?.text ?? '',
      from: String(raw.message?.chat?.id),
      metadata: { messageId: raw.message?.message_id },
    };
  },
});

// Discord adapter
registerChannel({
  id: 'discord',
  async sendMessage(channelId, content) {
    await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    });
  },
  formatIncoming(raw: any) {
    return {
      text: raw.content ?? '',
      from: raw.channel_id,
      metadata: { author: raw.author?.id },
    };
  },
});

// Generic send-message tool that the agent can use to respond on any channel
const sendMessageTool = createTool({
  id: 'send-message',
  description: 'Send a message to a user on a specific channel',
  inputSchema: z.object({
    channel: z.string().describe('Channel ID (telegram, discord, slack, etc.)'),
    to: z.string().describe('Recipient identifier'),
    content: z.string().describe('Message content'),
  }),
  outputSchema: z.object({ sent: z.boolean() }),
  execute: async ({ channel, to, content }) => {
    const adapter = channels[channel];
    if (!adapter) throw new Error(`Unknown channel: ${channel}`);
    await adapter.sendMessage(to, content);
    return { sent: true };
  },
});
```

### Message Routing via Server Endpoints

```typescript
import { registerApiRoute } from '@mastra/server';

// Webhook endpoint for Telegram
const telegramWebhook = registerApiRoute('/webhooks/telegram', {
  method: 'POST',
  requiresAuth: false,
  handler: async (c) => {
    const mastra = c.get('mastra');
    const body = await c.req.json();
    const channel = channels['telegram'];
    const { text, from, metadata } = channel.formatIncoming(body);

    const agent = mastra.getAgent('claw');
    const threadId = `telegram:${from}`;

    const response = await agent.generate({
      prompt: text,
      threadId,
      resourceId: from,
      requestContext: {
        channelId: 'telegram',
        userId: from,
        toolProfile: 'messaging',
      },
    });

    await channel.sendMessage(from, response.text);
    return c.json({ ok: true });
  },
});

// Webhook endpoint for Discord
const discordWebhook = registerApiRoute('/webhooks/discord', {
  method: 'POST',
  requiresAuth: false,
  handler: async (c) => {
    const mastra = c.get('mastra');
    const body = await c.req.json();
    const channel = channels['discord'];
    const { text, from, metadata } = channel.formatIncoming(body);

    const agent = mastra.getAgent('claw');
    const threadId = `discord:${from}`;

    const response = await agent.generate({
      prompt: text,
      threadId,
      resourceId: metadata.author,
      requestContext: {
        channelId: 'discord',
        userId: metadata.author,
        toolProfile: 'full',
      },
    });

    await channel.sendMessage(from, response.text);
    return c.json({ ok: true });
  },
});
```

### Message Debouncing and Queueing

OpenClaw debounces rapid consecutive messages and supports queue modes (`steer`, `followup`, `collect`). This is a domain-specific concern that Mastra doesn't directly provide, but it can be built with workflows:

```typescript
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';

const debounceStep = createStep({
  id: 'debounce-messages',
  inputSchema: z.object({
    channelId: z.string(),
    userId: z.string(),
    message: z.string(),
    debounceMs: z.number().default(1500),
  }),
  outputSchema: z.object({
    combinedMessage: z.string(),
    messageCount: z.number(),
  }),
  execute: async ({ channelId, userId, message, debounceMs }, context) => {
    // Collect messages within the debounce window
    const messages = [message];
    // In practice, this would use a queue/buffer keyed by userId
    await new Promise(resolve => setTimeout(resolve, debounceMs));
    // Drain any additional messages that arrived
    const additional = await drainMessageBuffer(channelId, userId);
    messages.push(...additional);

    return {
      combinedMessage: messages.join('\n'),
      messageCount: messages.length,
    };
  },
});

const processMessageStep = createStep(clawAgent, {
  structuredOutput: { schema: z.object({ text: z.string() }) },
});

const messageWorkflow = createWorkflow({
  id: 'process-channel-message',
  inputSchema: z.object({
    channelId: z.string(),
    userId: z.string(),
    message: z.string(),
    debounceMs: z.number().default(1500),
  }),
  outputSchema: z.object({ text: z.string() }),
})
  .then(debounceStep)
  .then(processMessageStep)
  .commit();
```

---

## 6. Plugins and Skills — MCP Servers as the Extension Model

OpenClaw's plugin system lets third parties register additional tools. This maps directly to Mastra's MCP (Model Context Protocol) integration, which provides a standardized way to expose and consume tool collections.

### Consuming External Tool Providers (MCP Client)

```typescript
import { MastraMCPClient } from '@mastra/mcp';

// Equivalent to OpenClaw's plugin installation
const mcpTools = new MastraMCPClient({
  servers: {
    // A file-system plugin
    filesystem: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/workspace'],
    },
    // A browser automation plugin
    browser: {
      command: 'npx',
      args: ['-y', '@anthropic/mcp-server-puppeteer'],
    },
    // A remote plugin via HTTP
    customPlugin: {
      url: new URL('https://my-plugin-server.example.com/mcp'),
    },
  },
});

const gateway = new Mastra({
  agents: {
    claw: new Agent({
      id: 'claw',
      name: 'Claw',
      model: 'anthropic/claude-sonnet-4-20250514',
      instructions: 'You are an autonomous assistant with access to plugins.',
      // MCP tools are automatically available to the agent
      tools: async () => ({
        ...await mcpTools.getTools(),
        sendMessage: sendMessageTool,
      }),
    }),
  },
});
```

### Exposing Mastra Agents as MCP Servers

The inverse is also possible — expose your Mastra agents and tools as an MCP server that other systems can consume:

```typescript
import { MCPServer } from '@mastra/mcp';

const mcpServer = new MCPServer({
  name: 'openclaw-server',
  version: '1.0.0',
  tools: {
    webSearch: webSearchTool,
    fileRead: fileReadTool,
    sendMessage: sendMessageTool,
  },
  agents: {
    claw: clawAgent,
    coder: coderAgent,
  },
});

// Expose via stdio (for local tool use) or HTTP (for remote)
await mcpServer.startHTTP({ port: 3001 });
```

**Key insight**: OpenClaw's plugin system is proprietary — plugins must be written to OpenClaw's API. Mastra's MCP integration uses an open standard, meaning any MCP-compatible tool server works without adaptation. This is a significant advantage for ecosystem compatibility.

---

## 7. Multi-Agent Delegation — Supervisor and Network Patterns

OpenClaw supports a single agent runtime with node-based delegation. Mastra provides two built-in multi-agent patterns that are more structured:

### Supervisor Pattern (Hierarchical Delegation)

```typescript
const coderAgent = new Agent({
  id: 'coder',
  name: 'Coding Agent',
  model: 'anthropic/claude-sonnet-4-20250514',
  instructions: 'You are a coding specialist. Write, debug, and refactor code.',
  tools: { fileRead: fileReadTool, fileWrite: fileWriteTool, execBash: execBashTool },
});

const researchAgent = new Agent({
  id: 'researcher',
  name: 'Research Agent',
  model: 'openai/gpt-4o',
  instructions: 'You research topics on the web and synthesize information.',
  tools: { webSearch: webSearchTool, webFetch: webFetchTool },
});

// Supervisor agent that delegates to specialists
const clawAgent = new Agent({
  id: 'claw',
  name: 'Claw Supervisor',
  model: 'anthropic/claude-sonnet-4-20250514',
  instructions: `You are the primary assistant. Delegate tasks to specialists:
- Use the "coder" agent for coding tasks
- Use the "researcher" agent for web research
- Handle messaging and general queries yourself.`,
  tools: { sendMessage: sendMessageTool },
  agents: { coder: coderAgent, researcher: researchAgent },

  // Control what context flows to sub-agents
  onDelegationStart: async ({ delegatedAgent, messages }) => {
    return {
      messages: messages.slice(-10), // Only send last 10 messages for context
    };
  },

  onDelegationComplete: async ({ delegatedAgent, result }) => {
    console.log(`${delegatedAgent.id} completed task`);
    return result;
  },
});
```

### Network Pattern (Dynamic Routing)

```typescript
const response = await clawAgent.network({
  prompt: 'Research the latest TypeScript features and create a summary file',
  agents: { coder: coderAgent, researcher: researchAgent },
  // The routing agent decides which agent handles each sub-task
  isTaskComplete: [completionScorer],
  maxIterations: 10,
});
```

---

## 8. Workflow Orchestration — Step-Based Execution

OpenClaw supports multi-step automation workflows. Mastra's workflow system is significantly more capable, with type-safe step chaining, conditional branching, parallel execution, and suspend/resume:

```typescript
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';

// A workflow that automates a common OpenClaw use case:
// research a topic, generate a report, and notify the user

const researchStep = createStep(researchAgent, {
  structuredOutput: {
    schema: z.object({
      findings: z.array(z.object({
        source: z.string(),
        summary: z.string(),
      })),
    }),
  },
});

const generateReportStep = createStep({
  id: 'generate-report',
  inputSchema: z.object({
    findings: z.array(z.object({
      source: z.string(),
      summary: z.string(),
    })),
  }),
  outputSchema: z.object({
    report: z.string(),
    filePath: z.string(),
  }),
  execute: async ({ findings }) => {
    const report = findings
      .map(f => `## ${f.source}\n${f.summary}`)
      .join('\n\n');

    const filePath = `/workspace/reports/report-${Date.now()}.md`;
    await writeFile(filePath, report, 'utf-8');

    return { report, filePath };
  },
});

const notifyStep = createStep({
  id: 'notify-user',
  inputSchema: z.object({
    report: z.string(),
    filePath: z.string(),
  }),
  outputSchema: z.object({ notified: z.boolean() }),
  execute: async ({ report, filePath }, context) => {
    const channel = context?.requestContext?.channelId ?? 'telegram';
    const userId = context?.requestContext?.userId;
    if (userId) {
      await channels[channel].sendMessage(userId, `Report ready: ${filePath}`);
    }
    return { notified: true };
  },
});

const researchWorkflow = createWorkflow({
  id: 'research-and-report',
  inputSchema: z.object({
    prompt: z.string().describe('Research topic'),
  }),
  outputSchema: z.object({ notified: z.boolean() }),
})
  .then(researchStep)
  .then(generateReportStep)
  .then(notifyStep)
  .commit();
```

### Suspend/Resume for Human-in-the-Loop

OpenClaw's approval workflows map to Mastra's suspend/resume primitive:

```typescript
const deployStep = createStep({
  id: 'deploy-code',
  inputSchema: z.object({ artifact: z.string() }),
  outputSchema: z.object({ deployed: z.boolean(), url: z.string() }),
  suspendSchema: z.object({
    artifact: z.string(),
    reason: z.string(),
  }),
  resumeSchema: z.object({
    approved: z.boolean(),
    notes: z.string().optional(),
  }),
  execute: async ({ artifact }, { suspend, resumeData }) => {
    if (!resumeData) {
      // First execution — suspend and wait for approval
      return suspend({
        artifact,
        reason: 'Deployment requires manual approval',
      });
    }

    if (!resumeData.approved) {
      return { deployed: false, url: '' };
    }

    const url = await performDeployment(artifact);
    return { deployed: true, url };
  },
});
```

---

## 9. Putting It All Together

Here's what the full `Mastra`-based OpenClaw looks like as a composition of primitives:

```typescript
import { Mastra } from '@mastra/core';
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { MastraMCPClient } from '@mastra/mcp';
import { HonoServer } from '@mastra/server/hono';

// --- Storage ---
const storage = new LibSQLStore({
  id: 'openclaw',
  url: process.env.DATABASE_URL!,
});

// --- Memory ---
const memory = new Memory({
  options: {
    lastMessages: 40,
    semanticRecall: { topK: 5 },
    workingMemory: { enabled: true, template: '...' },
  },
});

// --- MCP Plugins ---
const plugins = new MastraMCPClient({
  servers: {
    filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/workspace'] },
    browser: { command: 'npx', args: ['-y', '@anthropic/mcp-server-puppeteer'] },
  },
});

// --- Specialist Agents ---
const coderAgent = new Agent({
  id: 'coder',
  name: 'Coder',
  model: 'anthropic/claude-sonnet-4-20250514',
  instructions: 'You write, debug, and refactor code.',
  tools: { fileRead: fileReadTool, fileWrite: fileWriteTool, execBash: execBashTool },
  memory,
});

const researchAgent = new Agent({
  id: 'researcher',
  name: 'Researcher',
  model: 'openai/gpt-4o',
  instructions: 'You research topics and synthesize findings.',
  tools: { webSearch: webSearchTool, webFetch: webFetchTool },
  memory,
});

// --- Primary Agent (Supervisor) ---
const clawAgent = new Agent({
  id: 'claw',
  name: 'Claw',
  model: 'anthropic/claude-sonnet-4-20250514',
  instructions: async (ctx) => {
    const channelRules = getChannelRules(ctx?.channelId);
    return `You are Claw, an autonomous AI assistant.
Delegate coding tasks to "coder" and research to "researcher".
${channelRules}`;
  },
  tools: async () => ({
    sendMessage: sendMessageTool,
    ...await plugins.getTools(),
  }),
  agents: { coder: coderAgent, researcher: researchAgent },
  memory,
});

// --- Gateway ---
const gateway = new Mastra({
  agents: { claw: clawAgent, coder: coderAgent, researcher: researchAgent },
  workflows: { researchAndReport: researchWorkflow },
  storage,
  memory: { default: memory },
});

// --- Server ---
const server = new HonoServer({
  mastra: gateway,
  customApiRoutes: [telegramWebhook, discordWebhook],
});
```

---

## 10. Analysis: Strengths and Gaps

### Where Mastra Primitives Excel

| Area | Advantage |
|---|---|
| **Type safety** | Zod schemas on every tool, workflow step, and agent output. OpenClaw has no schema validation. |
| **Memory architecture** | Semantic recall, working memory templates, resource-scoped state. Far more structured than OpenClaw's JSONL transcripts. |
| **Multi-agent patterns** | Built-in supervisor and network orchestration with delegation hooks. OpenClaw's delegation is ad-hoc. |
| **Workflow engine** | Type-safe step chaining, parallel execution, suspend/resume, conditional branching. OpenClaw has basic YAML workflows. |
| **Tool extensibility** | MCP standard means any MCP-compatible server works. OpenClaw's plugin API is proprietary. |
| **Observability** | OpenTelemetry integration for tracing across agents, tools, and workflows. |
| **Approval workflows** | First-class `requireApproval` and `suspend/resume` on tools and workflow steps. |

### Gaps to Fill

| Area | Gap | Mitigation |
|---|---|---|
| **Channel gateway** | Mastra has no built-in messaging channel adapters (WhatsApp, Telegram, etc.) | Build as custom API routes + channel adapter registry (shown above) |
| **Message debouncing** | No built-in message batching/debouncing for rapid-fire messages | Implement as a workflow step or middleware |
| **Long-lived connections** | Mastra's server model is request/response; OpenClaw maintains persistent WebSocket connections | Use Hono's WebSocket support or a separate WebSocket process |
| **Device pairing** | OpenClaw's WhatsApp/Signal pairing flow is channel-specific | Channel adapters would handle this per-channel |
| **Cron scheduling** | No built-in cron; OpenClaw has a `cron` tool | Use external scheduler (node-cron) calling workflow endpoints |
| **Queue modes** | OpenClaw's interrupt/steer/followup/collect modes for concurrent messages | Build as stateful middleware with storage-backed queues |

### Architectural Differences Worth Noting

1. **Declarative vs. Imperative**: Mastra is declarative (register components, let the framework wire them). OpenClaw is imperative (a running process that manages connections). Mastra's model is better for deployment flexibility (serverless, containers, etc.) but means you need to build the "always-on" gateway layer yourself.

2. **Single Agent vs. Multi-Agent**: OpenClaw runs a single embedded agent with node-based delegation. Mastra's multi-agent patterns (supervisor, network) are more structured and provide better control over delegation, message filtering, and task completion detection.

3. **Memory Model**: OpenClaw's memory is file-based (JSONL transcripts + workspace files). Mastra's memory is database-backed with semantic search, working memory templates, and resource scoping. This is a substantial improvement for production use.

4. **Extension Model**: OpenClaw's plugin system has had security issues (400+ malicious plugins discovered). Mastra's MCP integration uses a standard protocol with better isolation guarantees.

---

## Conclusion

Building OpenClaw with Mastra primitives is not just feasible — it's architecturally cleaner. The core agent runtime, tools, memory, and multi-agent orchestration map directly to Mastra primitives with stronger type safety and more structured patterns. The main work would be building the channel gateway layer (messaging adapters, webhook routing, message debouncing) as application code on top of Mastra's server and workflow primitives.

The resulting system would be:
- **More type-safe** — Zod schemas everywhere vs. no validation
- **More extensible** — MCP standard vs. proprietary plugins
- **Better memory** — Semantic recall + working memory vs. JSONL files
- **More observable** — OpenTelemetry tracing vs. log files
- **More flexible deployment** — Serverless, containers, or long-lived process vs. long-lived only
