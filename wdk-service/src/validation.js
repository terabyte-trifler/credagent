/**
 * @module validation
 * @description Centralized input validation for WDK service.
 *
 * AUDIT: Every public method in WalletService calls these BEFORE any RPC/WDK call.
 * All validators throw descriptive errors on failure — never return false silently.
 * No validation logic is duplicated across files.
 */

/** Base58 alphabet used by Solana (excludes 0, O, I, l) */
const BASE58_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Agent ID: 1-64 alphanumeric + hyphens/underscores. No path traversal. */
const AGENT_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

export const validate = {
  /**
   * Validate Solana base58 address.
   * AUDIT: Rejects empty, wrong length, ambiguous characters (0, O, I, l).
   * @param {string} address
   * @throws {Error} if invalid
   */
  solanaAddress(address) {
    if (typeof address !== 'string') {
      throw new Error(`INVALID_ADDRESS: expected string, got ${typeof address}`);
    }
    if (!BASE58_REGEX.test(address)) {
      throw new Error(`INVALID_ADDRESS: "${address.slice(0, 12)}..." is not valid base58 Solana address`);
    }
  },

  /**
   * Validate and convert amount to BigInt.
   * AUDIT:
   * - Rejects 0, negative, NaN, Infinity, non-numeric strings
   * - Rejects amounts exceeding maxAmount safety cap
   * - Returns BigInt (no floating point in financial path)
   *
   * @param {string|number|bigint} amount
   * @param {bigint} maxAmount safety cap
   * @returns {bigint} validated amount
   */
  amount(amount, maxAmount) {
    let big;
    try {
      // AUDIT[S9]: Convert to BigInt — rejects floats, NaN, Infinity
      if (typeof amount === 'bigint') {
        big = amount;
      } else if (typeof amount === 'number') {
        if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
          throw new Error('not an integer');
        }
        big = BigInt(amount);
      } else if (typeof amount === 'string') {
        // AUDIT: Reject strings with decimal points (no floats)
        if (amount.includes('.') || amount.includes('e') || amount.includes('E')) {
          throw new Error('contains decimal or exponent');
        }
        big = BigInt(amount);
      } else {
        throw new Error(`unexpected type ${typeof amount}`);
      }
    } catch (e) {
      throw new Error(`INVALID_AMOUNT: cannot convert "${String(amount).slice(0, 20)}" to integer — ${e.message}`);
    }

    if (big <= 0n) {
      throw new Error('INVALID_AMOUNT: must be greater than zero');
    }
    if (big > maxAmount) {
      throw new Error(`INVALID_AMOUNT: ${big} exceeds safety cap ${maxAmount}`);
    }

    return big;
  },

  /**
   * Validate agent ID.
   * AUDIT: Prevents path traversal (../), injection via special chars.
   * @param {string} agentId
   */
  agentId(agentId) {
    if (typeof agentId !== 'string') {
      throw new Error(`INVALID_AGENT_ID: expected string, got ${typeof agentId}`);
    }
    if (!AGENT_ID_REGEX.test(agentId)) {
      throw new Error(
        `INVALID_AGENT_ID: "${agentId.slice(0, 20)}" must be 1-64 chars, alphanumeric/hyphen/underscore only`
      );
    }
  },

  /**
   * Validate a non-empty string message (for signing).
   * @param {string} msg
   * @param {number} [maxLen=10000]
   */
  message(msg, maxLen = 10_000) {
    if (typeof msg !== 'string' || msg.length === 0) {
      throw new Error('INVALID_MESSAGE: must be a non-empty string');
    }
    if (msg.length > maxLen) {
      throw new Error(`INVALID_MESSAGE: exceeds max length ${maxLen}`);
    }
  },

  /**
   * Validate number of installments.
   * @param {number} n
   */
  installments(n) {
    if (!Number.isInteger(n) || n < 1 || n > 52) {
      throw new Error('INVALID_INSTALLMENTS: must be integer 1-52');
    }
  },
};

export default validate;