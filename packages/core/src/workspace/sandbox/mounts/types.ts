/**
 * Shared types for local FUSE mount operations.
 */

export const LOG_PREFIX = '[LocalSandbox]';

/**
 * Context for local mount operations.
 * Uses a run function instead of E2B's sandbox.commands.run().
 */
export interface LocalMountContext {
  run: (
    command: string,
    args: string[],
    options?: { timeout?: number },
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  platform: NodeJS.Platform;
  logger: {
    debug: (message: string, ...args: unknown[]) => void;
    info: (message: string, ...args: unknown[]) => void;
    warn: (message: string, ...args: unknown[]) => void;
    error: (message: string, ...args: unknown[]) => void;
  };
}

/**
 * Error thrown when a required FUSE tool (s3fs, gcsfuse, macFUSE) is not installed.
 * Distinguished from actual mount errors so callers can warn instead of error.
 */
export class MountToolNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MountToolNotFoundError';
  }
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
 */
export function validateEndpoint(endpoint: string): void {
  try {
    new URL(endpoint);
  } catch {
    throw new Error(`Invalid endpoint URL: "${endpoint}"`);
  }
}
