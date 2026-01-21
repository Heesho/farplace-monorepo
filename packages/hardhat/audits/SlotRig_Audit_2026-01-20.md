# SlotRig Security Audit Report

**Date:** 2026-01-20
**Auditor:** Trail of Bits Methodology (Claude)
**Scope:** SlotRig.sol, SlotCore.sol, SlotRigFactory.sol

---

## Executive Summary

The SlotRig system implements a slot machine-style mining mechanism where users pay a Dutch auction price to spin for a chance to win Unit tokens from a prize pool. Pyth Entropy VRF provides randomness for fair payout determination.

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 2 |
| Medium | 3 |
| Low | 3 |
| Informational | 2 |

---

## System Overview

### Architecture

| Contract | Role | LOC |
|----------|------|-----|
| `SlotRig.sol` | Main slot machine - spins, VRF, emissions, prizes | 481 |
| `SlotCore.sol` | Launchpad - deploys rigs, creates LP, burns liquidity | 403 |
| `SlotRigFactory.sol` | Simple factory for deploying SlotRig instances | 60 |

### Actors

| Actor | Trust Level | Capabilities |
|-------|-------------|--------------|
| **Slotner (user)** | Untrusted | Calls `spin()`, pays quote token + ETH for VRF |
| **Owner (launcher)** | Semi-trusted | `setTreasury()`, `setTeam()`, `setOdds()` |
| **Pyth Entropy** | External/Trusted | Calls `entropyCallback()` with randomness |
| **Treasury** | Recipient | Receives 95% of spin fees |
| **Team** | Recipient | Receives 4% of spin fees |
| **Protocol** | Recipient | Receives 1% of spin fees |

### Data Flow

```
User calls spin(spinner, epochId, deadline, maxPrice) + msg.value
    │
    ├─► Validate inputs (spinner ≠ 0, deadline, epochId, price)
    │
    ├─► Calculate fees
    │       └─► safeTransferFrom(user → treasury)  [95%]
    │       └─► safeTransferFrom(user → team)      [4%]
    │       └─► safeTransferFrom(user → protocol)  [1%]
    │
    ├─► Mint emissions to prize pool
    │       └─► IUnit(unit).mint(this, amount)
    │
    ├─► Update Dutch auction state
    │       └─► epochId++, initPrice, slotStartTime
    │
    └─► Request VRF
            └─► entropy.requestV2{value: fee}()
            └─► Store sequenceToSlotner, sequenceToEpoch
                    │
                    │  ... Pyth network processes ...
                    ▼
            Pyth calls entropyCallback(seq, randomNumber)
                    │
                    ├─► Retrieve and delete spinner/epoch
                    │
                    ├─► Draw odds from array using randomNumber
                    │
                    ├─► Calculate winAmount = pool * oddsBps / 10000
                    │
                    └─► safeTransfer(spinner, winAmount)
```

---

## Findings

### HIGH Severity

#### H-1: Excess ETH Trapped in Contract

**Location:** `SlotRig.sol:284-286`

**Description:**
The `spin()` function requires `msg.value >= fee` but only forwards exactly `fee` to the Entropy contract. Any excess ETH is permanently trapped.

```solidity
uint128 fee = entropy.getFeeV2();
if (msg.value < fee) revert SlotRig__InsufficientFee();
uint64 seq = entropy.requestV2{value: fee}();  // Only 'fee' is sent
```

**Impact:** Users who send more ETH than required will lose the excess. No recovery mechanism exists.

**Recommendation:** Refund excess ETH to the caller:
```solidity
if (msg.value > fee) {
    (bool success, ) = msg.sender.call{value: msg.value - fee}("");
    require(success, "ETH refund failed");
}
```

---

#### H-2: Owner Can Frontrun Slots with Unfair Odds

**Location:** `SlotRig.sol:393-395`

**Description:**
The owner can call `setOdds()` to change payout percentages at any time. A malicious owner observing a pending spin in the mempool could frontrun it with `setOdds([100])` to minimize payouts.

**Impact:** Users receive unfair payouts. The epoch ID check does not protect against this because the epoch doesn't change when odds are modified.

**Recommendation:**
1. Add a timelock to `setOdds()` (e.g., 24 hours)
2. Or commit odds at spin time and use them at callback time
3. Or allow users to specify `minOddsBps` as slippage protection

---

### MEDIUM Severity

#### M-1: Emission Calculation Inaccuracy Across Halvings

**Location:** `SlotRig.sol:331-344`

**Description:**
`_mintEmissions()` uses the current emission rate for the entire elapsed period, ignoring that halvings may have occurred during that time.

```solidity
uint256 ups = _getUpsFromTime(block.timestamp);  // Current rate only
amount = timeElapsed * ups;
```

**Impact:** If a spin occurs shortly after a halving and the previous spin was shortly before, emissions are under-calculated. Example: spanning a halving with 2 days elapsed could under-emit by ~33%.

**Recommendation:** Either:
1. Track and iterate over halving boundaries (gas intensive)
2. Document as known limitation for low-frequency rigs
3. Require spins occur at minimum frequency to bound inaccuracy

---

#### M-2: Prize Pool Measured at Callback Time Creates Timing Variance

**Location:** `SlotRig.sol:312-313`

**Description:**
The prize pool balance is measured when the VRF callback executes, not when the spin is initiated:

```solidity
uint256 pool = IERC20(unit).balanceOf(address(this));
uint256 winAmount = pool * oddsBps / DIVISOR;
```

**Impact:** Users cannot predict their potential payout. If many spins occur between a user's spin and their callback, the pool may be significantly smaller.

**Recommendation:** Document this as expected behavior, or store pool snapshot at spin time (costs additional storage per pending spin).

---

#### M-3: Fee-on-Transfer Tokens Incompatible with Fee Distribution

**Location:** `SlotRig.sol:246-257`

**Description:**
The fee distribution assumes `treasuryFee + teamFee + protocolFee == price`. If `quote` is a fee-on-transfer token, the actual received amounts will be less, causing the final transfer to fail or accounting to be incorrect.

**Impact:** Using fee-on-transfer tokens as `quote` will cause spin transactions to fail or result in incorrect fee distribution.

**Recommendation:**
1. Document that fee-on-transfer tokens are not supported
2. Or measure balances before/after transfers to handle fees

---

### LOW Severity

#### L-1: Silent Return on Invalid Callback

**Location:** `SlotRig.sol:308`

```solidity
if (spinner == address(0)) return;
```

**Description:** Invalid callbacks (unknown sequence numbers) are silently ignored without logging.

**Recommendation:** Emit an event for debugging: `emit SlotRig__InvalidCallback(sequenceNumber);`

---

#### L-2: Comment Mismatch on Fee Percentages

**Location:** `SlotCore.sol:263`

```solidity
// Treasury is the Auction contract (receives 90% of spin fees)
```

**Description:** Comment says 90% but actual treasury fee is 95% (100% - 4% team - 1% protocol).

**Recommendation:** Update comment to match code.

---

#### L-3: Epoch ID Event Inconsistency

**Location:** `SlotRig.sol:281,288-289`

**Description:**
- `SlotRig__Slot` event uses `currentEpochId` (pre-increment)
- `SlotRig__EntropyRequested` uses `epochId` (post-increment)
- `sequenceToEpoch` stores post-increment value

This creates potential confusion for off-chain indexers.

**Recommendation:** Document this behavior or standardize on one epoch reference.

---

### INFORMATIONAL

#### I-1: Modulo Bias in Odds Selection

**Location:** `SlotRig.sol:327`

The modulo operation `uint256(randomNumber) % length` has theoretical bias for odds arrays that don't evenly divide 2^256. For practical array sizes (<100 elements), the bias is negligible (~10^-75).

---

#### I-2: No Maximum Odds Array Length

**Location:** `SlotRig.sol:353-364`

There's no upper bound on odds array length. An extremely large array could cause gas issues in `_drawOdds()`, though the array access is O(1).

---

## System Invariants

| ID | Invariant | Enforcement | Risk if Violated |
|----|-----------|-------------|------------------|
| INV-1 | `epochId` strictly increases | `unchecked { epochId++ }` | Replay attacks |
| INV-2 | `treasuryFee + teamFee + protocolFee == price` | Remainder calculation | Accounting errors |
| INV-3 | `odds[i] ∈ [100, 10000] ∀i` | `_validateAndSetOdds()` | Over/under payout |
| INV-4 | Only SlotRig can mint Unit tokens | `setRig()` called once | Inflation attack |
| INV-5 | Initial LP is burned (unrecoverable) | Sent to DEAD_ADDRESS | Rug pull possible |
| INV-6 | `slotStartTime ≤ block.timestamp` | Set to `block.timestamp` | Negative time delta |
| INV-7 | `tailUps ≤ ups ≤ initialUps` | Halving with floor | Emission predictability |

---

## Trust Boundary Map

```
┌─────────────────────────────────────────────────────────────────┐
│                        UNTRUSTED                                │
│   ┌──────────┐                                                  │
│   │  Slotner │ ───spin()───────────────────────────────────────►│
│   └──────────┘                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        SEMI-TRUSTED                             │
│   ┌──────────┐                                                  │
│   │  Owner   │ ───setOdds()──────────────────────────────────►  │
│   │(launcher)│ ───setTeam()                                     │
│   └──────────┘ ───setTreasury()                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EXTERNAL (TRUSTED)                           │
│   ┌────────────┐                                                │
│   │ Pyth       │ ◄───requestV2()                                │
│   │ Entropy    │ ───entropyCallback()───────────────────────►   │
│   └────────────┘                                                │
│   ┌────────────┐                                                │
│   │ SlotCore   │ ◄───protocolFeeAddress()                       │
│   └────────────┘                                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## Positive Observations

The contract demonstrates good security practices:

- **ReentrancyGuard** on `spin()` function
- **SafeERC20** for all token transfers
- **Dutch auction frontrun protection** via epoch ID matching
- **Comprehensive input validation** in constructor and functions
- **Immutable critical parameters** (emission rates, multipliers)
- **Proper access control** via OpenZeppelin Ownable

---

## Conclusion

The SlotRig system is well-designed with appropriate security measures for a slot machine-style DeFi application. The main risks center around:

1. **Owner trust** - Users must trust the launcher to set fair odds
2. **ETH handling** - Excess VRF fees are lost
3. **Timing variance** - Payout amounts depend on callback timing

These should be addressed before mainnet deployment or clearly documented as known limitations.
