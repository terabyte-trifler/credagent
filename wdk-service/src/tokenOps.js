/**
 * @module tokenOps
 * @description SPL token approve (delegation) and message signing.
 *
 * T1B.2: SPL approve — allows collection agent to pull installments
 * T1B.3: signMessage — Ed25519 signatures for decision audit trails
 *
 * SECURITY:
 * - approve() validates delegate address, amount, and mint
 * - Delegation amount is EXACT (not unlimited) — prevents over-pull
 * - signMessage returns signature only, NEVER the signing key
 * - Message length capped to prevent memory abuse
 */

import {
  Connection,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { validate } from './validation.js';
import { AuditLog } from './auditLog.js';

/**
 * Extended token operations that build on WalletService.
 * Takes a WalletService instance and adds approve + sign capabilities.
 */
export class TokenOps {
  #walletService;
  #rpcUrl;
  #audit;

  /**
   * @param {import('./walletService.js').WalletService} walletService
   * @param {string} rpcUrl
   * @param {AuditLog} audit
   */
  constructor(walletService, rpcUrl, audit) {
    this.#walletService = walletService;
    this.#rpcUrl = rpcUrl;
    this.#audit = audit || new AuditLog();
  }

  // ═══════════════════════════════════════
  // T1B.2 — SPL Token Approve (Delegation)
  // ═══════════════════════════════════════

  /**
   * Approve a delegate (e.g., collection agent) to spend SPL tokens
   * from the agent's token account. Used for installment auto-pull.
   *
   * SECURITY:
   * - Delegate validated as base58 Solana address
   * - Amount is EXACT — not u64::MAX (prevents unlimited spending)
   * - Token mint validated
   * - Only the agent wallet (owner) can approve
   *
   * @param {string} agentId owner agent
   * @param {string} delegatePubkey collection agent's pubkey
   * @param {string|bigint} amount exact amount to approve (token smallest units)
   * @param {string} tokenMint SPL token mint address
   * @returns {Promise<{txHash: string, delegate: string, amount: string}>}
   */
  async approveDelegate(agentId, delegatePubkey, amount, tokenMint) {
    validate.agentId(agentId);
    validate.solanaAddress(delegatePubkey);
    validate.solanaAddress(tokenMint);
    const validAmount = validate.amount(amount, 1_000_000_000_000_000n); // 1B tokens max

    const t0 = performance.now();
    const account = this.#walletService.getAccount(agentId);
    const ownerAddress = this.#walletService.getAddress(agentId);

    // AUDIT: Prevent approving self as delegate (useless, smells like a bug)
    if (delegatePubkey === ownerAddress) {
      throw new Error('SELF_DELEGATE: Cannot approve self as delegate');
    }

    const connection = new Connection(this.#rpcUrl, 'confirmed');
    const ownerPubkey = new PublicKey(ownerAddress);
    const mintPubkey = new PublicKey(tokenMint);
    const delegatePub = new PublicKey(delegatePubkey);

    // Derive the agent's associated token account for this mint
    const ownerAta = await Token.getAssociatedTokenAddress(
      undefined,
      TOKEN_PROGRAM_ID,
      mintPubkey,
      ownerPubkey,
    );

    // Build approve instruction
    // AUDIT: Amount is exact BigInt — NOT u64::MAX
    const approveIx = Token.createApproveInstruction(
      ownerAta,           // source token account
      delegatePub,        // delegate
      ownerPubkey,        // owner
      BigInt(validAmount), // exact amount
      [],                 // no multi-sig
    );

    // Sign via WDK's internal signer
    // NOTE: WDK account.signTransaction() handles Ed25519 signing internally
    const tx = new Transaction().add(approveIx);
    tx.feePayer = ownerPubkey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    // WDK signing: the account object can sign transactions
    const signedTx = await account.signTransaction(tx);
    const txHash = await connection.sendRawTransaction(signedTx.serialize());
    await connection.confirmTransaction(txHash, 'confirmed');

    const result = {
      txHash,
      delegate: delegatePubkey,
      amount: String(validAmount),
    };

    this.#audit.log('approveDelegate', agentId, {
      delegate: delegatePubkey.slice(0, 8) + '...',
      amount: String(validAmount),
      mint: tokenMint.slice(0, 8) + '...',
    }, txHash, performance.now() - t0);

    return result;
  }

  /**
   * Revoke all delegations on a token account.
   * Useful when changing collection agents or as emergency measure.
   *
   * @param {string} agentId
   * @param {string} tokenMint
   * @returns {Promise<{txHash: string}>}
   */
  async revokeDelegate(agentId, tokenMint) {
    validate.agentId(agentId);
    validate.solanaAddress(tokenMint);

    const t0 = performance.now();
    const account = this.#walletService.getAccount(agentId);
    const ownerAddress = this.#walletService.getAddress(agentId);
    const connection = new Connection(this.#rpcUrl, 'confirmed');

    const ownerPubkey = new PublicKey(ownerAddress);
    const mintPubkey = new PublicKey(tokenMint);
    const ownerAta = await Token.getAssociatedTokenAddress(
      undefined,
      TOKEN_PROGRAM_ID,
      mintPubkey,
      ownerPubkey,
    );

    // Revoke all delegate authority on the token account.
    const revokeIx = Token.createRevokeInstruction(
      ownerAta,
      ownerPubkey,
      [],
    );

    const tx = new Transaction().add(revokeIx);
    tx.feePayer = ownerPubkey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    const signedTx = await account.signTransaction(tx);
    const txHash = await connection.sendRawTransaction(signedTx.serialize());
    await connection.confirmTransaction(txHash, 'confirmed');

    this.#audit.log('revokeDelegate', agentId, { mint: tokenMint.slice(0, 8) + '...' }, txHash, performance.now() - t0);
    return { txHash };
  }

  // ═══════════════════════════════════════
  // T1B.3 — Message Signing
  // ═══════════════════════════════════════

  /**
   * Sign an arbitrary message with the agent's Ed25519 key.
   * Used for decision audit trails (hash agent reasoning → sign → store on-chain).
   *
   * SECURITY:
   * - Returns ONLY {signature, signer} — NEVER the signing key
   * - Message length capped at 10KB to prevent memory abuse
   * - Signer field is the public address (verifiable by anyone)
   *
   * @param {string} agentId
   * @param {string} message arbitrary message to sign
   * @returns {Promise<{signature: string, signer: string}>}
   */
  async signMessage(agentId, message) {
    validate.agentId(agentId);
    validate.message(message);

    const t0 = performance.now();
    const account = this.#walletService.getAccount(agentId);
    const address = this.#walletService.getAddress(agentId);

    // WDK's signMessage returns an Ed25519 signature
    const signature = await account.signMessage(message);

    const result = {
      signature: typeof signature === 'string' ? signature : Buffer.from(signature).toString('hex'),
      signer: address,
    };

    // AUDIT[S2]: Only log message length, not content (could contain sensitive data)
    this.#audit.log('signMessage', agentId, { msgLength: message.length }, 'signed', performance.now() - t0);

    return result;
  }

  /**
   * Hash a decision/reasoning string for on-chain audit trail.
   * Returns a 32-byte hash suitable for Solana program storage.
   *
   * @param {string} reasoning agent's decision reasoning text
   * @returns {Uint8Array} 32-byte SHA-256 hash
   */
  async hashDecision(reasoning) {
    validate.message(reasoning, 100_000); // 100KB max for reasoning
    const encoder = new TextEncoder();
    const data = encoder.encode(reasoning);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return new Uint8Array(hashBuffer);
  }
}

export default TokenOps;
