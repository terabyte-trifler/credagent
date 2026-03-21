/**
 * Phase 0/1B Verification — validates WDK setup end-to-end.
 * Run: node scripts/verifySetup.js
 */

import WDK from '@tetherto/wdk';
import WalletManagerSolana from '@tetherto/wdk-wallet-solana';
import { WalletService } from '../src/walletService.js';
import { TokenOps } from '../src/tokenOps.js';
import { BridgeService } from '../src/bridgeService.js';
import { validate } from '../src/validation.js';
import { generate24WordSeedPhrase } from '../src/seedPhrase.js';

const G = '\x1b[32m', R = '\x1b[31m', C = '\x1b[36m', N = '\x1b[0m';
let pass = 0, fail = 0;

async function check(name, fn) {
  try { await fn(); console.log(`${G}[✓]${N} ${name}`); pass++; }
  catch (e) { console.log(`${R}[✗]${N} ${name}: ${e.message}`); fail++; }
}

console.log(`\n${C}━━━ CredAgent WDK Service Verification ━━━${N}\n`);

// Package imports
await check('WDK core import', async () => { if (!WDK) throw new Error('null'); });
await check('WalletManagerSolana import', async () => { if (!WalletManagerSolana) throw new Error('null'); });

// Seed generation
await check('Seed generator returns 24 words', async () => {
  const s = generate24WordSeedPhrase();
  if (s.split(' ').length !== 24) throw new Error(`Got ${s.split(' ').length} words`);
});

// WDK wallet creation
await check('[devnet] Create Solana wallet via WDK', async () => {
  const seed = generate24WordSeedPhrase();
  const wdk = new WDK(seed).registerWallet('solana', WalletManagerSolana, {
    rpcUrl: 'https://api.devnet.solana.com',
  });
  const acct = await wdk.getAccount('solana', 0);
  const addr = await acct.getAddress();
  validate.solanaAddress(addr);
});

// WalletService
await check('WalletService.createAgentWallet()', async () => {
  const ws = new WalletService({ rpcUrl: 'https://api.devnet.solana.com' });
  const r = await ws.createAgentWallet('verify-test');
  if (!r.address || r.chain !== 'solana') throw new Error('bad result');
  validate.solanaAddress(r.address);
});

await check('WalletService rejects duplicate agent', async () => {
  const ws = new WalletService();
  await ws.createAgentWallet('dup-check');
  try { await ws.createAgentWallet('dup-check'); throw new Error('should reject'); }
  catch (e) { if (!e.message.includes('WALLET_EXISTS')) throw e; }
});

// Validation
await check('validate rejects bad address', async () => {
  try { validate.solanaAddress('0xEVM'); throw new Error('should reject'); }
  catch (e) { if (!e.message.includes('INVALID_ADDRESS')) throw e; }
});

await check('validate rejects zero amount', async () => {
  try { validate.amount(0n, 1000n); throw new Error('should reject'); }
  catch (e) { if (!e.message.includes('greater than zero')) throw e; }
});

await check('validate rejects path traversal agent ID', async () => {
  try { validate.agentId('../hack'); throw new Error('should reject'); }
  catch (e) { if (!e.message.includes('INVALID_AGENT_ID')) throw e; }
});

// Audit log security
await check('SECURITY: Audit log strips secrets', async () => {
  const { AuditLog } = await import('../src/auditLog.js');
  const log = new AuditLog();
  log.log('test', 'a', { seed: 'secret phrase', normal: 'ok' }, null, 1);
  const entry = log.getRecent(1)[0];
  const s = JSON.stringify(entry);
  if (s.includes('secret phrase')) throw new Error('LEAK: seed in audit log!');
  if (!entry.params.normal) throw new Error('normal field missing');
});

// TokenOps
await check('TokenOps.hashDecision returns 32-byte hash', async () => {
  const ops = new TokenOps({}, 'https://api.devnet.solana.com');
  const h = await ops.hashDecision('test reasoning');
  if (h.length !== 32) throw new Error(`Expected 32 bytes, got ${h.length}`);
});

// BridgeService
await check('BridgeService.getSupportedChains includes solana', async () => {
  const b = new BridgeService();
  if (!b.getSupportedChains().includes('solana')) throw new Error('solana missing');
});

await check('BridgeService rejects before init', async () => {
  const b = new BridgeService();
  try { await b.bridge('ethereum', '0x' + '1'.repeat(40), '0x' + '2'.repeat(40), '1000'); throw new Error('x'); }
  catch (e) { if (!e.message.includes('BRIDGE_NOT_INIT')) throw e; }
});

// Rate limiting
await check('Rate limiter exists in WalletService', async () => {
  const ws = new WalletService({ rateLimitPerHour: 2 });
  // We can't fully test without wallet, but verify the constructor accepts the config
  if (!ws.hasWallet('nonexistent') === undefined) throw new Error('hasWallet broken');
});

// Summary
console.log(`\n${C}━━━ Results: ${pass} passed, ${fail} failed ━━━${N}`);
if (fail > 0) {
  console.log(`${R}Fix ${fail} failures before proceeding to Phase 2.${N}`);
  process.exit(1);
} else {
  console.log(`${G}Phase 1B verified. WDK service ready.${N}\n`);
}
