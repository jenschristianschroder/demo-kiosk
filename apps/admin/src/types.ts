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

export const CAPABILITY_TAGS = ['Speech', 'Vision', 'Language', 'Decision', 'Agentic'] as const;
