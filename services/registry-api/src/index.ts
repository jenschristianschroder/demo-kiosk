import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import healthRouter, { setReady } from './routes/health';
import { createDemoRouter } from './routes/demos';
import { createSettingsRouter } from './routes/settings';
import { InMemoryStore } from './store';

const PORT = parseInt(process.env.PORT || '3001', 10);
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';

const app = express();

// Security & parsing
app.use(helmet());
app.use(cors({ origin: CORS_ORIGIN.split(',').map((o) => o.trim()) }));
app.use(express.json());

// Store
const store = new InMemoryStore();

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
