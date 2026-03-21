import { describe, expect, test } from '@jest/globals';
import { WalletService } from '../src/walletService.js';
import { generate24WordSeedPhrase } from '../src/seedPhrase.js';

describe('WalletService module smoke test', () => {
  test('exports the current wallet service class', () => {
    const service = new WalletService();
    expect(service).toBeInstanceOf(WalletService);
    expect(typeof service.createAgentWallet).toBe('function');
    expect(typeof service.getSolBalance).toBe('function');
    expect(typeof service.sendToken).toBe('function');
  });

  test('seed helper returns a 24-word phrase', () => {
    const seed = generate24WordSeedPhrase();
    expect(seed.trim().split(/\s+/)).toHaveLength(24);
  });
});
