export type PresetName = 'minimal' | 'standard' | 'full';

export interface FeatureFlags {
  waitingRoom: boolean;
  adminPortal: boolean;
  adminApi: boolean;
  waf: boolean;
  edgeConnector: boolean;
  analytics: boolean;
  stripe: boolean;
  enrollBuffer: boolean;
}

const PRESETS: Record<PresetName, FeatureFlags> = {
  minimal: {
    waitingRoom: false,
    adminPortal: false,
    adminApi: false,
    waf: false,
    edgeConnector: false,
    analytics: false,
    stripe: false,
    enrollBuffer: true,
  },
  standard: {
    waitingRoom: true,
    adminPortal: false,
    adminApi: false,
    waf: false,
    edgeConnector: false,
    analytics: false,
    stripe: false,
    enrollBuffer: true,
  },
  full: {
    waitingRoom: true,
    adminPortal: true,
    adminApi: true,
    waf: true,
    edgeConnector: true,
    analytics: true,
    stripe: false,
    enrollBuffer: true,
  },
};

export function resolveFeatures(
  preset: PresetName = 'standard',
  overrides: Partial<FeatureFlags> = {},
): FeatureFlags {
  return { ...PRESETS[preset], ...overrides };
}
