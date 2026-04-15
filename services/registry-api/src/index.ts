import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import healthRouter, { setReady } from './routes/health';
import { createDemoRouter } from './routes/demos';
import { createSettingsRouter } from './routes/settings';
import { InMemoryStore, BlobStore } from './store';

const PORT = parseInt(process.env.PORT || '3001', 10);
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';
const STORE_BACKEND = process.env.STORE_BACKEND || 'memory';

const app = express();

// Security & parsing
app.use(helmet());
app.use(cors({ origin: CORS_ORIGIN.split(',').map((o) => o.trim()) }));
app.use(express.json());

// Store
const VALID_STORE_BACKENDS = ['memory', 'blob'] as const;
type StoreBackend = (typeof VALID_STORE_BACKENDS)[number];

if (!VALID_STORE_BACKENDS.includes(STORE_BACKEND as StoreBackend)) {
  console.error(
    `Invalid STORE_BACKEND value '${STORE_BACKEND}'. Valid options are: ${VALID_STORE_BACKENDS.join(', ')}`,
  );
  process.exit(1);
}

let store: InMemoryStore | BlobStore;
if (STORE_BACKEND === 'blob') {
  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;
  if (!accountName) {
    console.error(
      'AZURE_STORAGE_ACCOUNT_NAME is required when STORE_BACKEND=blob. Set the environment variable or change STORE_BACKEND to memory.',
    );
    process.exit(1);
  }
  if (!containerName) {
    console.error(
      'AZURE_STORAGE_CONTAINER_NAME is required when STORE_BACKEND=blob. Set the environment variable or change STORE_BACKEND to memory.',
    );
    process.exit(1);
  }
  store = new BlobStore(accountName, containerName);
  console.log(`Store backend: blob (account: ${accountName}, container: ${containerName})`);
} else {
  store = new InMemoryStore();
  console.log('Store backend: memory');
}

// Routes
app.use('/health', healthRouter);
app.use('/api/demos', createDemoRouter(store));
app.use('/api/settings', createSettingsRouter(store));

// Start
app.listen(PORT, () => {
  setReady(true);
  console.log(`Registry API listening on port ${PORT}`);
});

export default app;
