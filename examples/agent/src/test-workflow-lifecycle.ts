/**
 * Integration test for the workflow file management, compilation, and publishing lifecycle.
 *
 * This exercises the full round-trip:
 *   1. Create workflow TypeScript files on disk
 *   2. Compile them with esbuild → ESM .mjs
 *   3. Dynamically import and get a live Workflow instance
 *   4. Register on a Mastra instance and execute
 *   5. Publish source to blob store
 *   6. Destroy local files
 *   7. Restore from blob store
 *   8. Re-compile, re-register, re-execute
 *
 * Run: npx tsx src/test-workflow-lifecycle.ts
 */

import { createRequire } from 'node:module';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Mastra } from '@mastra/core';
import { InMemoryBlobStore } from '@mastra/core/storage';
import {
  WorkflowFileManager,
  WorkflowCompiler,
  publishWorkflow,
  restoreWorkflow,
  type EsbuildLike,
} from '@mastra/core/workspace';

// Resolve esbuild from @mastra/core's devDependencies
const require = createRequire(import.meta.url);
const esbuild = require('esbuild') as EsbuildLike;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Test Workflow Files ────────────────────────────────────────────

const WORKFLOW_NAME = 'dynamic-add-numbers';

function getWorkflowFiles() {
  return [
    {
      path: 'steps/add.ts',
      content: `
import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';

export const addStep = createStep({
  id: 'add-step',
  inputSchema: z.object({
    a: z.number(),
    b: z.number(),
  }),
  outputSchema: z.object({
    sum: z.number(),
  }),
  execute: async ({ inputData }) => {
    return { sum: inputData.a + inputData.b };
  },
});
`,
    },
    {
      path: 'steps/multiply.ts',
      content: `
import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';

export const multiplyStep = createStep({
  id: 'multiply-step',
  inputSchema: z.object({
    sum: z.number(),
  }),
  outputSchema: z.object({
    result: z.number(),
  }),
  execute: async ({ inputData }) => {
    return { result: inputData.sum * 10 };
  },
});
`,
    },
    {
      path: 'index.ts',
      content: `
import { createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { addStep } from './steps/add';
import { multiplyStep } from './steps/multiply';

export const workflow = createWorkflow({
  id: 'dynamic-math-workflow',
  inputSchema: z.object({
    a: z.number(),
    b: z.number(),
  }),
  outputSchema: z.object({
    result: z.number(),
  }),
})
  .then(addStep)
  .then(multiplyStep)
  .commit();
`,
    },
  ];
}

// ─── Helpers ────────────────────────────────────────────────────────

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function log(phase: string, message: string) {
  console.log(`[${phase}] ${message}`);
}

// ─── Main Test ──────────────────────────────────────────────────────

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const workflowsDir = path.join(projectRoot, '.mastra', 'dynamic-workflows');

  // Clean up from any previous run
  await fs.rm(workflowsDir, { recursive: true, force: true });

  const fileManager = new WorkflowFileManager({ basePath: workflowsDir });
  const compiler = new WorkflowCompiler({
    workflowsBasePath: workflowsDir,
    esbuild,
  });
  const blobStore = new InMemoryBlobStore();
  await blobStore.init();

  try {
    // ─── Phase 1: Create workflow files ───────────────────────────
    log('CREATE', 'Writing workflow files to disk...');
    await fileManager.createWorkflow(WORKFLOW_NAME, getWorkflowFiles());

    const exists = await fileManager.workflowExists(WORKFLOW_NAME);
    assert(exists, 'Workflow directory should exist after creation');

    const files = await fileManager.listFiles(WORKFLOW_NAME);
    log('CREATE', `Created ${files.length} files: ${files.join(', ')}`);
    assert(files.length === 3, `Expected 3 files, got ${files.length}`);
    assert(files.includes('index.ts'), 'Should include index.ts');
    assert(files.includes('steps/add.ts'), 'Should include steps/add.ts');
    assert(files.includes('steps/multiply.ts'), 'Should include steps/multiply.ts');

    // ─── Phase 2: Compile ─────────────────────────────────────────
    log('COMPILE', 'Compiling workflow with esbuild...');
    const { workflow, outputPath } = await compiler.compile(WORKFLOW_NAME);

    log('COMPILE', `Compiled to: ${outputPath}`);
    log('COMPILE', `Workflow ID: ${workflow.id}`);
    assert(workflow.id === 'dynamic-math-workflow', `Expected id 'dynamic-math-workflow', got '${workflow.id}'`);
    assert(typeof workflow.createRun === 'function', 'Workflow should have createRun method');
    assert(typeof workflow.then === 'function', 'Workflow should have then method');

    // ─── Phase 3: Register and execute on Mastra ──────────────────
    log('EXECUTE', 'Creating Mastra instance and registering workflow...');
    const mastra = new Mastra({});

    mastra.addWorkflow(workflow);

    // Verify it's registered
    const retrieved = mastra.getWorkflow('dynamic-math-workflow' as any);
    assert(retrieved !== undefined, 'Workflow should be retrievable from Mastra');
    assert(retrieved.id === 'dynamic-math-workflow', 'Retrieved workflow should have correct ID');

    log('EXECUTE', 'Executing workflow with input { a: 5, b: 7 }...');
    const run = await workflow.createRun();
    const result = await run.start({ inputData: { a: 5, b: 7 } });

    log('EXECUTE', `Result status: ${result.status}`);
    if (result.status === 'success') {
      log('EXECUTE', `Result: ${JSON.stringify(result.result)}`);
      assert((result.result as any).result === 120, `Expected result 120 ((5+7)*10), got ${(result.result as any).result}`);
    } else {
      throw new Error(`Workflow execution failed with status: ${result.status}, details: ${JSON.stringify(result)}`);
    }

    // Verify it's listed
    const allWorkflows = mastra.listWorkflows();
    assert('dynamic-math-workflow' in allWorkflows, 'Workflow should appear in listWorkflows');
    log('EXECUTE', 'Workflow execution succeeded!');

    // ─── Phase 4: Publish to blob store ───────────────────────────
    log('PUBLISH', 'Publishing workflow source to blob store...');
    const workflowDir = fileManager.getWorkflowDir(WORKFLOW_NAME);
    const publishResult = await publishWorkflow(workflowDir, blobStore);

    log('PUBLISH', `Published ${Object.keys(publishResult.tree.entries).length} files to blob store`);
    log('PUBLISH', `Blobs stored: ${publishResult.blobs.length}`);
    assert(Object.keys(publishResult.tree.entries).length === 3, 'Should publish 3 files');
    assert(publishResult.tree.entries['index.ts'] !== undefined, 'Tree should contain index.ts');
    assert(publishResult.tree.entries['steps/add.ts'] !== undefined, 'Tree should contain steps/add.ts');
    assert(publishResult.tree.entries['steps/multiply.ts'] !== undefined, 'Tree should contain steps/multiply.ts');

    // Verify all blobs are in the store
    for (const entry of Object.values(publishResult.tree.entries)) {
      const hasBlob = await blobStore.has(entry.blobHash);
      assert(hasBlob, `Blob ${entry.blobHash} should be in the store`);
    }

    // ─── Phase 5: Destroy local files ─────────────────────────────
    log('DESTROY', 'Removing local workflow files and compiled output...');
    await fileManager.deleteWorkflow(WORKFLOW_NAME);
    await compiler.clean(WORKFLOW_NAME);

    const existsAfterDelete = await fileManager.workflowExists(WORKFLOW_NAME);
    assert(!existsAfterDelete, 'Workflow should not exist after deletion');
    log('DESTROY', 'Local files destroyed.');

    // ─── Phase 6: Restore from blob store ─────────────────────────
    log('RESTORE', 'Restoring workflow from blob store...');
    const restoreDir = fileManager.getWorkflowDir(WORKFLOW_NAME);
    await restoreWorkflow(publishResult.tree, blobStore, restoreDir);

    const existsAfterRestore = await fileManager.workflowExists(WORKFLOW_NAME);
    assert(existsAfterRestore, 'Workflow should exist after restore');

    const restoredFiles = await fileManager.listFiles(WORKFLOW_NAME);
    log('RESTORE', `Restored ${restoredFiles.length} files: ${restoredFiles.join(', ')}`);
    assert(restoredFiles.length === 3, `Expected 3 restored files, got ${restoredFiles.length}`);

    // Verify file contents match
    const originalIndex = getWorkflowFiles().find(f => f.path === 'index.ts')!;
    const restoredIndex = await fileManager.readFile(WORKFLOW_NAME, 'index.ts');
    assert(
      restoredIndex.trim() === originalIndex.content.trim(),
      'Restored index.ts content should match original',
    );

    // ─── Phase 7: Re-compile and re-execute ───────────────────────
    log('RECOMPILE', 'Re-compiling restored workflow...');
    const { workflow: restoredWorkflow, outputPath: restoredOutput } = await compiler.compile(WORKFLOW_NAME);

    log('RECOMPILE', `Re-compiled to: ${restoredOutput}`);
    assert(restoredWorkflow.id === 'dynamic-math-workflow', 'Restored workflow should have correct ID');

    // Register on a fresh Mastra instance
    const mastra2 = new Mastra({});
    mastra2.addWorkflow(restoredWorkflow);

    log('REEXECUTE', 'Executing restored workflow with input { a: 100, b: 200 }...');
    const run2 = await restoredWorkflow.createRun();
    const result2 = await run2.start({ inputData: { a: 100, b: 200 } });

    log('REEXECUTE', `Result status: ${result2.status}`);
    if (result2.status === 'success') {
      log('REEXECUTE', `Result: ${JSON.stringify(result2.result)}`);
      assert(
        (result2.result as any).result === 3000,
        `Expected result 3000 ((100+200)*10), got ${(result2.result as any).result}`,
      );
    } else {
      throw new Error(`Restored workflow execution failed: ${result2.status}`);
    }

    log('REEXECUTE', 'Restored workflow execution succeeded!');

    // ─── Cleanup ──────────────────────────────────────────────────
    log('CLEANUP', 'Cleaning up...');
    await compiler.cleanAll();
    await fs.rm(workflowsDir, { recursive: true, force: true });

    console.log('\n✅ ALL TESTS PASSED\n');
    console.log('Summary:');
    console.log('  ✓ Workflow files created on disk');
    console.log('  ✓ Compiled TypeScript to ESM with esbuild');
    console.log('  ✓ Dynamically imported and got live Workflow instance');
    console.log('  ✓ Registered on Mastra instance and executed (5+7)*10 = 120');
    console.log('  ✓ Published source to blob store (3 files)');
    console.log('  ✓ Destroyed local files');
    console.log('  ✓ Restored from blob store');
    console.log('  ✓ Re-compiled and re-executed (100+200)*10 = 3000');
    console.log('  ✓ Workflow accessible via mastra.getWorkflow() and mastra.listWorkflows()');
  } catch (err) {
    console.error('\n❌ TEST FAILED\n');
    console.error(err);
    // Cleanup on failure too
    await fs.rm(workflowsDir, { recursive: true, force: true }).catch(() => {});
    process.exit(1);
  }
}

main();
