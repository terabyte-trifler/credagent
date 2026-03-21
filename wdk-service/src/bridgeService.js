/**
 * @module BridgeService
 * @description Cross-chain USDT0 bridging via WDK protocol module.
 *
 * T1B.4: Integrates @tetherto/wdk-protocol-bridge-usdt0-evm for
 * moving USDT between Solana ↔ EVM chains (Ethereum, Polygon, Arbitrum).
 *
 * Used by the Yield Agent to reallocate capital cross-chain
 * when better yield opportunities exist on other networks.
 *
 * SECURITY:
 * - Bridge fee capped by bridgeMaxFee config
 * - Recipient address validated per target chain format
 * - Amount validated against safety cap
 * - All bridge ops logged to audit trail
 * - Bridge is EVM-side only for now (WDK USDT0 bridge module is EVM-based)
 *
 * ARCHITECTURE NOTE:
 * The WDK USDT0 bridge module (@tetherto/wdk-protocol-bridge-usdt0-evm)
 * operates from the EVM side. To bridge FROM Solana TO EVM, you would:
 * 1. Use WDK Solana wallet to transfer USDT to a Solana bridge endpoint
 * 2. Use WDK EVM wallet with bridge module to claim on the EVM side
 *
 * For the hackathon demo, we initialize the EVM-side bridge and show
 * the cross-chain capability. Full Solana-native bridging requires
 * the USDT0 Solana module when it ships.
 */

import WDK from '@tetherto/wdk';
import WalletManagerEvm from '@tetherto/wdk-wallet-evm';
import Usdt0ProtocolEvm from '@tetherto/wdk-protocol-bridge-usdt0-evm';
import { validate } from './validation.js';
import { AuditLog } from './auditLog.js';
import { generate24WordSeedPhrase } from './seedPhrase.js';

// ═══════════════════════════════════════════
// Supported bridge target chains
// ═══════════════════════════════════════════
const SUPPORTED_TARGETS = new Set([
  'ethereum', 'arbitrum', 'optimism', 'polygon',
  'solana', 'ton', 'tron', 'avalanche', 'celo',
]);

const EVM_ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const MAX_BRIDGE_FEE = 1_000_000_000_000_000n; // 0.001 ETH
const MAX_BRIDGE_AMOUNT = 1_000_000_000_000n;  // 1M USDT (6 dec)

export class BridgeService {
  #evmWdk = null;
  #evmAccount = null;
  #bridgeProtocol = null;
  #initialized = false;
  #audit;
  #config;

  /**
   * @param {object} config
   * @param {string} config.evmRpcUrl EVM RPC endpoint
   * @param {string} [config.evmSeed] optional seed for EVM wallet (generates new if omitted)
   * @param {bigint} [config.bridgeMaxFee]
   */
  constructor(config = {}) {
    this.#config = {
      evmRpcUrl: config.evmRpcUrl || process.env.EVM_RPC_URL || 'https://eth.drpc.org',
      bridgeMaxFee: config.bridgeMaxFee || MAX_BRIDGE_FEE,
    };
    this.#audit = config.audit || new AuditLog();
  }

  /**
   * Initialize the EVM-side bridge wallet and USDT0 protocol.
   *
   * SECURITY: EVM seed generated fresh if not provided.
   * In production, use the same agent identity across chains via WDK multi-chain.
   *
   * @param {string} [evmSeed] optional 24-word BIP-39 seed for EVM wallet
   * @returns {Promise<{evmAddress: string, bridgeReady: boolean}>}
   */
  async initialize(evmSeed) {
    if (this.#initialized) {
      return { evmAddress: await this.#evmAccount.getAddress(), bridgeReady: true };
    }

    const t0 = performance.now();
    const seed = evmSeed || generate24WordSeedPhrase();

    this.#evmWdk = new WDK(seed).registerWallet('ethereum', WalletManagerEvm, {
      provider: this.#config.evmRpcUrl,
      transferMaxFee: Number(this.#config.bridgeMaxFee),
    });

    this.#evmAccount = await this.#evmWdk.getAccount('ethereum', 0);
    const evmAddress = await this.#evmAccount.getAddress();

    // Initialize USDT0 bridge protocol
    this.#bridgeProtocol = new Usdt0ProtocolEvm(this.#evmAccount, {
      bridgeMaxFee: this.#config.bridgeMaxFee,
    });

    this.#initialized = true;

    this.#audit.log('bridgeInit', 'system', { chain: 'ethereum' }, evmAddress, performance.now() - t0);

    return { evmAddress, bridgeReady: true };
  }

  /**
   * Get supported bridge target chains.
   * @returns {string[]}
   */
  getSupportedChains() {
    return [...SUPPORTED_TARGETS];
  }

  /**
   * Bridge USDT0 from EVM to another chain.
   *
   * SECURITY:
   * - Target chain validated against whitelist
   * - Recipient address format validated per chain family
   * - Amount validated against safety cap
   * - Token address validated as EVM address
   * - Bridge max fee enforced by WDK config
   *
   * @param {string} targetChain e.g., 'arbitrum', 'polygon', 'solana'
   * @param {string} recipient address on target chain
   * @param {string} tokenAddress USDT contract on source chain
   * @param {string|bigint} amount in token smallest units
   * @returns {Promise<{txHash: string, targetChain: string, recipient: string, amount: string}>}
   */
  async bridge(targetChain, recipient, tokenAddress, amount) {
    if (!this.#initialized) {
      throw new Error('BRIDGE_NOT_INIT: Call initialize() first');
    }

    // AUDIT: Validate target chain
    if (!SUPPORTED_TARGETS.has(targetChain)) {
      throw new Error(`UNSUPPORTED_CHAIN: "${targetChain}" not in supported list`);
    }

    // AUDIT: Validate recipient per chain family
    this.#validateRecipient(targetChain, recipient);

    // AUDIT: Validate token address (EVM format on source chain)
    if (!EVM_ADDRESS_REGEX.test(tokenAddress)) {
      throw new Error(`INVALID_TOKEN: "${tokenAddress}" is not a valid EVM address`);
    }

    // AUDIT: Validate amount
    const validAmount = validate.amount(amount, MAX_BRIDGE_AMOUNT);

    const t0 = performance.now();

    const tx = await this.#bridgeProtocol.bridge(
      targetChain,
      recipient,
      tokenAddress,
      validAmount,
    );

    const result = {
      txHash: tx.hash || tx.transactionHash || String(tx),
      targetChain,
      recipient: recipient.slice(0, 12) + '...',
      amount: String(validAmount),
    };

    this.#audit.log('bridge', 'yield-agent', {
      target: targetChain,
      recipient: recipient.slice(0, 8) + '...',
      amount: String(validAmount),
    }, result.txHash, performance.now() - t0);

    return result;
  }

  /**
   * Get the EVM wallet address used for bridging.
   * @returns {Promise<string>}
   */
  async getEvmAddress() {
    if (!this.#initialized) throw new Error('BRIDGE_NOT_INIT');
    return this.#evmAccount.getAddress();
  }

  /**
   * Get EVM native balance (ETH) for gas checks.
   * @returns {Promise<{wei: string, eth: string}>}
   */
  async getEvmBalance() {
    if (!this.#initialized) throw new Error('BRIDGE_NOT_INIT');
    const balance = await this.#evmAccount.getBalance();
    return {
      wei: String(balance),
      eth: (Number(balance) / 1e18).toFixed(8),
    };
  }

  /**
   * Check if bridge is initialized and ready.
   * @returns {boolean}
   */
  get isReady() {
    return this.#initialized;
  }

  // ─── Private ───────────────────────────

  /**
   * Validate recipient address format for target chain.
   * AUDIT: Each chain family has different address format.
   */
  #validateRecipient(chain, recipient) {
    if (['solana'].includes(chain)) {
      if (!SOLANA_ADDRESS_REGEX.test(recipient)) {
        throw new Error(`INVALID_RECIPIENT: "${recipient.slice(0, 12)}" not valid Solana address`);
      }
    } else if (['ton', 'tron'].includes(chain)) {
      if (!recipient || recipient.length < 10) {
        throw new Error(`INVALID_RECIPIENT: "${recipient.slice(0, 12)}" too short for ${chain}`);
      }
    } else {
      // EVM chains
      if (!EVM_ADDRESS_REGEX.test(recipient)) {
        throw new Error(`INVALID_RECIPIENT: "${recipient.slice(0, 12)}" not valid EVM address`);
      }
    }
  }
}

export default BridgeService;
