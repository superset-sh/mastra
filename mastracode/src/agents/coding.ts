import { Agent } from "@mastra/core/agent";
import type { McpManager } from "../mcp";
import { getDynamicInstructions } from "./instructions";
import { getDynamicModel } from "./model";
import { createDynamicTools } from "./tools";

export function createCodingAgent(mcpManager?: McpManager) {
    return new Agent({
        id: 'code-agent',
        name: 'Obi',
        instructions: getDynamicInstructions,
        model: getDynamicModel,
        tools: createDynamicTools(mcpManager),
    });
}
