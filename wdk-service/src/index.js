/**
 * @module @credagent/wdk-service
 * @description Entry point for the CredAgent WDK wallet service.
 *
 * Exports:
 * - WalletService: Core wallet ops (create, balance, send)
 * - TokenOps: SPL approve/revoke + message signing
 * - BridgeService: USDT0 cross-chain bridging
 * - AuditLog: Operation logging
 * - validate: Input validation helpers
 */

export { WalletService } from './walletService.js';
export { TokenOps } from './tokenOps.js';
export { BridgeService } from './bridgeService.js';
export { AuditLog } from './auditLog.js';
export { validate } from './validation.js';

/**
 * Quick-start factory: creates all services wired together.
 *
 * @param {object} config
 * @returns {Promise<{ wallet: WalletService, tokenOps: TokenOps, bridge: BridgeService, audit: AuditLog }>}
 */
export async function createCredAgentServices(config = {}) {
  const { WalletService: WS } = await import('./walletService.js');
  const { TokenOps: TO } = await import('./tokenOps.js');
  const { BridgeService: BS } = await import('./bridgeService.js');
  const { AuditLog: AL } = await import('./auditLog.js');

  const audit = new AL();
  const wallet = new WS(config);
  const tokenOps = new TO(wallet, config.rpcUrl || 'https://api.devnet.solana.com', audit);
  const bridge = new BS({ ...config, audit });

  return { wallet, tokenOps, bridge, audit };
}
