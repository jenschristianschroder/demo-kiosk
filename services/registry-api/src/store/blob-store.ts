import { BlobServiceClient, BlockBlobClient, RestError } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import { Demo, KioskSettings } from '../models';
import { DemoStore } from './interface';

const DEMOS_BLOB = 'demos.json';
const SETTINGS_BLOB = 'settings.json';

const DEFAULT_SETTINGS: KioskSettings = {
  idleTimeoutSeconds: 60,
  featuredDemoIds: [],
};

interface BlobReadResult<T> {
  data: T;
  etag: string | undefined;
}

function isBlobNotFound(err: unknown): boolean {
  return err instanceof RestError && (err.statusCode === 404 || err.code === 'BlobNotFound');
}

export class BlobStore implements DemoStore {
  private containerClient;

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
      const chunks: Buffer[] = [];
      for await (const chunk of response.readableStreamBody!) {
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

    await blockBlobClient.upload(buffer, buffer.length, {
      blobHTTPHeaders: { blobContentType: 'application/json' },
      conditions,
    });
  }

  private async readDemosBlob(): Promise<BlobReadResult<Demo[]>> {
    const result = await this.readBlob<Demo[]>(DEMOS_BLOB);
    return result ?? { data: [], etag: undefined };
  }

  private async readSettingsBlob(): Promise<BlobReadResult<KioskSettings>> {
    const result = await this.readBlob<KioskSettings>(SETTINGS_BLOB);
    return result ?? { data: { ...DEFAULT_SETTINGS }, etag: undefined };
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
