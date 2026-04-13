import { Demo, KioskSettings } from '../models';

export interface DemoStore {
  getAllDemos(): Promise<Demo[]>;
  getDemoById(id: string): Promise<Demo | undefined>;
  createDemo(demo: Demo): Promise<Demo>;
  updateDemo(id: string, updates: Partial<Demo>): Promise<Demo | undefined>;
  deleteDemo(id: string): Promise<boolean>;
  getSettings(): Promise<KioskSettings>;
  updateSettings(settings: Partial<KioskSettings>): Promise<KioskSettings>;
}
