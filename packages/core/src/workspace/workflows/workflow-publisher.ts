/**
 * WorkflowPublisher — Publish/restore workflow TypeScript source to/from blob store.
 *
 * Reuses the content-addressable storage pattern from skills:
 * - Walk workflow directory, hash all files, build a tree manifest
 * - Store blobs in BlobStore
 * - On restore, write files back to local filesystem from blob store
 *
 * The tree manifest (WorkflowVersionTree) maps relative file paths to blob hashes,
 * identical to SkillVersionTree. We reuse the same types.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { BlobStore } from '../../storage/domains/blobs/base';
import type { SkillVersionTree, SkillVersionTreeEntry, StorageBlobEntry } from '../../storage/types';

/** We reuse SkillVersionTree for workflow file trees — same structure */
export type WorkflowVersionTree = SkillVersionTree;
export type WorkflowVersionTreeEntry = SkillVersionTreeEntry;

export interface WorkflowPublishResult {
  /** Content-addressable file tree manifest */
  tree: WorkflowVersionTree;
  /** Blob entries stored (deduplicated by hash) */
  blobs: StorageBlobEntry[];
}

// =============================================================================
// Internal Helpers
// =============================================================================

function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

function detectMimeType(filename: string): string | undefined {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.ts': 'text/typescript',
    '.tsx': 'text/typescript',
    '.js': 'text/javascript',
    '.jsx': 'text/javascript',
    '.json': 'application/json',
    '.md': 'text/markdown',
    '.txt': 'text/plain',
    '.yaml': 'text/yaml',
    '.yml': 'text/yaml',
  };
  return mimeTypes[ext];
}

interface WalkedFile {
  /** Relative path from workflow root */
  relativePath: string;
  /** File content as UTF-8 string */
  content: string;
}

async function walkDirectory(dir: string, baseDir: string): Promise<WalkedFile[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: WalkedFile[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const subFiles = await walkDirectory(fullPath, baseDir);
      files.push(...subFiles);
    } else {
      const content = await fs.readFile(fullPath, 'utf-8');
      const relativePath = path.relative(baseDir, fullPath);
      // Normalize to forward slashes
      files.push({ relativePath: relativePath.replace(/\\/g, '/'), content });
    }
  }

  return files;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Collect all files from a workflow directory for publishing.
 * Walks the directory, hashes files, and builds a tree manifest.
 */
export async function collectWorkflowForPublish(workflowDir: string): Promise<WorkflowPublishResult> {
  const files = await walkDirectory(workflowDir, workflowDir);

  const treeEntries: Record<string, WorkflowVersionTreeEntry> = {};
  const blobMap = new Map<string, StorageBlobEntry>();
  const now = new Date();

  for (const file of files) {
    const hash = hashContent(file.content);
    const size = Buffer.byteLength(file.content, 'utf-8');
    const mimeType = detectMimeType(file.relativePath);

    treeEntries[file.relativePath] = {
      blobHash: hash,
      size,
      mimeType,
    };

    if (!blobMap.has(hash)) {
      blobMap.set(hash, {
        hash,
        content: file.content,
        size,
        mimeType,
        createdAt: now,
      });
    }
  }

  return {
    tree: { entries: treeEntries },
    blobs: Array.from(blobMap.values()),
  };
}

/**
 * Publish a workflow: collect files and store blobs.
 *
 * @param workflowDir - Absolute path to the workflow directory
 * @param blobStore - Where to store file blobs
 * @returns The tree manifest and stored blobs
 */
export async function publishWorkflow(workflowDir: string, blobStore: BlobStore): Promise<WorkflowPublishResult> {
  const result = await collectWorkflowForPublish(workflowDir);
  await blobStore.putMany(result.blobs);
  return result;
}

/**
 * Restore a workflow from a tree manifest + blob store to a local directory.
 * Writes all files from the blob store back to disk.
 *
 * @param tree - The workflow's tree manifest (stored in DB)
 * @param blobStore - Where to read file blobs from
 * @param targetDir - Local directory to write files to
 */
export async function restoreWorkflow(
  tree: WorkflowVersionTree,
  blobStore: BlobStore,
  targetDir: string,
): Promise<void> {
  // Fetch all blobs in batch
  const hashes = Object.values(tree.entries).map(e => e.blobHash);
  const blobs = await blobStore.getMany(hashes);

  for (const [filePath, entry] of Object.entries(tree.entries)) {
    const blob = blobs.get(entry.blobHash);
    if (!blob) {
      throw new Error(`Blob not found for hash ${entry.blobHash} (file: ${filePath})`);
    }

    const fullPath = path.join(targetDir, filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, blob.content, 'utf-8');
  }
}
