import { Demo, KioskSettings } from '../models';
import { DemoStore } from './interface';
import { SEED_DEMOS, DEFAULT_SETTINGS } from './seed-data';

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
