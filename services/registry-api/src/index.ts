import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import healthRouter, { setReady, setReadinessChecker } from './routes/health';
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
  // Register an async readiness checker so /health/ready continuously
  // verifies blob storage connectivity (result is cached with a 30s TTL
  // inside the health router).
  setReadinessChecker(() => store.ping());
} else {
  console.log('Store backend: memory');
}

// Routes
app.use('/health', healthRouter);
app.use('/api/demos', createDemoRouter(store));
app.use('/api/settings', createSettingsRouter(store));

// Startup: verify blob connectivity before marking the service ready.
// Retries with exponential backoff to handle RBAC role propagation delay
// (up to ~10 minutes after bootstrap.sh assigns Storage Blob Data Contributor).
const STARTUP_MAX_RETRIES = 20;
const STARTUP_INITIAL_DELAY_MS = 5_000;
const STARTUP_MAX_DELAY_MS = 30_000;

async function startup(): Promise<void> {
  if (store instanceof BlobStore) {
    let delay = STARTUP_INITIAL_DELAY_MS;
    for (let attempt = 1; attempt <= STARTUP_MAX_RETRIES; attempt++) {
      try {
        await store.ping();
        console.log(`Blob store connectivity check passed (attempt ${attempt}).`);
        break;
      } catch (err) {
        console.warn(
          `Blob store connectivity check failed (attempt ${attempt}/${STARTUP_MAX_RETRIES}): ${(err as Error).message}`,
        );
        if (attempt === STARTUP_MAX_RETRIES) {
          console.error(
            'Blob store connectivity check exhausted all retries. Marking service as ready anyway; ' +
              'the readiness probe will report not-ready until blob storage becomes reachable.',
          );
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, STARTUP_MAX_DELAY_MS);
      }
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
