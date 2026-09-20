import type { RuleSpec } from './types.ts';

export const RULES: Record<string, RuleSpec> = {
  '2025.1': {
    version: '2025.1',
    description:
      'Affine+SIP-like polynomial distortion (orders 0-3), quad seeding, inclusive residual boundary, quadrant atan2 rotation.',
    numerical: { tolInclusion: 'inclusive', boundaryEps: 1e-9, angleWrapDeg: 360 },
  },
};

export const CURRENT_RULES_VERSION = '2025.1';
