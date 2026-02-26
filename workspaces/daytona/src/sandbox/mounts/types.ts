/**
 * Shared types for Daytona mount operations.
 */

import type { Sandbox } from '@daytonaio/sdk';

export const LOG_PREFIX = '[@mastra/daytona]';

import type { DaytonaGCSMountConfig } from './gcs';
import type { DaytonaS3MountConfig } from './s3';

/**
 * Union of mount configs supported by Daytona sandbox.
 */
export type DaytonaMountConfig = DaytonaS3MountConfig | DaytonaGCSMountConfig;

/**
 * Context for mount operations.
 */
export interface MountContext {
  sandbox: Sandbox;
  logger: {
    debug: (message: string, ...args: unknown[]) => void;
    info: (message: string, ...args: unknown[]) => void;
    warn: (message: string, ...args: unknown[]) => void;
    error: (message: string, ...args: unknown[]) => void;
  };
}

/**
 * Validate a bucket name before interpolating into shell commands.
 * Covers S3, GCS, and S3-compatible (R2, MinIO) naming rules.
 */
const SAFE_BUCKET_NAME = /^[a-z0-9][a-z0-9.\-]{1,61}[a-z0-9]$/;

export function validateBucketName(bucket: string): void {
  if (!SAFE_BUCKET_NAME.test(bucket)) {
    throw new Error(
      `Invalid bucket name: "${bucket}". Bucket names must be 3-63 characters, lowercase alphanumeric, hyphens, or dots.`,
    );
  }
}

/**
 * Validate an endpoint URL before interpolating into shell commands.
 * Only http and https schemes are allowed.
 */
export function validateEndpoint(endpoint: string): void {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error(`Invalid endpoint URL: "${endpoint}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Invalid endpoint URL scheme: "${parsed.protocol}". Only http: and https: are allowed.`);
  }
}

/**
 * Run a command in the Daytona sandbox and return the result.
 * Wraps the process.executeCommand API to match the command execution pattern
 * used in mount operations.
 *
 * Does NOT throw on non-zero exit codes — callers should check `exitCode` themselves.
 *
 * Note: Daytona's executeCommand returns a single `result` string (stdout).
 * Stderr is not captured separately — use `2>&1` redirection in commands
 * that need stderr captured.
 */
export async function runCommand(
  sandbox: Sandbox,
  command: string,
  options?: { timeout?: number },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const result = await sandbox.process.executeCommand(
    command,
    undefined, // cwd
    undefined, // env
    options?.timeout ? Math.ceil(options.timeout / 1000) : undefined,
  );

  return {
    exitCode: result.exitCode,
    stdout: result.result ?? '',
    stderr: '', // Daytona executeCommand doesn't separate stderr
  };
}

/**
 * Write a file in the Daytona sandbox.
 * Uses the Daytona SDK's filesystem upload API for safe content transport.
 */
export async function writeFile(sandbox: Sandbox, remotePath: string, content: string): Promise<void> {
  await sandbox.fs.uploadFile(Buffer.from(content, 'utf-8'), remotePath);
}
