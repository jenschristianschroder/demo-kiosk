export interface Demo {
  id: string;
  title: string;
  description: string;
  demoUrl: string;
  thumbnailUrl: string;
  tags: string[];
  launchMode: 'sameTab' | 'newTab' | 'iframe';
  isActive: boolean;
  sortOrder: number;
  owner: string;
  lastVerifiedAt?: string;
  healthCheckUrl?: string;
}

export interface KioskSettings {
  idleTimeoutSeconds: number;
  featuredDemoIds: string[];
}

export type Capability = 'Speech' | 'Vision' | 'Language' | 'Decision' | 'Agentic';

export const CAPABILITIES: Capability[] = ['Speech', 'Vision', 'Language', 'Decision', 'Agentic'];
