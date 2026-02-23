/**
 * WorkflowFileManager — CRUD for workflow TypeScript files on local filesystem.
 *
 * Manages a workflow directory structure:
 *   <basePath>/
 *     <workflowName>/
 *       index.ts          — workflow definition (imports steps, builds flow)
 *       steps/
 *         step-a.ts       — individual step implementations
 *         step-b.ts
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface WorkflowFileManagerOptions {
  /** Root directory where all workflow directories live */
  basePath: string;
}

export interface WorkflowFile {
  /** Relative path within the workflow directory (e.g. "index.ts", "steps/step-a.ts") */
  path: string;
  /** File content */
  content: string;
}

export class WorkflowFileManager {
  readonly basePath: string;

  constructor(options: WorkflowFileManagerOptions) {
    this.basePath = options.basePath;
  }

  /**
   * Get the absolute path to a workflow directory.
   */
  getWorkflowDir(workflowName: string): string {
    return path.join(this.basePath, workflowName);
  }

  /**
   * Create a new workflow directory with initial files.
   * Throws if the workflow directory already exists.
   */
  async createWorkflow(workflowName: string, files: WorkflowFile[]): Promise<void> {
    const workflowDir = this.getWorkflowDir(workflowName);

    const exists = await fs
      .access(workflowDir)
      .then(() => true)
      .catch(() => false);
    if (exists) {
      throw new Error(`Workflow directory already exists: ${workflowDir}`);
    }

    await fs.mkdir(workflowDir, { recursive: true });

    for (const file of files) {
      const filePath = path.join(workflowDir, file.path);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, file.content, 'utf-8');
    }
  }

  /**
   * Read a single file from a workflow.
   */
  async readFile(workflowName: string, filePath: string): Promise<string> {
    const fullPath = path.join(this.getWorkflowDir(workflowName), filePath);
    return fs.readFile(fullPath, 'utf-8');
  }

  /**
   * Write (create or update) a single file in a workflow.
   */
  async writeFile(workflowName: string, filePath: string, content: string): Promise<void> {
    const fullPath = path.join(this.getWorkflowDir(workflowName), filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
  }

  /**
   * Delete a single file from a workflow.
   */
  async deleteFile(workflowName: string, filePath: string): Promise<void> {
    const fullPath = path.join(this.getWorkflowDir(workflowName), filePath);
    await fs.unlink(fullPath);
  }

  /**
   * Delete an entire workflow directory.
   */
  async deleteWorkflow(workflowName: string): Promise<void> {
    const workflowDir = this.getWorkflowDir(workflowName);
    await fs.rm(workflowDir, { recursive: true, force: true });
  }

  /**
   * List all files in a workflow directory (recursively).
   * Returns relative paths.
   */
  async listFiles(workflowName: string): Promise<string[]> {
    const workflowDir = this.getWorkflowDir(workflowName);
    return this.#walkDir(workflowDir, workflowDir);
  }

  /**
   * List all workflow directories.
   */
  async listWorkflows(): Promise<string[]> {
    const exists = await fs
      .access(this.basePath)
      .then(() => true)
      .catch(() => false);
    if (!exists) return [];

    const entries = await fs.readdir(this.basePath, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name);
  }

  /**
   * Read all files in a workflow directory.
   */
  async readAllFiles(workflowName: string): Promise<WorkflowFile[]> {
    const filePaths = await this.listFiles(workflowName);
    const files: WorkflowFile[] = [];
    for (const filePath of filePaths) {
      const content = await this.readFile(workflowName, filePath);
      files.push({ path: filePath, content });
    }
    return files;
  }

  /**
   * Check if a workflow exists.
   */
  async workflowExists(workflowName: string): Promise<boolean> {
    const workflowDir = this.getWorkflowDir(workflowName);
    return fs
      .access(workflowDir)
      .then(() => true)
      .catch(() => false);
  }

  async #walkDir(dir: string, baseDir: string): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const subFiles = await this.#walkDir(fullPath, baseDir);
        files.push(...subFiles);
      } else {
        files.push(path.relative(baseDir, fullPath));
      }
    }

    return files.sort();
  }
}
