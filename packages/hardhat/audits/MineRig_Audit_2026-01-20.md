# MineRig Security Audit Report

**Date:** 2026-01-20
**Auditor:** Trail of Bits Methodology (Claude)
**Scope:** MineRig.sol, MineCore.sol, MineRigFactory.sol

---

## Executive Summary

The MineRig system implements a multi-slot mining mechanism where users compete for mining seats via Dutch auction. When a slot is taken, 80% of the payment goes to the previous miner (via pull pattern), with the rest split between treasury (15%), team (4%), and protocol (1%). Miners earn Unit tokens based on time held, emission rate (UPS), and an optional VRF-based multiplier bonus (1x-10x).

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
| `MineRig.sol` | Multi-slot mining - Dutch auction seats, UPS multipliers, VRF | 560 |
| `MineCore.sol` | Launchpad - deploys rigs, creates LP, burns liquidity | 411 |
| `MineRigFactory.sol` | Factory for deploying MineRig instances | 62 |

### Key Differences from Other Rigs

| Feature | MineRig | SlotRig | FundRig |
|---------|---------|---------|------------|
| **Multi-slot** | Yes (configurable) | No (single pool) | No (daily pool) |
| **Miner payout** | 80% to previous miner | N/A | N/A |
| **Pull pattern** | Yes (`claim()`) | No (direct transfer) | No (direct mint) |
| **VRF usage** | Optional UPS multiplier | Required for payout | None |
| **Halving** | Supply-based (geometric) | Time-based | Day-count based |

### Actors

| Actor | Trust Level | Capabilities |
|-------|-------------|--------------|
| **Miner** | Untrusted | `mine()`, `claim()` |
| **Owner (launcher)** | Semi-trusted | `setCapacity()`, `setUpsMultipliers()`, `setRandomnessEnabled()`, etc. |
| **Previous Miner** | Recipient | Receives 80% via claimable balance |
| **Treasury** | Recipient | Receives 15% |
| **Team** | Recipient | Receives 4% |
| **Protocol** | Recipient | Receives 1% |
| **Pyth Entropy** | External/Trusted | `entropyCallback()` for UPS multiplier |

### Data Flow

```
User calls mine(miner, index, epochId, deadline, maxPrice, uri) + msg.value
    │
    ├─► Validate (miner ≠ 0, deadline, index < capacity, epochId match, price)
    │
    ├─► safeTransferFrom(user → contract, price)
    │
    ├─► Calculate fees (80% miner, 15% treasury, 4% team, 1% protocol)
    │
    ├─► Credit previous miner (PULL pattern)
    │       └─► accountToClaimable[prevMiner] += minerFee
    │
    ├─► Distribute other fees (PUSH pattern)
    │       └─► safeTransfer(treasury, treasuryFee)
    │       └─► safeTransfer(team, teamFee)
    │       └─► safeTransfer(protocol, protocolFee)
    │
    ├─► Calculate and mint tokens to previous miner
    │       └─► minedAmount = mineTime * ups * upsMultiplier / PRECISION
    │       └─► IUnit.mint(prevMiner, minedAmount)
    │
    ├─► Update slot state (epochId++, initPrice, startTime, miner, ups)
    │
    └─► Optionally request VRF for UPS multiplier
            └─► entropy.requestV2{value: fee}()
            └─► Callback updates slot.upsMultiplier
```

---

## Findings

### HIGH Severity

#### H-1: Excess ETH Trapped in Contract

**Location:** `MineRig.sol:324-330`

**Description:**
Same issue as SlotRig. When requesting VRF, if `msg.value > fee`, the excess ETH is permanently trapped in the contract.

```solidity
uint128 fee = IEntropyV2(entropy).getFeeV2();
if (msg.value < fee) revert Rig__InsufficientFee();
uint64 seq = IEntropyV2(entropy).requestV2{value: fee}();
// Excess ETH stays in contract  <-- Comment acknowledges issue
```

**Impact:** Users who overpay for VRF lose the excess ETH permanently.

**Recommendation:** Refund excess ETH:
```solidity
if (msg.value > fee) {
    (bool success, ) = msg.sender.call{value: msg.value - fee}("");
    require(success, "ETH refund failed");
}
```

---

#### H-2: Owner Can Manipulate UPS Multipliers Without Timelock

**Location:** `MineRig.sol:483-496`

**Description:**
The owner can change `upsMultipliers` at any time with no delay. A malicious owner could:
1. See a VRF request pending
2. Change multipliers to all 1x values
3. Wait for callback to execute
4. Restore original multipliers

Additionally, the owner can reduce all multipliers to 1x at any time, effectively removing the bonus feature without warning.

```solidity
function setUpsMultipliers(uint256[] calldata _upsMultipliers) external onlyOwner {
    // No timelock
    upsMultipliers = _upsMultipliers;
}
```

**Impact:** Owner can nerf mining rewards at will or frontrun VRF callbacks.

**Recommendation:**
1. Add timelock (e.g., 24 hours) to multiplier changes
2. Or commit multipliers at mine time, not callback time

---

### MEDIUM Severity

#### M-1: UPS Dilution Unfair to New Miners After Capacity Increase

**Location:** `MineRig.sol:308`

**Description:**
When owner increases capacity via `setCapacity()`, the UPS pool is divided among more slots. However, existing slots retain their OLD higher UPS until someone mines them.

```solidity
slotCache.ups = _getUpsFromSupply() / capacity;
```

**Example:**
- Capacity = 1, Alice has slot 0 with ups = 100
- Owner sets capacity = 2
- Bob mines slot 1, gets ups = 50 (100/2)
- Alice still has ups = 100 until her slot is taken
- Alice earns 2x more than Bob!

**Impact:** Temporary unfair advantage to incumbent miners after capacity increases.

**Recommendation:**
1. Document as intended behavior
2. Or add function to normalize all slot UPS values after capacity change

---

#### M-2: Slot UPS Not Updated After Halving

**Location:** `MineRig.sol:308, 429-443`

**Description:**
When `totalMinted` crosses a halving threshold, `_getUpsFromSupply()` returns the new lower rate. But existing slots keep their OLD `slot.ups` value until someone mines them.

**Example:**
- totalMinted = 999, Alice mines with ups = 100
- totalMinted becomes 1001 (halving threshold crossed)
- Bob mines new slot, gets ups = 50 (halved)
- Alice still earns at ups = 100

**Impact:** Miners who hold slots across halving boundaries get higher-than-intended emissions.

**Recommendation:**
1. Document as known limitation
2. Or track halving count per slot and adjust at mint time

---

#### M-3: Wasted VRF Fee on Quick Slot Takeovers

**Location:** `MineRig.sol:359-375`

**Description:**
When a slot is mined and VRF is requested, if the slot is taken again before the callback arrives, the callback is silently ignored (correct behavior). But the VRF fee paid by the first miner is wasted.

```solidity
// Callback arrives but epoch changed
if (slotCache.epochId != epoch || slotCache.miner == address(0)) return;
```

**Impact:** Users who mine competitive slots may waste VRF fees frequently.

**Recommendation:**
1. Document this behavior clearly
2. Consider allowing miner to opt-out of VRF on competitive slots

---

### LOW Severity

#### L-1: Miner Fee Credited to Zero Address on Fresh Slots

**Location:** `MineRig.sol:268`

**Description:**
On fresh slots where `slotCache.miner == address(0)`, the 80% miner fee is credited to address(0)'s claimable balance.

```solidity
accountToClaimable[slotCache.miner] += minerFee;  // slotCache.miner could be address(0)
```

**Impact:** Miner fees on first-ever slot mines are effectively burned (unclaimed forever).

**Recommendation:** Skip miner fee credit when previous miner is zero address:
```solidity
if (slotCache.miner != address(0)) {
    accountToClaimable[slotCache.miner] += minerFee;
}
```

---

#### L-2: Anyone Can Trigger Claims for Any Account

**Location:** `MineRig.sol:344-350`

**Description:**
The `claim()` function takes `account` as a parameter, allowing anyone to trigger claims for any address. While tokens go to the correct account, this could be used for grief attacks.

**Recommendation:** Document as intended behavior or restrict to `msg.sender`.

---

#### L-3: Revert on Unexpected ETH Could Surprise Users

**Location:** `MineRig.sol:331-333`

**Description:**
If `msg.value > 0` but randomness is not needed (disabled or duration not expired), the transaction reverts.

```solidity
} else if (msg.value > 0) {
    revert Rig__NoEntropyRequired();
}
```

**Impact:** Users who always send ETH expecting VRF might be surprised by reverts.

**Recommendation:** Refund instead of revert, or document clearly when ETH is needed.

---

### INFORMATIONAL

#### I-1: Pull Pattern Correctly Prevents Blacklist Griefing

**Location:** `MineRig.sol:268`

The decision to use pull pattern for miner fees (crediting to `accountToClaimable` instead of direct transfer) is excellent security design. This prevents:
- Blacklisted miners from blocking slot takeovers
- Malicious contracts from griefing via revert-on-receive

This is a notable positive compared to other rig types.

---

#### I-2: Geometric Halving Creates Predictable Supply Cap

**Location:** `MineRig.sol:429-443`

The supply-based geometric halving (Bitcoin-style) creates a predictable maximum supply of approximately `2 × halvingAmount`. This is well-designed tokenomics that investors can model.

---

## System Invariants

| ID | Invariant | Enforcement | Risk if Violated |
|----|-----------|-------------|------------------|
| INV-1 | `minerFee + protocolFee + teamFee + treasuryFee == price` | Remainder calculation | Fee accounting |
| INV-2 | Per-slot `epochId` strictly increases | `unchecked { epochId++ }` | Replay attacks |
| INV-3 | `tailUps <= UPS <= initialUps` | Halving with floor | Emission bounds |
| INV-4 | `1e18 <= upsMultiplier <= 10e18` | Validation | Emission bounds |
| INV-5 | Capacity can only increase | Check in setter | Index validity |
| INV-6 | Only MineRig can mint Unit | `setRig()` once | Inflation |
| INV-7 | `totalMinted` monotonically increases | Only incremented | Halving calc |

---

## Trust Boundary Map

```
┌─────────────────────────────────────────────────────────────────┐
│                        UNTRUSTED                                │
│   ┌──────────┐                                                  │
│   │  Miner   │ ───mine(miner, index, epochId, ...)─────────────►│
│   │          │ ───claim(account)───────────────────────────────►│
│   └──────────┘                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        SEMI-TRUSTED                             │
│   ┌──────────┐                                                  │
│   │  Owner   │ ───setCapacity()────────────────────────────►    │
│   │(launcher)│ ───setUpsMultipliers()                           │
│   └──────────┘ ───setRandomnessEnabled()                        │
│                ───setTreasury(), setTeam()                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EXTERNAL (TRUSTED)                           │
│   ┌────────────┐                                                │
│   │ Pyth       │ ◄───requestV2()                                │
│   │ Entropy    │ ───entropyCallback()───────────────────────►   │
│   └────────────┘                                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## Positive Observations

The MineRig demonstrates several excellent security patterns:

1. **Pull Pattern for Miner Fees** - Prevents blacklist griefing, excellent design choice
2. **Per-Slot Epoch IDs** - Allows parallel mining of different slots
3. **ReentrancyGuard + CEI** - Double protection on state-changing functions
4. **Conditional VRF** - Saves gas/ETH when randomness not needed
5. **Stale Callback Handling** - Correctly ignores callbacks for changed epochs
6. **Bounded Loops** - 64-iteration limit in halving calculation
7. **Comprehensive Bounds Validation** - All configurable parameters validated

---

## Comparison Summary

| Risk | MineRig | SlotRig | FundRig |
|------|---------|---------|------------|
| **ETH Handling** | Excess trapped (H-1) | Same | N/A (no ETH) |
| **Owner Abuse** | Multiplier manipulation | Odds manipulation | Recipient removal |
| **Fairness Issue** | UPS dilution/halving lag | Pool timing variance | Rounding loss |
| **Blacklist Risk** | Mitigated (pull pattern) | Direct transfer | Direct transfer (bricks) |
| **VRF Waste** | On quick takeovers | On quick spins | N/A |

---

## Conclusion

MineRig is the most complex of the three rig types but demonstrates the best security patterns, particularly the pull pattern for miner fees. The main risks are:

1. **H-1:** Excess ETH trapped (same as SlotRig)
2. **H-2:** No timelock on multiplier changes enables owner manipulation
3. **M-1/M-2:** UPS values become stale after capacity/halving changes

The multi-slot design with per-slot epoch IDs is well-architected for scalability. The geometric halving creates predictable tokenomics.

**Recommendation:** Add timelocks to owner functions and implement ETH refund mechanism before mainnet deployment.
