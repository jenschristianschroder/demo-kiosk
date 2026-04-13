import { Demo, KioskSettings } from '../models';
import { DemoStore } from './interface';

const SEED_DEMOS: Demo[] = [
  {
    id: 'demo-speech-1',
    title: 'Speech-to-Text Live Transcription',
    description: 'Real-time transcription of spoken language using Azure AI Speech services.',
    demoUrl: 'https://speech.example.com/transcription',
    thumbnailUrl: '/thumbnails/speech.png',
    tags: ['Speech', 'Transcription', 'Azure AI'],
    launchMode: 'sameTab',
    isActive: true,
    sortOrder: 1,
    owner: 'demo-team@microsoft.com',
  },
  {
    id: 'demo-vision-1',
    title: 'Computer Vision Object Detection',
    description: 'Detect and classify objects in images using Azure Computer Vision.',
    demoUrl: 'https://vision.example.com/detection',
    thumbnailUrl: '/thumbnails/vision.png',
    tags: ['Vision', 'Object Detection', 'Azure AI'],
    launchMode: 'sameTab',
    isActive: true,
    sortOrder: 2,
    owner: 'demo-team@microsoft.com',
  },
  {
    id: 'demo-language-1',
    title: 'Language Understanding & Sentiment',
    description: 'Analyze text for sentiment, key phrases, and language understanding.',
    demoUrl: 'https://language.example.com/sentiment',
    thumbnailUrl: '/thumbnails/language.png',
    tags: ['Language', 'Sentiment Analysis', 'Azure AI'],
    launchMode: 'sameTab',
    isActive: true,
    sortOrder: 3,
    owner: 'demo-team@microsoft.com',
  },
  {
    id: 'demo-decision-1',
    title: 'Anomaly Detection Dashboard',
    description: 'Detect anomalies in time-series data using AI-powered decision services.',
    demoUrl: 'https://decision.example.com/anomaly',
    thumbnailUrl: '/thumbnails/decision.png',
    tags: ['Decision', 'Anomaly Detection', 'Azure AI'],
    launchMode: 'sameTab',
    isActive: true,
    sortOrder: 4,
    owner: 'demo-team@microsoft.com',
  },
  {
    id: 'demo-agentic-1',
    title: 'Agentic AI Workflow Orchestrator',
    description: 'Autonomous AI agents collaborating to complete complex multi-step tasks.',
    demoUrl: 'https://agentic.example.com/workflow',
    thumbnailUrl: '/thumbnails/agentic.png',
    tags: ['Agentic', 'Workflow', 'Azure AI'],
    launchMode: 'sameTab',
    isActive: true,
    sortOrder: 5,
    owner: 'demo-team@microsoft.com',
  },
];

const DEFAULT_SETTINGS: KioskSettings = {
  idleTimeoutSeconds: 60,
  featuredDemoIds: [],
};

export class InMemoryStore implements DemoStore {
  private demos: Map<string, Demo>;
  private settings: KioskSettings;

  constructor() {
    this.demos = new Map();
    SEED_DEMOS.forEach((d) => this.demos.set(d.id, { ...d }));
    this.settings = { ...DEFAULT_SETTINGS };
  }

  async getAllDemos(): Promise<Demo[]> {
    return Array.from(this.demos.values()).sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async getDemoById(id: string): Promise<Demo | undefined> {
    return this.demos.get(id);
  }

  async createDemo(demo: Demo): Promise<Demo> {
    this.demos.set(demo.id, demo);
    return demo;
  }

  async updateDemo(id: string, updates: Partial<Demo>): Promise<Demo | undefined> {
    const existing = this.demos.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates, id };
    this.demos.set(id, updated);
    return updated;
  }

  async deleteDemo(id: string): Promise<boolean> {
    return this.demos.delete(id);
  }

  async getSettings(): Promise<KioskSettings> {
    return { ...this.settings };
  }

  async updateSettings(settings: Partial<KioskSettings>): Promise<KioskSettings> {
    this.settings = { ...this.settings, ...settings };
    return { ...this.settings };
  }
}
