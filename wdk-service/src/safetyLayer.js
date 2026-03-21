/**
 * @module safetyLayer
 * @description Input validation and safety checks for MCP tool calls.
 *
 * AUDIT:
 * - JSON Schema validation on every tool call (defense in depth)
 * - Address format checks (base58 for Solana, 0x for EVM)
 * - Amount range checks (> 0, < safety cap)
 * - Agent ID format checks (no injection/traversal)
 * - All validators throw descriptive errors on failure
 */

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const AGENT_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
const INTEGER_STRING_RE = /^-?[0-9]+$/;

export const validate = {
  /**
   * Validate tool params against schema.
   * Lightweight schema check (no full JSON Schema library needed).
   *
   * AUDIT: Checks required fields, types, patterns, ranges.
   */
  toolParams(toolName, params, schema) {
    if (!params || typeof params !== 'object') {
      throw new Error(`INVALID_PARAMS: ${toolName} requires an object, got ${typeof params}`);
    }

    // Check required fields
    const required = schema.required || [];
    for (const field of required) {
      if (params[field] === undefined || params[field] === null) {
        throw new Error(`MISSING_FIELD: ${toolName} requires "${field}"`);
      }
    }

    // Check types and patterns
    const props = schema.properties || {};
    for (const [key, value] of Object.entries(params)) {
      const propSchema = props[key];
      if (!propSchema) {
        if (schema.additionalProperties === false) {
          throw new Error(`UNKNOWN_FIELD: ${toolName} does not accept "${key}"`);
        }
        continue;
      }

      // Type check
      if (propSchema.type === 'string' && typeof value !== 'string') {
        throw new Error(`TYPE_ERROR: ${toolName}.${key} must be string, got ${typeof value}`);
      }
      if (propSchema.type === 'integer' && (!Number.isInteger(value))) {
        throw new Error(`TYPE_ERROR: ${toolName}.${key} must be integer, got ${typeof value}`);
      }
      if (propSchema.type === 'number' && typeof value !== 'number') {
        throw new Error(`TYPE_ERROR: ${toolName}.${key} must be number, got ${typeof value}`);
      }

      // Pattern check (for agent_id, addresses)
      if (propSchema.pattern && typeof value === 'string') {
        if (!new RegExp(propSchema.pattern).test(value)) {
          throw new Error(`PATTERN_ERROR: ${toolName}.${key} "${value.slice(0, 20)}" does not match pattern`);
        }
      }

      // Range checks
      if (propSchema.minimum !== undefined && value < propSchema.minimum) {
        throw new Error(`RANGE_ERROR: ${toolName}.${key} = ${value} below minimum ${propSchema.minimum}`);
      }
      if (propSchema.maximum !== undefined && value > propSchema.maximum) {
        throw new Error(`RANGE_ERROR: ${toolName}.${key} = ${value} above maximum ${propSchema.maximum}`);
      }

      // Enum check
      if (propSchema.enum && !propSchema.enum.includes(value)) {
        throw new Error(`ENUM_ERROR: ${toolName}.${key} = "${value}" not in [${propSchema.enum.join(', ')}]`);
      }

      // maxLength
      if (propSchema.maxLength && typeof value === 'string' && value.length > propSchema.maxLength) {
        throw new Error(`LENGTH_ERROR: ${toolName}.${key} exceeds maxLength ${propSchema.maxLength}`);
      }
    }
  },

  /** Validate Solana base58 address. */
  solanaAddress(addr) {
    if (typeof addr !== 'string' || !BASE58_RE.test(addr)) {
      throw new Error(`INVALID_ADDRESS: "${String(addr).slice(0, 16)}" is not valid base58`);
    }
  },

  /** Validate EVM 0x address. */
  evmAddress(addr) {
    if (typeof addr !== 'string' || !EVM_RE.test(addr)) {
      throw new Error(`INVALID_EVM_ADDRESS: "${String(addr).slice(0, 16)}"`);
    }
  },

  /** Validate amount string (must be parseable as positive BigInt). */
  amountString(s) {
    if (typeof s !== 'string' || !INTEGER_STRING_RE.test(s)) {
      throw new Error(`INVALID_AMOUNT: "${String(s).slice(0, 20)}" not a valid integer string`);
    }
    const big = BigInt(s);
    if (big <= 0n) throw new Error('INVALID_AMOUNT: must be > 0');
    return big;
  },

  /** Validate agent ID. */
  agentId(id) {
    if (typeof id !== 'string' || !AGENT_ID_RE.test(id)) {
      throw new Error(`INVALID_AGENT_ID: "${String(id).slice(0, 20)}"`);
    }
  },
};

export default validate;
