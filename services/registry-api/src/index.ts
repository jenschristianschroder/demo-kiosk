import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import healthRouter, { setReady } from './routes/health';
import { createDemoRouter } from './routes/demos';
import { createSettingsRouter } from './routes/settings';
import { BlobStore, selectStore } from './store';

const PORT = parseInt(process.env.PORT || '3001', 10);
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';

const app = express();

// Security & parsing
app.use(helmet());
app.use(cors({ origin: CORS_ORIGIN.split(',').map((o) => o.trim()) }));
app.use(express.json());

// Store — select backend from STORE_BACKEND env var (default: memory)
let store: ReturnType<typeof selectStore>;
try {
  store = selectStore(process.env.STORE_BACKEND);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

if (store instanceof BlobStore) {
  console.log(
    `Store backend: blob (account: ${process.env.AZURE_STORAGE_ACCOUNT_NAME}, container: ${process.env.AZURE_STORAGE_CONTAINER_NAME})`,
  );
} else {
  console.log('Store backend: memory');
}

// Routes
app.use('/health', healthRouter);
app.use('/api/demos', createDemoRouter(store));
app.use('/api/settings', createSettingsRouter(store));

// Startup: verify blob connectivity before marking the service ready
async function startup(): Promise<void> {
  if (store instanceof BlobStore) {
    try {
      await store.ping();
    } catch (err) {
      console.error(
        'Blob store connectivity check failed. Ensure the container exists and the service has the required access.',
        (err as Error).message,
      );
      process.exit(1);
    }
  }
  setReady(true);
}

// Start — server begins listening immediately so liveness/startup probes succeed;
// readiness is deferred until the blob connectivity check passes.
app.listen(PORT, () => {
  console.log(`Registry API listening on port ${PORT}`);
  void startup();
});

export default app;
