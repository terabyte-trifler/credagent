import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['vitest.setup.ts'],
    include: [
      'tests/integration/01_golden_path.ts',
      'tests/integration/02_default_path.ts',
      'tests/integration/03_to_08_scenarios.ts',
      'tests/security/attack_vectors.ts',
      'tests/security/escrow_unauthorized.ts',
    ],
  },
});
