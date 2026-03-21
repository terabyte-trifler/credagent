# Phase 4A Safety Layer - Audit Checklist

## T4A.1: 4-Tier Permission Model

- [x] Tier enum: Read(0), Operate(1), Manage(2), Admin(3) - both Rust and JS
- [x] `has_permission()` - higher tier has all lower permissions
- [x] Admin tier CANNOT be granted via `register_agent` - requires rotation flow
- [x] Every MCP tool mapped to a minimum required tier
- [x] Unregistered agents blocked from non-READ tools
- [x] Tier checked BEFORE spending limit (fail-fast on unauthorized)

## T4A.2: CPI Spending Limits

- [x] `check_permission_and_spend()` callable via CPI from lending_pool
- [x] Combines tier check + spending limit in one atomic call
- [x] Daily counter resets on epoch boundary (86,400s)
- [x] Cumulative tracking prevents split-tx bypass
- [x] JS pre-check mirrors on-chain check (defense in depth)

## T4A.3: Circuit Breaker

- [x] Triggers when 24h losses exceed 10% of deposits snapshot
- [x] Rolling window: resets snapshot if > 24h since last snapshot
- [x] Auto-pauses system when tripped (sets both `circuit_breaker_active` and `is_paused`)
- [x] Can only be reset by admin (Tier 3) - manual review required
- [x] Cannot unpause while circuit breaker active (must reset first)
- [x] Event emitted on trip with losses, deposits, loss_bps
- [x] JS mirrors on-chain circuit breaker (dual enforcement)

## T4A.4: Escrow-Preserving Pause

- [x] Pause blocks: conditional_disburse, lock_collateral, create_schedule, pull_installment, bridge
- [x] Pause allows: get_balance, compute_credit_score, send_notification, mark_default, liquidate_escrow
- [x] Rationale: existing defaults must be processable during emergency
- [x] Rationale: borrowers should still be able to see their scores
- [x] Escrow PDAs remain LOCKED during pause - funds inaccessible but safe
- [x] Repay allowed during pause (borrowers can still pay back)
- [x] release_collateral allowed if loan.status == Repaid

## T4A.5: Time-Locked Admin Rotation

- [x] 48-hour delay between request and finalization (ROTATION_DELAY_SECS = 172800)
- [x] request_admin_rotation: sets pending_admin + rotation_request_time
- [x] finalize_admin_rotation: only after 48h elapsed; callable by old or new admin
- [x] cancel_admin_rotation: only current admin, clears pending state
- [x] Admin tier cannot be granted via register_agent (CannotGrantAdmin error)
- [x] 48h window gives team/community time to detect and cancel compromised rotations

## Threat Model

| Threat | Mitigation | Layer |
|--------|-----------|-------|
| Rogue agent overspending | Daily limit + cumulative tracking + CPI enforcement | On-chain |
| Low-tier agent escalation | register_agent blocks Admin tier; rotation requires 48h | On-chain |
| Flash loss cascade | Circuit breaker auto-pauses at 10% loss/24h | On-chain + JS |
| Compromised admin key | 48h time-locked rotation; cancel window for team | On-chain |
| Pause draining escrow | Escrow PDAs program-owned; pause only blocks new ops | On-chain |
| Tier bypass via direct RPC | On-chain CPI check is authoritative; JS is defense-in-depth | Both |

## Verification Scope

- [x] `cargo build` passes for the Rust workspace after Phase 4A hardening
- [x] `wdk-service` unit tests pass
- [x] Root `tests/security/safety_middleware.test.js` covers middleware tier checks, pause behavior, daily limit pre-checks, and circuit-breaker trip behavior
- [ ] Full end-to-end on-chain integration coverage for admin rotation, record_loss authority, and role-specific CPI disbursement is still tracked under the broader integration/security suites
