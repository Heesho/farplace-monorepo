# FundRig Security Audit Report

**Date:** 2026-01-20
**Auditor:** Trail of Bits Methodology (Claude)
**Scope:** FundRig.sol, FundCore.sol, FundRigFactory.sol

---

## Executive Summary

The FundRig system implements a donation-based token distribution mechanism where users donate payment tokens to a daily pool, with funds split between charities (50%), treasury (45%), team (4%), and protocol (1%). After each day ends, donors can claim their proportional share of that day's Unit token emissions.

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
| `FundRig.sol` | Donation pool - daily donations, proportional claims | 309 |
| `FundCore.sol` | Launchpad - deploys rigs, creates LP, burns liquidity | 365 |
| `FundRigFactory.sol` | Simple factory for deploying FundRig instances | 49 |

### Actors

| Actor | Trust Level | Capabilities |
|-------|-------------|--------------|
| **Donor** | Untrusted | Calls `donate()`, `claim()` |
| **Owner (launcher)** | Semi-trusted | `addRecipient()`, `removeRecipient()`, `setTreasury()`, `setTeam()` |
| **Recipient (charity)** | Whitelisted | Receives 50% of donations |
| **Treasury** | Recipient | Receives 45% of donations |
| **Team** | Recipient | Receives 4% of donations |
| **Protocol** | Recipient | Receives 1% of donations |

### Data Flow

```
User calls donate(account, recipient, amount)
    │
    ├─► Validate inputs (account ≠ 0, amount >= min, recipient whitelisted)
    │
    ├─► safeTransferFrom(user → contract, amount)
    │
    ├─► Calculate fee splits (50% recipient, 45% treasury, 4% team, 1% protocol)
    │
    ├─► Distribute to all recipients
    │       └─► safeTransfer(recipient, recipientAmount)
    │       └─► safeTransfer(treasury, treasuryAmount)
    │       └─► safeTransfer(team, teamAmount)      [if team ≠ 0]
    │       └─► safeTransfer(protocol, protocolAmount)  [if protocol ≠ 0]
    │
    └─► Update state
            └─► dayToTotalDonated[day] += amount
            └─► dayAccountToDonation[day][account] += amount
                    │
                    │  ... Day passes (86400 seconds) ...
                    ▼
User calls claim(account, day)
    │
    ├─► Validate (day ended, not claimed, has donation)
    │
    ├─► Calculate reward = (userDonation * dayEmission) / dayTotal
    │
    ├─► Mark as claimed
    │
    └─► IUnit.mint(account, userReward)
```

---

## Findings

### HIGH Severity

#### H-1: Blacklisted Recipient Can Brick All Donations

**Location:** `FundRig.sol:157-164`

**Description:**
The `donate()` function performs multiple `safeTransfer()` calls in sequence. If ANY recipient (charity, treasury, team, or protocol) is blacklisted by the payment token (e.g., USDC/USDT), the entire transaction reverts.

```solidity
IERC20(paymentToken).safeTransfer(recipient, recipientAmount);
IERC20(paymentToken).safeTransfer(treasury, treasuryAmount);
if (teamAmount > 0) {
    IERC20(paymentToken).safeTransfer(team, teamAmount);
}
if (protocolAmount > 0) {
    IERC20(paymentToken).safeTransfer(protocol, protocolAmount);
}
```

**Impact:**
- If `treasury` gets blacklisted, ALL donations fail
- If a whitelisted charity gets blacklisted, donations to that charity fail
- No fallback mechanism exists
- This is especially concerning for USDC which is commonly used and has active blacklisting

**Recommendation:**
1. Add try/catch around transfers with fallback accumulation
2. Add emergency withdrawal function for stuck tokens
3. Document blacklist risk clearly
4. Consider using pull-over-push pattern for distributions

---

#### H-2: Owner Can Frontrun Donations by Removing Recipients

**Location:** `FundRig.sol:220-223`

**Description:**
The owner can call `removeRecipient()` at any time with no timelock. A malicious owner observing a pending donation in the mempool could frontrun it by removing the target recipient, causing the donation to revert.

```solidity
function removeRecipient(address _recipient) external onlyOwner {
    accountToIsRecipient[_recipient] = false;
    emit FundRig__RecipientRemoved(_recipient);
}
```

**Impact:**
- Owner can selectively censor donations to specific charities
- Griefing attack on users
- Undermines trust in the platform

**Recommendation:**
1. Add timelock to `removeRecipient()` (e.g., 24-48 hours)
2. Or allow users to specify alternative recipients as fallback
3. Or require governance approval for recipient removal

---

### MEDIUM Severity

#### M-1: Phantom Emission Loss Due to Rounding

**Location:** `FundRig.sol:193`

**Description:**
The reward calculation `(userDonation * dayEmission) / dayTotal` rounds down. The sum of all user rewards for a day will be less than `dayEmission`, meaning some tokens are never minted.

```solidity
uint256 userReward = (userDonation * dayEmission) / dayTotal;
```

**Example:**
- 3 users each donate exactly 1/3 of total
- Each gets `floor(dayEmission / 3)` tokens
- Total minted = `3 * floor(dayEmission / 3)` < `dayEmission`
- Lost tokens = `dayEmission % 3`

**Impact:** Small but cumulative loss of tokens over the lifetime of the rig. For high-frequency rigs with many small donors, this could be significant.

**Recommendation:**
1. Document as known limitation
2. Or track cumulative rounding error and distribute to last claimer
3. Or use more precise fixed-point math

---

#### M-2: Zero Reward Claims Are Allowed

**Location:** `FundRig.sol:193-199`

**Description:**
If a user's donation is so small relative to the day total that their reward rounds to zero, they can still "claim" successfully but receive nothing.

```solidity
uint256 userReward = (userDonation * dayEmission) / dayTotal;
// No check for userReward > 0
dayAccountToHasClaimed[day][account] = true;
IUnit(unit).mint(account, userReward); // Mints 0
emit FundRig__Claimed(account, userReward, day); // Emits 0
```

**Impact:**
- Poor UX - users think they claimed but got nothing
- Wastes gas on empty mints
- `Claimed` event with `amount=0` is confusing

**Recommendation:**
Add a check: `if (userReward == 0) revert FundRig__ZeroReward();`

---

#### M-3: Fee-on-Transfer Tokens Break Accounting

**Location:** `FundRig.sol:147-158`

**Description:**
The contract transfers the full `amount` from the user, then distributes based on that amount. If `paymentToken` has transfer fees, the contract receives less than `amount`, but distributes based on `amount`, causing later transfers to fail.

```solidity
IERC20(paymentToken).safeTransferFrom(msg.sender, address(this), amount);
// Contract might receive less than 'amount' if fee-on-transfer

uint256 recipientAmount = amount * RECIPIENT_BPS / DIVISOR; // Based on full amount
// ...
IERC20(paymentToken).safeTransfer(recipient, recipientAmount); // May fail
```

**Impact:** Using fee-on-transfer tokens (like some deflationary tokens) will cause `donate()` to revert or drain the contract.

**Recommendation:**
1. Document that fee-on-transfer tokens are not supported
2. Or measure balance before/after and use actual received amount

---

### LOW Severity

#### L-1: Anyone Can Trigger Claims for Any Account

**Location:** `FundRig.sol:181`

**Description:**
The `claim()` function takes `account` as a parameter, allowing anyone to trigger claims for any address. While the tokens go to the correct `account`, this could be used for griefing (forcing claims during high gas periods).

```solidity
function claim(address account, uint256 day) external nonReentrant {
```

**Recommendation:** Document this as intended behavior for batching/subsidizing, or restrict to `msg.sender` only.

---

#### L-2: No Recipient Enumeration On-Chain

**Location:** `FundRig.sol:56`

**Description:**
The `accountToIsRecipient` mapping tracks valid recipients but there's no array to enumerate all recipients. Frontends must rely on event indexing.

```solidity
mapping(address => bool) public accountToIsRecipient;
```

**Recommendation:** Add `address[] public recipients` array and getter for easier on-chain enumeration.

---

#### L-3: Comment Mismatch on Fee Percentages

**Location:** `FundCore.sol:242-243`

**Description:**
```solidity
// Treasury is the Auction contract (receives 45% of donations)
// Team is the launcher (receives 5% of donations)
```

Comment says team receives 5% but `TEAM_BPS = 400` means 4%.

**Recommendation:** Update comment to match code.

---

### INFORMATIONAL

#### I-1: Day Boundary Race Condition

**Location:** `FundRig.sol:251-253`

Transactions submitted near day boundaries may land in either day depending on block timestamp. This is inherent to blockchain systems and not a bug, but should be documented.

---

#### I-2: No Maximum Recipients

**Location:** `FundRig.sol:210-213`

There's no limit on how many recipients can be whitelisted. While this doesn't affect contract logic, an extremely large whitelist could cause UI/indexing issues.

---

## System Invariants

| ID | Invariant | Enforcement | Risk if Violated |
|----|-----------|-------------|------------------|
| INV-1 | `sum(dayAccountToDonation[day][*]) == dayToTotalDonated[day]` | Both updated atomically | Unfair distribution |
| INV-2 | Claims only possible once per account per day | `dayAccountToHasClaimed` check | Double-claim attack |
| INV-3 | `minEmission <= getDayEmission(day) <= initialEmission` | Halving with floor | Emission predictability |
| INV-4 | Fee splits sum to donation amount | Remainder calculation | Accounting errors |
| INV-5 | Only FundRig can mint Unit tokens | `setRig()` called once | Inflation attack |
| INV-6 | Claims only for past days | `day >= currentDay()` check | Premature claiming |

---

## Trust Boundary Map

```
┌─────────────────────────────────────────────────────────────────┐
│                        UNTRUSTED                                │
│   ┌──────────┐                                                  │
│   │  Donor   │ ───donate(account, recipient, amount)───────────►│
│   │          │ ───claim(account, day)──────────────────────────►│
│   └──────────┘                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        SEMI-TRUSTED                             │
│   ┌──────────┐                                                  │
│   │  Owner   │ ───addRecipient()────────────────────────────►   │
│   │(launcher)│ ───removeRecipient()                             │
│   └──────────┘ ───setTreasury(), setTeam()                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EXTERNAL (TRUSTED)                           │
│   ┌────────────┐                                                │
│   │ FundCore│ ◄───protocolFeeAddress()                       │
│   └────────────┘                                                │
│   ┌────────────┐                                                │
│   │ Payment    │ ◄───safeTransferFrom(), safeTransfer()         │
│   │ Token      │    (may have blacklists!)                      │
│   └────────────┘                                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## Positive Observations

The contract demonstrates good security practices:

- **ReentrancyGuard** on both `donate()` and `claim()`
- **SafeERC20** for all token operations
- **CEI Pattern** in `claim()` - state updated before external call
- **Proper input validation** with custom errors
- **Immutable critical parameters** (emission rates, payment token)
- **Minimum donation** ensures non-zero fee splits
- **Day-based isolation** prevents cross-day interference

---

## Comparison to SlotRig

| Aspect | FundRig | SlotRig |
|--------|------------|---------|
| **Randomness** | None (deterministic) | Pyth VRF |
| **Payout timing** | After day ends | Immediate via callback |
| **Payout calculation** | Proportional to donation | Random from odds array |
| **Fee recipients** | 4 (recipient, treasury, team, protocol) | 3 (treasury, team, protocol) |
| **Unique risk** | Blacklist bricking | Excess ETH trapped |
| **Owner trust** | Can censor recipients | Can change odds |

---

## Conclusion

The FundRig system is well-designed for a donation-based distribution model. The main risks center around:

1. **Blacklist vulnerability** - Payment tokens with blacklists (USDC, USDT) can brick the contract
2. **Owner censorship** - No timelock on recipient removal enables frontrunning
3. **Rounding loss** - Small amounts of emission are lost to integer division

The contract is simpler than SlotRig (no VRF complexity) but shares similar trust assumptions around owner behavior. The blacklist risk is more severe here due to the charity use case potentially involving sanctioned jurisdictions.

**Recommendation:** Add emergency withdrawal mechanisms and timelocks before mainnet deployment.
