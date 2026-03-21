import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';

// Mocha compatibility aliases for the existing Anchor test files.
// This lets us use Vitest without rewriting every suite hook immediately.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).before = beforeAll;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).after = afterAll;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).beforeEach = beforeEach;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).afterEach = afterEach;
