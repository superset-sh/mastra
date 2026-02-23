/**
 * WorkflowCompiler — Compiles workflow TypeScript files to ESM, dynamically imports them,
 * and returns the Workflow instance ready for registration on a Mastra instance.
 *
 * Uses esbuild to bundle the workflow's index.ts into a single .mjs file with all
 * bare specifiers externalized, then uses dynamic import() to load the module.
 *
 * Dependencies resolve from the project's node_modules because the compiled output
 * is written inside the project directory tree.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Workflow } from '../../workflows';

/**
 * Minimal interface matching the subset of esbuild's API we use.
 * This lets us accept any esbuild-compatible build function without
 * requiring esbuild as a direct dependency of @mastra/core.
 */
export interface EsbuildLike {
  build(options: Record<string, unknown>): Promise<unknown>;
}

export interface WorkflowCompilerOptions {
  /** Directory containing all workflow directories */
  workflowsBasePath: string;
  /** Output directory for compiled .mjs files (defaults to <workflowsBasePath>/.build) */
  outputDir?: string;
  /**
   * esbuild instance to use for compilation.
   * Must be provided by the consumer since @mastra/core does not depend on esbuild directly.
   */
  esbuild: EsbuildLike;
  /**
   * Additional directories to search for node_modules during compilation.
   * Useful when workflow files are outside the project tree.
   */
  nodePaths?: string[];
}

export interface CompileResult {
  /** Path to the compiled .mjs file */
  outputPath: string;
  /** The dynamically imported Workflow instance */
  workflow: Workflow;
}

export class WorkflowCompiler {
  readonly workflowsBasePath: string;
  readonly outputDir: string;
  readonly #esbuild: EsbuildLike;
  readonly #nodePaths: string[];

  constructor(options: WorkflowCompilerOptions) {
    this.workflowsBasePath = options.workflowsBasePath;
    this.outputDir = options.outputDir ?? path.join(options.workflowsBasePath, '.build');
    this.#esbuild = options.esbuild;
    this.#nodePaths = options.nodePaths ?? [];
  }

  /**
   * Compile a workflow's TypeScript source to ESM and dynamically import it.
   *
   * @param workflowName - The workflow directory name
   * @param entryFile - Entry file relative to the workflow directory (defaults to "index.ts")
   * @returns The compiled output path and the Workflow instance
   */
  async compile(workflowName: string, entryFile: string = 'index.ts'): Promise<CompileResult> {
    const entryPath = path.join(this.workflowsBasePath, workflowName, entryFile);
    const outfile = path.join(this.outputDir, workflowName, 'index.mjs');

    // Ensure output directory exists
    await fs.mkdir(path.dirname(outfile), { recursive: true });

    await this.#esbuild.build({
      entryPoints: [entryPath],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node20',
      outfile,
      // Externalize all node_modules packages — they'll resolve at runtime
      // from the project's node_modules via Node's ESM resolution
      packages: 'external',
      // Don't minify so compiled output is debuggable
      minify: false,
      sourcemap: false,
      // Write to disk so import() can load it
      write: true,
      // Additional module resolution paths
      nodePaths: this.#nodePaths.length > 0 ? this.#nodePaths : undefined,
    });

    // Dynamically import the compiled module
    // Use a cache-busting query param to avoid Node's module cache
    const fileUrl = pathToFileURL(outfile).href + `?t=${Date.now()}`;
    const mod = await import(fileUrl);

    // The module should export a Workflow instance as default or named export
    const workflow = this.#extractWorkflow(mod, workflowName);

    return { outputPath: outfile, workflow };
  }

  /**
   * Clean compiled output for a specific workflow.
   */
  async clean(workflowName: string): Promise<void> {
    const outputPath = path.join(this.outputDir, workflowName);
    await fs.rm(outputPath, { recursive: true, force: true });
  }

  /**
   * Clean all compiled output.
   */
  async cleanAll(): Promise<void> {
    await fs.rm(this.outputDir, { recursive: true, force: true });
  }

  /**
   * Extract a Workflow instance from a dynamically imported module.
   * Looks for:
   *   1. Default export that is a Workflow
   *   2. Named export "workflow" that is a Workflow
   *   3. Any named export that is a Workflow
   */
  #extractWorkflow(mod: Record<string, unknown>, workflowName: string): Workflow {
    // Check default export
    if (mod.default && this.#isWorkflow(mod.default)) {
      return mod.default as Workflow;
    }

    // Check named "workflow" export
    if (mod.workflow && this.#isWorkflow(mod.workflow)) {
      return mod.workflow as Workflow;
    }

    // Check any named export
    for (const [, value] of Object.entries(mod)) {
      if (this.#isWorkflow(value)) {
        return value as Workflow;
      }
    }

    throw new Error(
      `No Workflow instance found in compiled module for "${workflowName}". ` +
        `The module should export a Workflow as default, as "workflow", or as any named export.`,
    );
  }

  /**
   * Duck-type check for a Workflow instance.
   * We check for the distinctive properties/methods of the Workflow class
   * rather than using instanceof, since the Workflow may come from a
   * different copy of @mastra/core.
   */
  #isWorkflow(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const obj = value as Record<string, unknown>;
    return (
      typeof obj.createRun === 'function' &&
      typeof obj.commit === 'function' &&
      typeof obj.then === 'function' &&
      typeof obj.id === 'string'
    );
  }
}
