import { BlobServiceClient, BlockBlobClient, ContainerClient, RestError } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import { Demo, KioskSettings } from '../models';
import { DemoStore } from './interface';
import { SEED_DEMOS, DEFAULT_SETTINGS } from './seed-data';

const DEMOS_BLOB = 'demos.json';
const SETTINGS_BLOB = 'settings.json';

interface BlobReadResult<T> {
  data: T;
  etag: string | undefined;
}

function isBlobNotFound(err: unknown): boolean {
  return err instanceof RestError && err.code === 'BlobNotFound';
}

export class ConcurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConcurrencyError';
  }
}

export class BlobStore implements DemoStore {
  private readonly containerClient: ContainerClient;

  constructor(accountName?: string, containerName?: string) {
    const account = accountName ?? process.env['AZURE_STORAGE_ACCOUNT_NAME'];
    const container = containerName ?? process.env['AZURE_STORAGE_CONTAINER_NAME'];

    if (!account) throw new Error('AZURE_STORAGE_ACCOUNT_NAME is required');
    if (!container) throw new Error('AZURE_STORAGE_CONTAINER_NAME is required');

    const url = `https://${account}.blob.core.windows.net`;
    const serviceClient = new BlobServiceClient(url, new DefaultAzureCredential());
    this.containerClient = serviceClient.getContainerClient(container);
  }

  // ── internal helpers ────────────────────────────────────────────────────────

  private async readBlob<T>(blobName: string): Promise<BlobReadResult<T> | null> {
    const blobClient = this.containerClient.getBlobClient(blobName);
    try {
      const response = await blobClient.download();
      const etag = response.etag;
      const body = response.readableStreamBody;
      if (!body) throw new Error(`Blob download returned no readable stream for '${blobName}'`);
      const chunks: Buffer[] = [];
      for await (const chunk of body) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const text = Buffer.concat(chunks).toString('utf-8');
      return { data: JSON.parse(text) as T, etag };
    } catch (err) {
      if (isBlobNotFound(err)) return null;
      throw err;
    }
  }

  private async writeBlob<T>(blobName: string, data: T, etag?: string): Promise<void> {
    const blockBlobClient: BlockBlobClient = this.containerClient.getBlockBlobClient(blobName);
    const content = JSON.stringify(data, null, 2);
    const buffer = Buffer.from(content, 'utf-8');

    const conditions = etag ? { ifMatch: etag } : { ifNoneMatch: '*' };

    try {
      await blockBlobClient.upload(buffer, buffer.length, {
        blobHTTPHeaders: { blobContentType: 'application/json' },
        conditions,
      });
    } catch (err) {
      if (
        err instanceof RestError &&
        (err.statusCode === 412 || err.statusCode === 409)
      ) {
        throw new ConcurrencyError(
          `Concurrent modification detected for blob '${blobName}'. Please retry.`,
        );
      }
      throw err;
    }
  }

  private async readDemosBlob(): Promise<BlobReadResult<Demo[]>> {
    const result = await this.readBlob<Demo[]>(DEMOS_BLOB);
    return result ?? { data: [], etag: undefined };
  }

  private async readSettingsBlob(): Promise<BlobReadResult<KioskSettings>> {
    const result = await this.readBlob<KioskSettings>(SETTINGS_BLOB);
    return result ?? { data: { ...DEFAULT_SETTINGS }, etag: undefined };
  }

  // ── Startup check ────────────────────────────────────────────────────────────

  async ping(): Promise<void> {
    await this.containerClient.getProperties();
  }

  // ── First-run seed ──────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    // Seed demos.json if it does not exist
    const demosResult = await this.readBlob<Demo[]>(DEMOS_BLOB);
    if (demosResult === null) {
      try {
        await this.writeBlob(DEMOS_BLOB, SEED_DEMOS);
        console.log(`Seeded ${SEED_DEMOS.length} default demos to blob storage`);
      } catch (err) {
        if (err instanceof ConcurrencyError) {
          // Another replica already created the blob — safe to ignore
          console.log('Demos blob was created by another replica; skipping seed');
        } else {
          throw err;
        }
      }
    } else {
      console.log(`Loaded ${demosResult.data.length} demos from blob storage`);
    }

    // Seed settings.json if it does not exist
    const settingsResult = await this.readBlob<KioskSettings>(SETTINGS_BLOB);
    if (settingsResult === null) {
      try {
        await this.writeBlob(SETTINGS_BLOB, DEFAULT_SETTINGS);
        console.log('Seeded default settings to blob storage');
      } catch (err) {
        if (err instanceof ConcurrencyError) {
          console.log('Settings blob was created by another replica; skipping seed');
        } else {
          throw err;
        }
      }
    } else {
      console.log('Loaded settings from blob storage');
    }
  }

  // ── DemoStore implementation ─────────────────────────────────────────────────

  async getAllDemos(): Promise<Demo[]> {
    const { data } = await this.readDemosBlob();
    return data.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async getDemoById(id: string): Promise<Demo | undefined> {
    const { data } = await this.readDemosBlob();
    return data.find((d) => d.id === id);
  }

  async createDemo(demo: Demo): Promise<Demo> {
    const { data, etag } = await this.readDemosBlob();
    data.push(demo);
    await this.writeBlob(DEMOS_BLOB, data, etag);
    return demo;
  }

  async updateDemo(id: string, updates: Partial<Demo>): Promise<Demo | undefined> {
    const { data, etag } = await this.readDemosBlob();
    const index = data.findIndex((d) => d.id === id);
    if (index === -1) return undefined;
    const updated = { ...data[index], ...updates, id };
    data[index] = updated;
    await this.writeBlob(DEMOS_BLOB, data, etag);
    return updated;
  }

  async deleteDemo(id: string): Promise<boolean> {
    const { data, etag } = await this.readDemosBlob();
    const index = data.findIndex((d) => d.id === id);
    if (index === -1) return false;
    data.splice(index, 1);
    await this.writeBlob(DEMOS_BLOB, data, etag);
    return true;
  }

  async getSettings(): Promise<KioskSettings> {
    const { data } = await this.readSettingsBlob();
    return data;
  }

  async updateSettings(settings: Partial<KioskSettings>): Promise<KioskSettings> {
    const { data, etag } = await this.readSettingsBlob();
    const updated = { ...data, ...settings };
    await this.writeBlob(SETTINGS_BLOB, updated, etag);
    return updated;
  }
}
