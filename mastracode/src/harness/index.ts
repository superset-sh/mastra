import { Harness, taskCheckTool, taskWriteTool } from "@mastra/core/harness";
import type { HarnessMode, HarnessSubagent, HeartbeatHandler } from "@mastra/core/harness";
import { createCodingAgent } from "../agents/coding";
import { getDynamicMemory } from "../agents/memory";
import { executeSubagent } from "../agents/subagents/execute";
import { exploreSubagent } from "../agents/subagents/explore";
import { planSubagent } from "../agents/subagents/plan";
import { getDynamicWorkspace } from "../agents/workspace";
import { PROVIDER_TO_OAUTH_ID } from "../auth";
import type { AuthStorage } from "../auth";
import { HookManager } from "../hooks";
import { createMcpManager } from "../mcp";
import { loadSettings } from "../onboarding";
import { getToolCategory } from "../permissions";
import { stateSchema } from "../schema";
import { createExecuteCommandTool, createGlobTool, createGrepTool, createViewTool, createWriteFileTool, stringReplaceLspTool } from "../tools";
import { mastra } from "../tui/theme";
import type { MastraCodeConfig } from "../types";
import { syncGateways } from "../utils/gateway-sync";
import { detectProject, getResourceIdOverride, getStorageConfig } from "../utils/project";
import { createStorage } from "../utils/storage-factory";
import { acquireThreadLock, releaseThreadLock } from "../utils/thread-lock";
import { buildStartupAccess } from "./startup";


export async function createHarness({ authStorage, config }: { authStorage: AuthStorage, config: MastraCodeConfig }) {
    const cwd = config?.cwd ?? process.cwd();
    const project = detectProject(cwd);

    const resourceIdOverride = getResourceIdOverride(project.rootPath);
    if (resourceIdOverride) {
        project.resourceId = resourceIdOverride;
        project.resourceIdOverride = true;
    }

    // Load global settings to resolve storage preferences (needed before storage creation)
    const globalSettings = loadSettings();

    // Build subagent definitions with project-scoped tools
    const viewTool = createViewTool(project.rootPath);
    const grepTool = createGrepTool(project.rootPath);
    const globTool = createGlobTool(project.rootPath);


    const executeCommandTool = createExecuteCommandTool(project.rootPath);
    const writeFileTool = createWriteFileTool(project.rootPath);

    const readOnlyTools = {
        view: viewTool,
        search_content: grepTool,
        find_files: globTool,
    };

    // MCP
    const mcpManager = config?.disableMcp ? undefined : createMcpManager(project.rootPath);

    const defaultSubagents: HarnessSubagent[] = [
        {
            id: exploreSubagent.id,
            name: exploreSubagent.name,
            description:
                "Read-only codebase exploration. Use for questions like 'find all usages of X', 'how does module Y work'.",
            instructions: exploreSubagent.instructions,
            tools: readOnlyTools,
        },
        {
            id: planSubagent.id,
            name: planSubagent.name,
            description:
                "Read-only analysis and planning. Use for 'create an implementation plan for X', 'analyze the architecture of Y'.",
            instructions: planSubagent.instructions,
            tools: readOnlyTools,
        },
        {
            id: executeSubagent.id,
            name: executeSubagent.name,
            description:
                "Task execution with write capabilities. Use for 'implement feature X', 'fix bug Y', 'refactor module Z'.",
            instructions: executeSubagent.instructions,
            tools: {
                ...readOnlyTools,
                string_replace_lsp: stringReplaceLspTool,
                write_file: writeFileTool,
                execute_command: executeCommandTool,
                task_write: taskWriteTool,
                task_check: taskCheckTool,
            },
        },
    ];

    const codeAgentInstance = createCodingAgent(mcpManager);

    const defaultModes: HarnessMode[] = [
        {
            id: 'build',
            name: 'Build',
            default: true,
            defaultModelId: 'anthropic/claude-opus-4-6',
            color: mastra.purple,
            agent: codeAgentInstance,
        },
        {
            id: 'plan',
            name: 'Plan',
            defaultModelId: 'openai/gpt-5.2-codex',
            color: mastra.blue,
            agent: codeAgentInstance,
        },
        {
            id: 'fast',
            name: 'Fast',
            defaultModelId: 'cerebras/zai-glm-4.7',
            color: mastra.green,
            agent: codeAgentInstance,
        },
    ];

    const defaultHeartbeatHandlers: HeartbeatHandler[] = [
        {
            id: 'gateway-sync',
            intervalMs: 5 * 60 * 1000,
            handler: () => syncGateways(),
        },
    ];

    const { effectiveOmModel, effectiveDefaults } = buildStartupAccess({ authStorage });


    // Build initial state with global preferences
    const globalInitialState: Record<string, unknown> = {};
    if (effectiveOmModel) {
        globalInitialState.observerModelId = effectiveOmModel;
        globalInitialState.reflectorModelId = effectiveOmModel;
    }
    if (globalSettings.preferences.yolo !== null) {
        globalInitialState.yolo = globalSettings.preferences.yolo;
    }
    // Seed subagent models from global settings
    for (const [key, modelId] of Object.entries(globalSettings.models.subagentModels)) {
        if (key === '_default') {
            globalInitialState.subagentModelId = modelId;
        } else {
            globalInitialState[`subagentModelId_${key}`] = modelId;
        }
    }

    // Apply resolved model defaults to modes
    const modes = (config?.modes ?? defaultModes).map(mode => {
        const savedModel = effectiveDefaults[mode.id];
        return savedModel ? { ...mode, defaultModelId: savedModel } : mode;
    });

    // Map subagent types to mode models: explore→fast, plan→plan, execute→build
    const subagentModeMap: Record<string, string> = { explore: 'fast', plan: 'plan', execute: 'build' };

    const subagents = (config?.subagents ?? defaultSubagents).map(sa => {
        const modeId = subagentModeMap[sa.id];
        const model = modeId ? effectiveDefaults[modeId] : undefined;
        return model ? { ...sa, defaultModelId: model } : sa;
    });

    // Storage
    const storageConfig = config?.storage ?? getStorageConfig(project.rootPath, globalSettings.storage);
    const storageResult = await createStorage(storageConfig);
    const storage = storageResult.storage;
    const storageWarning = storageResult.warning;

    const memory = getDynamicMemory(storage);

    const harness = new Harness({
        id: 'mastra-code',
        resourceId: project.resourceId,
        memory,
        stateSchema,
        subagents,
        toolCategoryResolver: getToolCategory,
        initialState: {
            projectPath: project.rootPath,
            projectName: project.name,
            gitBranch: project.gitBranch,
            yolo: true,
            ...globalInitialState,
            ...config?.initialState,
        },
        workspace: getDynamicWorkspace,
        modes,
        heartbeatHandlers: config?.heartbeatHandlers ?? defaultHeartbeatHandlers,
        modelAuthChecker: provider => {
            const oauthId = PROVIDER_TO_OAUTH_ID[provider];
            if (oauthId && authStorage.isLoggedIn(oauthId)) {
                return true;
            }
            return undefined;
        },
        modelUseCountProvider: () => loadSettings().modelUseCounts,
        threadLock: {
            acquire: acquireThreadLock,
            release: releaseThreadLock,
        },
    });

    // Hooks
    const hookManager = config?.disableHooks ? undefined : new HookManager(project.rootPath, 'session-init');

    if (hookManager?.hasHooks()) {
        const hookConfig = hookManager.getConfig();
        const hookCount = Object.values(hookConfig).reduce((sum, hooks) => sum + (hooks?.length ?? 0), 0);
        console.info(`Hooks: ${hookCount} hook(s) configured`);
    }

    return {
        harness,
        storageWarning,
        storage,
        codingAgent: codeAgentInstance,
        mcpManager,
        hookManager,
    };
}