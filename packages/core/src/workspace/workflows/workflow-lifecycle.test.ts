/**
 * Integration test for the full workflow lifecycle:
 *
 * 1. Create workflow TypeScript files on disk
 * 2. Compile to ESM and dynamically import
 * 3. Execute the workflow
 * 4. Publish source files to blob store
 * 5. Destroy local files
 * 6. Restore from blob store
 * 7. Re-compile, re-execute
 *
 * This validates the entire round-trip: filesystem → blob store → filesystem → execution.
 *
 * NOTE: Test workflow files are written inside the project tree (under .test-tmp/)
 * so that relative imports to the actual workflow source files resolve correctly.
 * In production, workflow files live inside the user's Mastra project and use
 * `@mastra/core/workflows` imports — which resolve from the project's node_modules.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as esbuild from 'esbuild';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { InMemoryBlobStore } from '../../storage/domains/blobs/inmemory';
import { WorkflowCompiler } from './workflow-compiler';
import { WorkflowFileManager } from './workflow-file-manager';
import { collectWorkflowForPublish, publishWorkflow, restoreWorkflow } from './workflow-publisher';

// =============================================================================
// Test Fixtures
// =============================================================================

/**
 * Test workflow directory lives inside the project tree so relative imports
 * to `../../workflows/workflow` (the actual source) resolve correctly.
 *
 * Directory structure (from this file):
 *   packages/core/src/workspace/workflows/.test-tmp/run-XXX/<wf>/index.ts
 *   packages/core/src/workspace/workflows/.test-tmp/run-XXX/<wf>/steps/add.ts
 *
 * Target: packages/core/src/workflows/workflow
 *
 * From index.ts (5 levels up):
 *   ../../../../../workflows/workflow
 *
 * From steps/add.ts (6 levels up):
 *   ../../../../../../workflows/workflow
 */
const TEST_TMP_DIR = path.join(__dirname, '.test-tmp');

/**
 * A minimal workflow that adds two numbers.
 * Uses relative imports to the actual workflow source files.
 */
function getTestWorkflowFiles() {
  const stepFile = `
import { z } from 'zod';
import { createStep } from '../../../../../../workflows/workflow';

export const addStep = createStep({
  id: 'add-numbers',
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
`;

  const indexFile = `
import { z } from 'zod';
import { createWorkflow } from '../../../../../workflows/workflow';
import { addStep } from './steps/add';

const workflow = createWorkflow({
  id: 'test-add-workflow',
  inputSchema: z.object({
    a: z.number(),
    b: z.number(),
  }),
  outputSchema: z.object({
    sum: z.number(),
  }),
  steps: [addStep],
})
  .then(addStep)
  .commit();

export { workflow };
`;

  return [
    { path: 'steps/add.ts', content: stepFile },
    { path: 'index.ts', content: indexFile },
  ];
}

/**
 * A second workflow (for testing multiple workflows).
 * Multiplies two numbers.
 */
function getMultiplyWorkflowFiles() {
  const stepFile = `
import { z } from 'zod';
import { createStep } from '../../../../../../workflows/workflow';

export const multiplyStep = createStep({
  id: 'multiply-numbers',
  inputSchema: z.object({
    x: z.number(),
    y: z.number(),
  }),
  outputSchema: z.object({
    product: z.number(),
  }),
  execute: async ({ inputData }) => {
    return { product: inputData.x * inputData.y };
  },
});
`;

  const indexFile = `
import { z } from 'zod';
import { createWorkflow } from '../../../../../workflows/workflow';
import { multiplyStep } from './steps/multiply';

const workflow = createWorkflow({
  id: 'test-multiply-workflow',
  inputSchema: z.object({
    x: z.number(),
    y: z.number(),
  }),
  outputSchema: z.object({
    product: z.number(),
  }),
  steps: [multiplyStep],
})
  .then(multiplyStep)
  .commit();

export { workflow };
`;

  return [
    { path: 'steps/multiply.ts', content: stepFile },
    { path: 'index.ts', content: indexFile },
  ];
}

// =============================================================================
// Tests
// =============================================================================

describe('Workflow Lifecycle', () => {
  let workflowsDir: string;
  let fileManager: WorkflowFileManager;
  let compiler: WorkflowCompiler;
  let blobStore: InMemoryBlobStore;

  beforeEach(async () => {
    workflowsDir = path.join(TEST_TMP_DIR, `run-${Date.now()}`);
    await fs.mkdir(workflowsDir, { recursive: true });

    fileManager = new WorkflowFileManager({ basePath: workflowsDir });
    compiler = new WorkflowCompiler({
      workflowsBasePath: workflowsDir,
      esbuild,
    });
    blobStore = new InMemoryBlobStore();
    await blobStore.init();
  });

  afterEach(async () => {
    await fs.rm(workflowsDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // WorkflowFileManager
  // ---------------------------------------------------------------------------

  describe('WorkflowFileManager', () => {
    it('should create a workflow with files', async () => {
      const files = getTestWorkflowFiles();
      await fileManager.createWorkflow('add-workflow', files);

      const exists = await fileManager.workflowExists('add-workflow');
      expect(exists).toBe(true);

      const listedFiles = await fileManager.listFiles('add-workflow');
      expect(listedFiles).toContain('index.ts');
      expect(listedFiles).toContain('steps/add.ts');
    });

    it('should throw when creating duplicate workflow', async () => {
      const files = getTestWorkflowFiles();
      await fileManager.createWorkflow('dup-workflow', files);

      await expect(fileManager.createWorkflow('dup-workflow', files)).rejects.toThrow(
        'Workflow directory already exists',
      );
    });

    it('should read and write files', async () => {
      const files = getTestWorkflowFiles();
      await fileManager.createWorkflow('rw-workflow', files);

      const content = await fileManager.readFile('rw-workflow', 'index.ts');
      expect(content).toContain('test-add-workflow');

      await fileManager.writeFile('rw-workflow', 'index.ts', '// updated');
      const updated = await fileManager.readFile('rw-workflow', 'index.ts');
      expect(updated).toBe('// updated');
    });

    it('should delete files and workflows', async () => {
      const files = getTestWorkflowFiles();
      await fileManager.createWorkflow('del-workflow', files);

      await fileManager.deleteFile('del-workflow', 'steps/add.ts');
      const remaining = await fileManager.listFiles('del-workflow');
      expect(remaining).not.toContain('steps/add.ts');

      await fileManager.deleteWorkflow('del-workflow');
      const exists = await fileManager.workflowExists('del-workflow');
      expect(exists).toBe(false);
    });

    it('should list workflows', async () => {
      await fileManager.createWorkflow('wf-a', getTestWorkflowFiles());
      await fileManager.createWorkflow('wf-b', getMultiplyWorkflowFiles());

      const workflows = await fileManager.listWorkflows();
      expect(workflows).toContain('wf-a');
      expect(workflows).toContain('wf-b');
    });

    it('should read all files', async () => {
      const files = getTestWorkflowFiles();
      await fileManager.createWorkflow('readall-workflow', files);

      const allFiles = await fileManager.readAllFiles('readall-workflow');
      expect(allFiles).toHaveLength(2);
      expect(allFiles.map(f => f.path).sort()).toEqual(['index.ts', 'steps/add.ts']);
    });
  });

  // ---------------------------------------------------------------------------
  // WorkflowCompiler
  // ---------------------------------------------------------------------------

  describe('WorkflowCompiler', () => {
    it('should compile and load a workflow', async () => {
      const files = getTestWorkflowFiles();
      await fileManager.createWorkflow('compile-test', files);

      const result = await compiler.compile('compile-test');

      expect(result.workflow).toBeDefined();
      expect(result.workflow.id).toBe('test-add-workflow');
      expect(result.outputPath).toContain('compile-test');
      expect(result.outputPath).toMatch(/\.mjs$/);
    });

    it('should execute a compiled workflow', async () => {
      const files = getTestWorkflowFiles();
      await fileManager.createWorkflow('exec-test', files);

      const { workflow } = await compiler.compile('exec-test');
      const run = await workflow.createRun();
      const runResult = (await run.start({ inputData: { a: 3, b: 4 } })) as any;

      expect(runResult.status).toBe('success');
      expect(runResult.result).toEqual({ sum: 7 });
    });

    it('should clean compiled output', async () => {
      const files = getTestWorkflowFiles();
      await fileManager.createWorkflow('clean-test', files);

      const result = await compiler.compile('clean-test');

      // Output file should exist
      const exists = await fs
        .access(result.outputPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);

      await compiler.clean('clean-test');

      const existsAfter = await fs
        .access(result.outputPath)
        .then(() => true)
        .catch(() => false);
      expect(existsAfter).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // WorkflowPublisher
  // ---------------------------------------------------------------------------

  describe('WorkflowPublisher', () => {
    it('should collect workflow files for publish', async () => {
      const files = getTestWorkflowFiles();
      await fileManager.createWorkflow('collect-test', files);

      const workflowDir = fileManager.getWorkflowDir('collect-test');
      const result = await collectWorkflowForPublish(workflowDir);

      expect(Object.keys(result.tree.entries)).toHaveLength(2);
      expect(result.tree.entries['index.ts']).toBeDefined();
      expect(result.tree.entries['steps/add.ts']).toBeDefined();
      expect(result.blobs.length).toBeGreaterThanOrEqual(1);

      // Verify MIME types
      expect(result.tree.entries['index.ts']!.mimeType).toBe('text/typescript');
      expect(result.tree.entries['steps/add.ts']!.mimeType).toBe('text/typescript');
    });

    it('should publish workflow files to blob store', async () => {
      const files = getTestWorkflowFiles();
      await fileManager.createWorkflow('publish-test', files);

      const workflowDir = fileManager.getWorkflowDir('publish-test');
      const result = await publishWorkflow(workflowDir, blobStore);

      // Verify blobs were stored
      for (const entry of Object.values(result.tree.entries)) {
        const hasBlob = await blobStore.has(entry.blobHash);
        expect(hasBlob).toBe(true);
      }
    });

    it('should restore workflow files from blob store', async () => {
      const files = getTestWorkflowFiles();
      await fileManager.createWorkflow('restore-test', files);

      // Publish
      const workflowDir = fileManager.getWorkflowDir('restore-test');
      const { tree } = await publishWorkflow(workflowDir, blobStore);

      // Delete local files
      await fileManager.deleteWorkflow('restore-test');
      expect(await fileManager.workflowExists('restore-test')).toBe(false);

      // Restore to a new directory
      const restoreDir = path.join(workflowsDir, 'restored-workflow');
      await restoreWorkflow(tree, blobStore, restoreDir);

      // Verify files were restored
      const restoredFiles = await new WorkflowFileManager({ basePath: workflowsDir }).listFiles('restored-workflow');
      expect(restoredFiles).toContain('index.ts');
      expect(restoredFiles).toContain('steps/add.ts');
    });
  });

  // ---------------------------------------------------------------------------
  // Full Lifecycle
  // ---------------------------------------------------------------------------

  describe('Full Lifecycle: create → compile → execute → publish → destroy → restore → execute', () => {
    it('should complete the full round-trip', async () => {
      // Phase 1: Create files
      const files = getTestWorkflowFiles();
      await fileManager.createWorkflow('lifecycle-test', files);

      // Phase 2: Compile and execute
      const { workflow: wf1 } = await compiler.compile('lifecycle-test');
      expect(wf1.id).toBe('test-add-workflow');

      const run1 = await wf1.createRun();
      const result1 = (await run1.start({ inputData: { a: 10, b: 20 } })) as any;
      expect(result1.status).toBe('success');
      expect(result1.result).toEqual({ sum: 30 });

      // Phase 3: Publish to blob store
      const workflowDir = fileManager.getWorkflowDir('lifecycle-test');
      const { tree } = await publishWorkflow(workflowDir, blobStore);

      // Phase 4: Destroy local files (simulating server restart / different machine)
      await fileManager.deleteWorkflow('lifecycle-test');
      await compiler.cleanAll();
      expect(await fileManager.workflowExists('lifecycle-test')).toBe(false);

      // Phase 5: Restore from blob store
      const restoreDir = fileManager.getWorkflowDir('lifecycle-test');
      await restoreWorkflow(tree, blobStore, restoreDir);
      expect(await fileManager.workflowExists('lifecycle-test')).toBe(true);

      // Phase 6: Re-compile and re-execute
      const { workflow: wf2 } = await compiler.compile('lifecycle-test');
      expect(wf2.id).toBe('test-add-workflow');

      const run2 = await wf2.createRun();
      const result2 = (await run2.start({ inputData: { a: 100, b: 200 } })) as any;
      expect(result2.status).toBe('success');
      expect(result2.result).toEqual({ sum: 300 });
    });

    it('should handle multiple workflows independently', async () => {
      // Create both workflows
      await fileManager.createWorkflow('add-wf', getTestWorkflowFiles());
      await fileManager.createWorkflow('multiply-wf', getMultiplyWorkflowFiles());

      // Compile both
      const { workflow: addWf } = await compiler.compile('add-wf');
      const { workflow: mulWf } = await compiler.compile('multiply-wf');

      expect(addWf.id).toBe('test-add-workflow');
      expect(mulWf.id).toBe('test-multiply-workflow');

      // Execute both
      const addRun = await addWf.createRun();
      const addResult = (await addRun.start({ inputData: { a: 5, b: 3 } })) as any;
      expect(addResult.result).toEqual({ sum: 8 });

      const mulRun = await mulWf.createRun();
      const mulResult = (await mulRun.start({ inputData: { x: 5, y: 3 } })) as any;
      expect(mulResult.result).toEqual({ product: 15 });

      // Publish both
      const addPublish = await publishWorkflow(fileManager.getWorkflowDir('add-wf'), blobStore);
      const mulPublish = await publishWorkflow(fileManager.getWorkflowDir('multiply-wf'), blobStore);

      // Destroy both
      await fileManager.deleteWorkflow('add-wf');
      await fileManager.deleteWorkflow('multiply-wf');
      await compiler.cleanAll();

      // Restore both
      await restoreWorkflow(addPublish.tree, blobStore, fileManager.getWorkflowDir('add-wf'));
      await restoreWorkflow(mulPublish.tree, blobStore, fileManager.getWorkflowDir('multiply-wf'));

      // Re-compile and re-execute both
      const { workflow: addWf2 } = await compiler.compile('add-wf');
      const addRun2 = await addWf2.createRun();
      const addResult2 = (await addRun2.start({ inputData: { a: 50, b: 30 } })) as any;
      expect(addResult2.result).toEqual({ sum: 80 });

      const { workflow: mulWf2 } = await compiler.compile('multiply-wf');
      const mulRun2 = await mulWf2.createRun();
      const mulResult2 = (await mulRun2.start({ inputData: { x: 50, y: 30 } })) as any;
      expect(mulResult2.result).toEqual({ product: 1500 });
    });
  });
});
