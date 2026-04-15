import { InMemoryStore } from './in-memory';
import { BlobStore } from './blob-store';

const VALID_BACKENDS = ['memory', 'blob'] as const;
type StoreBackend = (typeof VALID_BACKENDS)[number];

/**
 * Creates and returns the appropriate store backend based on the `backend` parameter.
 * The value is normalized (trimmed and lowercased) before comparison.
 *
 * @param backend - Store backend identifier. Defaults to 'memory'.
 * @param env - Environment variable map. Defaults to process.env.
 * @throws Error if the backend value is unrecognized or required env vars are missing.
 */
export function selectStore(
  backend: string = 'memory',
  env: NodeJS.ProcessEnv = process.env,
): InMemoryStore | BlobStore {
  const normalized = backend.trim().toLowerCase() as StoreBackend;

  if (!VALID_BACKENDS.includes(normalized)) {
    throw new Error(
      `Invalid STORE_BACKEND value '${backend}'. Valid options are: ${VALID_BACKENDS.join(', ')}`,
    );
  }

  if (normalized === 'blob') {
    const accountName = env['AZURE_STORAGE_ACCOUNT_NAME'];
    const containerName = env['AZURE_STORAGE_CONTAINER_NAME'];
    if (!accountName) {
      throw new Error(
        'AZURE_STORAGE_ACCOUNT_NAME is required when STORE_BACKEND=blob. Set the environment variable or change STORE_BACKEND to memory.',
      );
    }
    if (!containerName) {
      throw new Error(
        'AZURE_STORAGE_CONTAINER_NAME is required when STORE_BACKEND=blob. Set the environment variable or change STORE_BACKEND to memory.',
      );
    }
    return new BlobStore(accountName, containerName);
  }

  return new InMemoryStore();
}
