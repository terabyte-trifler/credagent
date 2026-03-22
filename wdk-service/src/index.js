/**
 * @module @credagent/wdk-service
 * @description Entry point for the CredAgent WDK wallet service.
 *
 * Exports:
 * - WalletService: Core wallet ops (create, balance, send)
 * - TokenOps: SPL approve/revoke + message signing
 * - BridgeService: USDT0 cross-chain bridging
 * - MCPBridge: OpenClaw MCP dispatcher for wallet/credit/payment tools
 * - AuditLog: Operation logging
 * - validate: Input validation helpers
 */

export { WalletService } from './walletService.js';
export { TokenOps } from './tokenOps.js';
export { BridgeService } from './bridgeService.js';
export { MCPBridge } from './mcpBridge.js';
export { SafetyMiddleware } from './safetyMiddleware.js';
export { createServices as createMcpServices, createHttpServer, startServer } from './mcpServer.js';
export { ALL_TOOLS, TOOL_MAP } from './toolDefs.js';
export { validate as mcpValidate } from './safetyLayer.js';
export { AuditLog } from './auditLog.js';
export { validate } from './validation.js';

/**
 * Quick-start factory: creates all services wired together.
 *
 * @param {object} config
 * @returns {Promise<{ wallet: WalletService, tokenOps: TokenOps, bridge: BridgeService, audit: AuditLog, mcp: MCPBridge, safeMcp: SafetyMiddleware }>}
 */
export async function createCredAgentServices(config = {}) {
  const { WalletService: WS } = await import('./walletService.js');
  const { TokenOps: TO } = await import('./tokenOps.js');
  const { BridgeService: BS } = await import('./bridgeService.js');
  const { MCPBridge: MB } = await import('./mcpBridge.js');
  const { SafetyMiddleware: SM } = await import('./safetyMiddleware.js');
  const { AuditLog: AL } = await import('./auditLog.js');

  const audit = new AL();
  const wallet = new WS(config);
  const tokenOps = new TO(wallet, config.rpcUrl || 'https://api.devnet.solana.com', audit);
  const bridge = new BS({ ...config, audit });
  const mcp = new MB({ walletService: wallet, tokenOps, bridgeService: bridge }, config);
  const safeMcp = new SM(mcp, config.safety || {});

  return { wallet, tokenOps, bridge, audit, mcp, safeMcp };
}
