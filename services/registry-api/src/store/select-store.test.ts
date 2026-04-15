// ── Mock @azure/identity ──────────────────────────────────────────────────────
jest.mock('@azure/identity', () => ({
  DefaultAzureCredential: jest.fn().mockImplementation(() => ({})),
}));

// ── Mock @azure/storage-blob ──────────────────────────────────────────────────
jest.mock('@azure/storage-blob', () => {
  const mockGetContainerClient = jest.fn().mockReturnValue({
    getBlobClient: jest.fn(),
    getBlockBlobClient: jest.fn(),
    getProperties: jest.fn().mockResolvedValue({}),
  });
  return {
    BlobServiceClient: jest.fn().mockImplementation(() => ({
      getContainerClient: mockGetContainerClient,
    })),
    RestError: class RestError extends Error {},
    BlockBlobClient: jest.fn(),
    ContainerClient: jest.fn(),
  };
});

import { selectStore } from './select-store';
import { InMemoryStore } from './in-memory';
import { BlobStore } from './blob-store';

const BLOB_ENV: NodeJS.ProcessEnv = {
  AZURE_STORAGE_ACCOUNT_NAME: 'myaccount',
  AZURE_STORAGE_CONTAINER_NAME: 'mycontainer',
};

describe('selectStore', () => {
  // ── memory backend ───────────────────────────────────────────────────────────

  describe('memory backend', () => {
    it('returns InMemoryStore for "memory"', () => {
      expect(selectStore('memory')).toBeInstanceOf(InMemoryStore);
    });

    it('defaults to InMemoryStore when no backend is specified', () => {
      expect(selectStore()).toBeInstanceOf(InMemoryStore);
    });

    it('is case-insensitive (MEMORY)', () => {
      expect(selectStore('MEMORY')).toBeInstanceOf(InMemoryStore);
    });

    it('trims surrounding whitespace', () => {
      expect(selectStore('  memory  ')).toBeInstanceOf(InMemoryStore);
    });
  });

  // ── blob backend ─────────────────────────────────────────────────────────────

  describe('blob backend', () => {
    it('returns BlobStore when blob env vars are set', () => {
      expect(selectStore('blob', BLOB_ENV)).toBeInstanceOf(BlobStore);
    });

    it('is case-insensitive (BLOB)', () => {
      expect(selectStore('BLOB', BLOB_ENV)).toBeInstanceOf(BlobStore);
    });

    it('trims surrounding whitespace', () => {
      expect(selectStore('  blob  ', BLOB_ENV)).toBeInstanceOf(BlobStore);
    });

    it('throws when AZURE_STORAGE_ACCOUNT_NAME is missing', () => {
      expect(() => selectStore('blob', { AZURE_STORAGE_CONTAINER_NAME: 'mycontainer' })).toThrow(
        'AZURE_STORAGE_ACCOUNT_NAME',
      );
    });

    it('throws when AZURE_STORAGE_CONTAINER_NAME is missing', () => {
      expect(() => selectStore('blob', { AZURE_STORAGE_ACCOUNT_NAME: 'myaccount' })).toThrow(
        'AZURE_STORAGE_CONTAINER_NAME',
      );
    });

    it('throws with an actionable message when AZURE_STORAGE_ACCOUNT_NAME is missing', () => {
      expect(() => selectStore('blob', {})).toThrow(
        'Set the environment variable or change STORE_BACKEND to memory',
      );
    });
  });

  // ── invalid backend ──────────────────────────────────────────────────────────

  describe('invalid backend', () => {
    it('throws for an unrecognized value', () => {
      expect(() => selectStore('invalid')).toThrow("Invalid STORE_BACKEND value 'invalid'");
    });

    it('throws for a typo (blub)', () => {
      expect(() => selectStore('blub')).toThrow("Invalid STORE_BACKEND value 'blub'");
    });

    it('throws with valid options listed in the error message', () => {
      expect(() => selectStore('redis')).toThrow('memory, blob');
    });
  });
});
