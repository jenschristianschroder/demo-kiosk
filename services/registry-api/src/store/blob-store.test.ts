import { Readable } from 'stream';
import { RestError } from '@azure/storage-blob';
import { BlobStore, ConcurrencyError } from './blob-store';
import { Demo, KioskSettings } from '../models';
import { SEED_DEMOS, DEFAULT_SETTINGS } from './seed-data';

// ── Mock @azure/identity ──────────────────────────────────────────────────────
jest.mock('@azure/identity', () => ({
  DefaultAzureCredential: jest.fn().mockImplementation(() => ({})),
}));

// ── Mock @azure/storage-blob ──────────────────────────────────────────────────
// Use var (not const) so hoisted jest.mock factory can reference them without TDZ errors.
/* eslint-disable no-var */
var mockUpload: jest.Mock;
var mockDownload: jest.Mock;
var mockGetProperties: jest.Mock;
/* eslint-enable no-var */

jest.mock('@azure/storage-blob', () => {
  class MockRestError extends Error {
    statusCode?: number;
    code?: string;
    constructor(message: string, options?: { statusCode?: number; code?: string }) {
      super(message);
      this.name = 'RestError';
      this.statusCode = options?.statusCode;
      this.code = options?.code;
    }
  }

  const mockGetBlockBlobClient = jest.fn().mockReturnValue({
    // Defer to module-level var so beforeEach can reset it
    upload: (...args: unknown[]) => mockUpload(...args),
  });
  const mockGetBlobClient = jest.fn().mockReturnValue({
    download: (...args: unknown[]) => mockDownload(...args),
  });
  const mockGetContainerClient = jest.fn().mockReturnValue({
    getBlobClient: mockGetBlobClient,
    getBlockBlobClient: mockGetBlockBlobClient,
    getProperties: (...args: unknown[]) => mockGetProperties(...args),
  });

  return {
    BlobServiceClient: jest.fn().mockImplementation(() => ({
      getContainerClient: mockGetContainerClient,
    })),
    RestError: MockRestError,
  };
});

// ── Helpers to build blob content ────────────────────────────────────────────

function makeStream(content: string): NodeJS.ReadableStream {
  return Readable.from([Buffer.from(content, 'utf-8')]);
}

function makeDownloadResponse(content: string, etag: string) {
  return {
    etag,
    readableStreamBody: makeStream(content),
  };
}

// ── Test data ─────────────────────────────────────────────────────────────────

const DEMO_1: Demo = {
  id: 'demo-1',
  title: 'Demo One',
  description: 'First demo',
  demoUrl: 'https://demo1.example.com',
  thumbnailUrl: '/thumbnails/demo1.png',
  tags: ['tag1'],
  launchMode: 'sameTab',
  isActive: true,
  sortOrder: 1,
  owner: 'owner@example.com',
};

const DEMO_2: Demo = {
  id: 'demo-2',
  title: 'Demo Two',
  description: 'Second demo',
  demoUrl: 'https://demo2.example.com',
  thumbnailUrl: '/thumbnails/demo2.png',
  tags: ['tag2'],
  launchMode: 'newTab',
  isActive: false,
  sortOrder: 2,
  owner: 'owner@example.com',
};

// ── Factory ───────────────────────────────────────────────────────────────────

function makeStore(): BlobStore {
  return new BlobStore('myaccount', 'my-container');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BlobStore', () => {
  beforeEach(() => {
    mockUpload = jest.fn().mockResolvedValue({});
    mockDownload = jest.fn();
    mockGetProperties = jest.fn().mockResolvedValue({});
  });

  // ── Constructor ─────────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('throws when account name is missing', () => {
      delete process.env['AZURE_STORAGE_ACCOUNT_NAME'];
      delete process.env['AZURE_STORAGE_CONTAINER_NAME'];
      expect(() => new BlobStore(undefined, 'container')).toThrow('AZURE_STORAGE_ACCOUNT_NAME');
    });

    it('throws when container name is missing', () => {
      delete process.env['AZURE_STORAGE_CONTAINER_NAME'];
      expect(() => new BlobStore('account', undefined)).toThrow('AZURE_STORAGE_CONTAINER_NAME');
    });

    it('reads account/container from environment variables', () => {
      process.env['AZURE_STORAGE_ACCOUNT_NAME'] = 'envaccount';
      process.env['AZURE_STORAGE_CONTAINER_NAME'] = 'envcontainer';
      expect(() => new BlobStore()).not.toThrow();
      delete process.env['AZURE_STORAGE_ACCOUNT_NAME'];
      delete process.env['AZURE_STORAGE_CONTAINER_NAME'];
    });
  });

  // ── getAllDemos ──────────────────────────────────────────────────────────────

  describe('getAllDemos', () => {
    it('returns empty array when blob does not exist (404)', async () => {
      mockDownload.mockRejectedValue(new RestError('not found', { statusCode: 404, code: 'BlobNotFound' }));

      const store = makeStore();
      const demos = await store.getAllDemos();
      expect(demos).toEqual([]);
    });

    it('returns demos sorted by sortOrder', async () => {
      mockDownload.mockResolvedValue(
        makeDownloadResponse(JSON.stringify([DEMO_2, DEMO_1]), '"etag-1"'),
      );

      const store = makeStore();
      const demos = await store.getAllDemos();
      expect(demos).toHaveLength(2);
      expect(demos[0].id).toBe('demo-1');
      expect(demos[1].id).toBe('demo-2');
    });
  });

  // ── getDemoById ─────────────────────────────────────────────────────────────

  describe('getDemoById', () => {
    it('returns undefined when blob is missing', async () => {
      mockDownload.mockRejectedValue(new RestError('not found', { statusCode: 404, code: 'BlobNotFound' }));

      const store = makeStore();
      const result = await store.getDemoById('demo-1');
      expect(result).toBeUndefined();
    });

    it('returns the matching demo', async () => {
      mockDownload.mockResolvedValue(
        makeDownloadResponse(JSON.stringify([DEMO_1, DEMO_2]), '"etag-1"'),
      );

      const store = makeStore();
      const result = await store.getDemoById('demo-2');
      expect(result).toEqual(DEMO_2);
    });

    it('returns undefined for unknown id', async () => {
      mockDownload.mockResolvedValue(
        makeDownloadResponse(JSON.stringify([DEMO_1]), '"etag-1"'),
      );

      const store = makeStore();
      const result = await store.getDemoById('unknown');
      expect(result).toBeUndefined();
    });
  });

  // ── createDemo ──────────────────────────────────────────────────────────────

  describe('createDemo', () => {
    it('appends the new demo and writes with etag condition', async () => {
      mockDownload.mockResolvedValue(
        makeDownloadResponse(JSON.stringify([DEMO_1]), '"etag-abc"'),
      );

      const store = makeStore();
      const created = await store.createDemo(DEMO_2);

      expect(created).toEqual(DEMO_2);
      expect(mockUpload).toHaveBeenCalledTimes(1);

      const [uploadedBuffer, , uploadOptions] = mockUpload.mock.calls[0];
      const written = JSON.parse(uploadedBuffer.toString('utf-8')) as Demo[];
      expect(written).toHaveLength(2);
      expect(written.find((d) => d.id === 'demo-2')).toEqual(DEMO_2);
      expect(uploadOptions.conditions).toEqual({ ifMatch: '"etag-abc"' });
    });

    it('uses ifNoneMatch when blob does not exist yet', async () => {
      mockDownload.mockRejectedValue(new RestError('not found', { statusCode: 404, code: 'BlobNotFound' }));

      const store = makeStore();
      await store.createDemo(DEMO_1);

      const [, , uploadOptions] = mockUpload.mock.calls[0];
      expect(uploadOptions.conditions).toEqual({ ifNoneMatch: '*' });
    });
  });

  // ── updateDemo ──────────────────────────────────────────────────────────────

  describe('updateDemo', () => {
    it('returns undefined when demo does not exist', async () => {
      mockDownload.mockResolvedValue(
        makeDownloadResponse(JSON.stringify([DEMO_1]), '"etag-1"'),
      );

      const store = makeStore();
      const result = await store.updateDemo('unknown', { title: 'Updated' });
      expect(result).toBeUndefined();
      expect(mockUpload).not.toHaveBeenCalled();
    });

    it('updates the demo and writes back', async () => {
      mockDownload.mockResolvedValue(
        makeDownloadResponse(JSON.stringify([DEMO_1, DEMO_2]), '"etag-2"'),
      );

      const store = makeStore();
      const result = await store.updateDemo('demo-1', { title: 'Updated Title' });

      expect(result).toBeDefined();
      expect(result!.id).toBe('demo-1');
      expect(result!.title).toBe('Updated Title');

      const [uploadedBuffer, , uploadOptions] = mockUpload.mock.calls[0];
      const written = JSON.parse(uploadedBuffer.toString('utf-8')) as Demo[];
      expect(written.find((d) => d.id === 'demo-1')?.title).toBe('Updated Title');
      expect(uploadOptions.conditions).toEqual({ ifMatch: '"etag-2"' });
    });

    it('preserves the original id even if updates includes a different id', async () => {
      mockDownload.mockResolvedValue(
        makeDownloadResponse(JSON.stringify([DEMO_1]), '"etag-1"'),
      );

      const store = makeStore();
      const result = await store.updateDemo('demo-1', { id: 'changed-id' } as Partial<Demo>);
      expect(result!.id).toBe('demo-1');
    });
  });

  // ── deleteDemo ──────────────────────────────────────────────────────────────

  describe('deleteDemo', () => {
    it('returns false when demo does not exist', async () => {
      mockDownload.mockResolvedValue(
        makeDownloadResponse(JSON.stringify([DEMO_1]), '"etag-1"'),
      );

      const store = makeStore();
      const result = await store.deleteDemo('unknown');
      expect(result).toBe(false);
      expect(mockUpload).not.toHaveBeenCalled();
    });

    it('removes the demo and writes back', async () => {
      mockDownload.mockResolvedValue(
        makeDownloadResponse(JSON.stringify([DEMO_1, DEMO_2]), '"etag-3"'),
      );

      const store = makeStore();
      const result = await store.deleteDemo('demo-1');
      expect(result).toBe(true);

      const [uploadedBuffer, , uploadOptions] = mockUpload.mock.calls[0];
      const written = JSON.parse(uploadedBuffer.toString('utf-8')) as Demo[];
      expect(written).toHaveLength(1);
      expect(written[0].id).toBe('demo-2');
      expect(uploadOptions.conditions).toEqual({ ifMatch: '"etag-3"' });
    });
  });

  // ── getSettings ─────────────────────────────────────────────────────────────

  describe('getSettings', () => {
    it('returns default settings when blob does not exist', async () => {
      mockDownload.mockRejectedValue(new RestError('not found', { statusCode: 404, code: 'BlobNotFound' }));

      const store = makeStore();
      const settings = await store.getSettings();
      expect(settings).toEqual({ idleTimeoutSeconds: 60, featuredDemoIds: [] });
    });

    it('returns stored settings', async () => {
      const stored: KioskSettings = { idleTimeoutSeconds: 120, featuredDemoIds: ['demo-1'] };
      mockDownload.mockResolvedValue(
        makeDownloadResponse(JSON.stringify(stored), '"etag-s1"'),
      );

      const store = makeStore();
      const settings = await store.getSettings();
      expect(settings).toEqual(stored);
    });
  });

  // ── updateSettings ──────────────────────────────────────────────────────────

  describe('updateSettings', () => {
    it('merges settings and writes back with etag condition', async () => {
      const stored: KioskSettings = { idleTimeoutSeconds: 60, featuredDemoIds: [] };
      mockDownload.mockResolvedValue(
        makeDownloadResponse(JSON.stringify(stored), '"etag-s2"'),
      );

      const store = makeStore();
      const result = await store.updateSettings({ idleTimeoutSeconds: 300 });

      expect(result).toEqual({ idleTimeoutSeconds: 300, featuredDemoIds: [] });

      const [uploadedBuffer, , uploadOptions] = mockUpload.mock.calls[0];
      const written = JSON.parse(uploadedBuffer.toString('utf-8')) as KioskSettings;
      expect(written.idleTimeoutSeconds).toBe(300);
      expect(uploadOptions.conditions).toEqual({ ifMatch: '"etag-s2"' });
    });

    it('uses ifNoneMatch when settings blob does not exist', async () => {
      mockDownload.mockRejectedValue(new RestError('not found', { statusCode: 404, code: 'BlobNotFound' }));

      const store = makeStore();
      await store.updateSettings({ featuredDemoIds: ['demo-1'] });

      const [, , uploadOptions] = mockUpload.mock.calls[0];
      expect(uploadOptions.conditions).toEqual({ ifNoneMatch: '*' });
    });
  });

  // ── ping ─────────────────────────────────────────────────────────────────────

  describe('ping', () => {
    it('resolves when the container is reachable', async () => {
      mockGetProperties.mockResolvedValue({});
      const store = makeStore();
      await expect(store.ping()).resolves.toBeUndefined();
    });

    it('rejects when the container is not reachable', async () => {
      mockGetProperties.mockRejectedValue(new RestError('Unauthorized', { statusCode: 403 }));
      const store = makeStore();
      await expect(store.ping()).rejects.toThrow(RestError);
    });
  });

  // ── initialize ───────────────────────────────────────────────────────────────

  describe('initialize', () => {
    let consoleSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it('seeds demos and settings when both blobs are missing (first-run)', async () => {
      mockDownload.mockRejectedValue(
        new RestError('not found', { statusCode: 404, code: 'BlobNotFound' }),
      );

      const store = makeStore();
      await store.initialize();

      // Two writes: demos.json and settings.json
      expect(mockUpload).toHaveBeenCalledTimes(2);

      // Verify demos.json was seeded with SEED_DEMOS
      const [demosBuffer, , demosOptions] = mockUpload.mock.calls[0];
      const writtenDemos = JSON.parse(demosBuffer.toString('utf-8')) as Demo[];
      expect(writtenDemos).toEqual(SEED_DEMOS);
      expect(demosOptions.conditions).toEqual({ ifNoneMatch: '*' });

      // Verify settings.json was seeded with DEFAULT_SETTINGS
      const [settingsBuffer, , settingsOptions] = mockUpload.mock.calls[1];
      const writtenSettings = JSON.parse(settingsBuffer.toString('utf-8')) as KioskSettings;
      expect(writtenSettings).toEqual(DEFAULT_SETTINGS);
      expect(settingsOptions.conditions).toEqual({ ifNoneMatch: '*' });

      // Verify logging
      expect(consoleSpy).toHaveBeenCalledWith(
        `Seeded ${SEED_DEMOS.length} default demos to blob storage`,
      );
      expect(consoleSpy).toHaveBeenCalledWith('Seeded default settings to blob storage');
    });

    it('does not overwrite existing blobs (loaded state)', async () => {
      const existingDemos = [DEMO_1, DEMO_2];
      const existingSettings: KioskSettings = { idleTimeoutSeconds: 120, featuredDemoIds: ['demo-1'] };

      // First call reads demos.json, second reads settings.json
      mockDownload
        .mockResolvedValueOnce(makeDownloadResponse(JSON.stringify(existingDemos), '"etag-d"'))
        .mockResolvedValueOnce(makeDownloadResponse(JSON.stringify(existingSettings), '"etag-s"'));

      const store = makeStore();
      await store.initialize();

      // No writes should have occurred
      expect(mockUpload).not.toHaveBeenCalled();

      // Verify "loaded" logging
      expect(consoleSpy).toHaveBeenCalledWith(`Loaded ${existingDemos.length} demos from blob storage`);
      expect(consoleSpy).toHaveBeenCalledWith('Loaded settings from blob storage');
    });

    it('handles race condition: another replica created the blob concurrently', async () => {
      // Read returns 404 for both blobs
      mockDownload.mockRejectedValue(
        new RestError('not found', { statusCode: 404, code: 'BlobNotFound' }),
      );

      // Upload fails with 409 (blob already exists — another replica won the race)
      mockUpload.mockRejectedValue(
        new RestError('Conflict', { statusCode: 409 }),
      );

      const store = makeStore();
      // Should not throw — ConcurrencyError is caught and logged
      await store.initialize();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Demos blob was created by another replica; skipping seed',
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        'Settings blob was created by another replica; skipping seed',
      );
    });

    it('throws on non-404 read errors (e.g. auth failure) — does not seed over production data', async () => {
      mockDownload.mockRejectedValue(
        new RestError('Forbidden', { statusCode: 403 }),
      );

      const store = makeStore();
      await expect(store.initialize()).rejects.toThrow(RestError);

      // Ensure no writes were attempted
      expect(mockUpload).not.toHaveBeenCalled();
    });

    it('throws on non-concurrency write errors during seed', async () => {
      // Read returns 404
      mockDownload.mockRejectedValue(
        new RestError('not found', { statusCode: 404, code: 'BlobNotFound' }),
      );

      // Upload fails with a server error (not a concurrency error)
      mockUpload.mockRejectedValue(
        new RestError('Internal Server Error', { statusCode: 500 }),
      );

      const store = makeStore();
      await expect(store.initialize()).rejects.toThrow(RestError);
    });

    it('seeds only the missing blob when one already exists', async () => {
      const existingDemos = [DEMO_1];

      // First call: demos.json exists, second call: settings.json is missing
      mockDownload
        .mockResolvedValueOnce(makeDownloadResponse(JSON.stringify(existingDemos), '"etag-d"'))
        .mockRejectedValueOnce(new RestError('not found', { statusCode: 404, code: 'BlobNotFound' }));

      const store = makeStore();
      await store.initialize();

      // Only settings.json should have been written
      expect(mockUpload).toHaveBeenCalledTimes(1);
      const [settingsBuffer] = mockUpload.mock.calls[0];
      const writtenSettings = JSON.parse(settingsBuffer.toString('utf-8')) as KioskSettings;
      expect(writtenSettings).toEqual(DEFAULT_SETTINGS);

      expect(consoleSpy).toHaveBeenCalledWith(`Loaded ${existingDemos.length} demos from blob storage`);
      expect(consoleSpy).toHaveBeenCalledWith('Seeded default settings to blob storage');
    });

    it('respects existing empty array as user data (does not overwrite)', async () => {
      // User has deliberately emptied the demos array
      mockDownload
        .mockResolvedValueOnce(makeDownloadResponse(JSON.stringify([]), '"etag-empty"'))
        .mockResolvedValueOnce(
          makeDownloadResponse(JSON.stringify(DEFAULT_SETTINGS), '"etag-s"'),
        );

      const store = makeStore();
      await store.initialize();

      // No writes — existing (even empty) data is never overwritten
      expect(mockUpload).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('Loaded 0 demos from blob storage');
    });
  });

  // ── error handling ───────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('throws ConcurrencyError on 412 Precondition Failed during write', async () => {
      mockDownload.mockResolvedValue(
        makeDownloadResponse(JSON.stringify([DEMO_1]), '"etag-stale"'),
      );
      mockUpload.mockRejectedValue(new RestError('ETag mismatch', { statusCode: 412 }));

      const store = makeStore();
      await expect(store.createDemo(DEMO_2)).rejects.toThrow(ConcurrencyError);
    });

    it('throws ConcurrencyError on 409 Conflict during write', async () => {
      mockDownload.mockResolvedValue(
        makeDownloadResponse(JSON.stringify([DEMO_1]), '"etag-stale"'),
      );
      mockUpload.mockRejectedValue(new RestError('Conflict', { statusCode: 409 }));

      const store = makeStore();
      await expect(store.createDemo(DEMO_2)).rejects.toThrow(ConcurrencyError);
    });

    it('re-throws non-concurrency errors from write', async () => {
      mockDownload.mockResolvedValue(
        makeDownloadResponse(JSON.stringify([DEMO_1]), '"etag-1"'),
      );
      mockUpload.mockRejectedValue(new RestError('Service unavailable', { statusCode: 503 }));

      const store = makeStore();
      await expect(store.createDemo(DEMO_2)).rejects.toThrow(RestError);
      await expect(store.createDemo(DEMO_2)).rejects.not.toThrow(ConcurrencyError);
    });

    it('surfaces ContainerNotFound (404) as an error instead of treating it as empty state', async () => {
      mockDownload.mockRejectedValue(
        new RestError('Container not found', { statusCode: 404, code: 'ContainerNotFound' }),
      );

      const store = makeStore();
      await expect(store.getAllDemos()).rejects.toThrow(RestError);
    });

    it('throws a clear error when download response has no readable stream', async () => {
      mockDownload.mockResolvedValue({ etag: '"etag-1"', readableStreamBody: null });

      const store = makeStore();
      await expect(store.getAllDemos()).rejects.toThrow(
        "Blob download returned no readable stream for 'demos.json'",
      );
    });
  });
});
