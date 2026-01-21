# ContentRig Security Audit Report

**Date:** 2026-01-20
**Auditor:** Trail of Bits Methodology (Claude)
**Scope:** ContentRig.sol, ContentCore.sol, ContentRigFactory.sol, Rewarder.sol, Minter.sol

---

## Executive Summary

The ContentRig system is an NFT-based content marketplace where collectors "steal" content by paying a Dutch auction price. The purchase price becomes the collector's stake in a Synthetix-style reward pool, earning them Unit token emissions. Unique features include perpetual 3% creator royalties, disabled NFT transfers (only `collect()` allowed), and weekly minting via a permissionless Minter contract.

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 2 |
| Medium | 4 |
| Low | 3 |
| Informational | 3 |

---

## System Overview

### Architecture

ContentRig is the most complex rig type with 5 interacting contracts:

| Contract | Role | LOC |
|----------|------|-----|
| `ContentRig.sol` | NFT collection with disabled transfers | 420 |
| `ContentCore.sol` | Launchpad for ecosystem deployment | 429 |
| `ContentRigFactory.sol` | Factory for ContentRig instances | 58 |
| `Rewarder.sol` | Synthetix-style reward distribution | 259 |
| `Minter.sol` | Weekly emission minting | 149 |

```
ContentRig (NFT) ←→ Rewarder (Staking) ←→ Minter (Emissions)
       ↓
    Creator gets 3% royalty (perpetual)
    Previous Owner gets 80%
    Treasury gets 12%
    Team gets 4%
    Protocol gets 1%
```

### Actors

| Actor | Trust Level | Capabilities |
|-------|-------------|--------------|
| **Creator** | Untrusted | `create()`, receives 3% perpetual royalty |
| **Collector** | Untrusted | `collect()`, earns rewards based on stake |
| **Owner** | Semi-trusted | `setModerators()`, `setIsModerated()`, `addReward()` |
| **Moderator** | Semi-trusted | `approveContents()` |
| **Anyone** | Untrusted | `Minter.updatePeriod()`, `Rewarder.getReward()` |

### Data Flow

```
Creator calls create(to, uri)
    │
    ├─► Mint NFT, set creator (permanent royalty)
    ├─► Auto-approve if !isModerated
    └─► Set initial auction state
            │
            ▼
Collector calls collect(to, tokenId, ...)
    │
    ├─► Distribute fees (pull for users, push for trusted)
    ├─► Transfer NFT
    └─► Update Rewarder stakes
            │
            ▼
Minter.updatePeriod() (weekly, by anyone)
    │
    └─► Mint & notify Rewarder
            │
            ▼
Rewarder.getReward(account)
    │
    └─► Claim earned rewards
```

---

## Findings

### HIGH Severity

#### H-1: Zero-Price Collection Griefing Attack

**Location:** `ContentRig.sol:225-257`

**Description:**
When the Dutch auction price decays to zero (after `EPOCH_PERIOD = 1 day`), anyone can "steal" content without paying, removing the previous owner's stake and rewards.

```solidity
if (price > 0) {
    // ... fee distribution and deposit happen only if price > 0
    IRewarder(rewarder).deposit(to, price);
}

// Withdraw ALWAYS happens if prevStake > 0
if (prevStake > 0) {
    IRewarder(rewarder).withdraw(prevOwner, prevStake);
}
```

**Attack Scenario:**
1. Alice owns content with stake = 1000 (earning substantial rewards)
2. Bob waits until `getPrice(tokenId) == 0` (after 1 day)
3. Bob calls `collect(bob, tokenId, epochId, deadline, 0)` for free
4. Alice's 1000 stake is withdrawn (she stops earning rewards)
5. Bob gets stake = 0 (no rewards, but owns NFT)
6. Bob can set new price via next collection

**Impact:** Griefing attack that removes victim's reward earning capability at no cost to attacker.

**Recommendation:**
1. Add minimum collection price requirement
2. Or prevent zero-price collections
3. Or carry forward a minimum stake

---

#### H-2: Missed Weekly Emissions Are Lost Forever

**Location:** `Minter.sol:96-117`

**Description:**
The `updatePeriod()` function only mints one week of emissions regardless of how much time has passed. If no one calls it for multiple weeks, those weeks' emissions are permanently lost.

```solidity
function updatePeriod() external returns (uint256 period) {
    period = activePeriod;
    if (block.timestamp >= period + WEEK) {
        period = (block.timestamp / WEEK) * WEEK;  // Jumps to current week
        activePeriod = period;

        uint256 weekly = weeklyEmission();  // Only current week's amount
        // ... mints only 'weekly' amount
    }
}
```

**Example:**
- Week 1: `updatePeriod()` called → week 1 emissions minted
- Week 2: Nobody calls
- Week 3: `updatePeriod()` called → only week 3 minted
- Week 2 emissions are **permanently lost**

**Impact:** If the weekly update is missed, stakers lose expected rewards. No way to recover.

**Recommendation:**
1. Loop through missed weeks and mint each
2. Or track "owed" emissions and catch up
3. Or implement keeper incentives to ensure weekly calls

---

### MEDIUM Severity

#### M-1: Content Approval Cannot Be Revoked

**Location:** `ContentRig.sol:355-363`

**Description:**
The `approveContents()` function can only set approval to `true`. There's no function to revoke approval.

```solidity
function approveContents(uint256[] calldata tokenIds) external {
    // ...
    if (tokenIdToApproved[tokenIds[i]]) revert ContentRig__AlreadyApproved();
    tokenIdToApproved[tokenIds[i]] = true;  // Can never be set back to false
    // ...
}
```

**Impact:** If a moderator mistakenly approves inappropriate/spam content, it cannot be removed from the marketplace.

**Recommendation:** Add `unapproveContents()` function for owner/moderators.

---

#### M-2: Rewards Lost if totalSupply is Zero When Notified

**Location:** `Rewarder.sol:219-228`

**Description:**
The `rewardPerToken()` function handles `totalSupply == 0` by returning the stored value:

```solidity
function rewardPerToken(address token) public view returns (uint256) {
    if (totalSupply == 0) {
        return tokenToRewardData[token].rewardPerTokenStored;
    }
    // ... calculation that divides by totalSupply
}
```

If `notifyRewardAmount()` is called when `totalSupply == 0`, the rewards accrue but no one has stake to claim them. They become permanently unclaimed.

**Impact:** Edge case where rewards could be lost if no content has been collected yet when Minter runs.

**Recommendation:** Document this behavior or add check in `notifyRewardAmount()`.

---

#### M-3: Creator Address is Permanently Immutable

**Location:** `ContentRig.sol:165`

**Description:**
The creator address is set once at `create()` time and can never be changed:

```solidity
tokenIdToCreator[tokenId] = to;
```

**Impact:**
- If creator loses access to wallet, they can never receive royalties
- Creator cannot transfer royalty rights
- No way to update compromised creator address

**Recommendation:** Consider adding `updateCreator()` function callable only by current creator.

---

#### M-4: Unbounded Reward Token Array Could Cause Gas Issues

**Location:** `Rewarder.sol:69-78`

**Description:**
The `updateReward` modifier loops through all reward tokens:

```solidity
modifier updateReward(address account) {
    for (uint256 i; i < rewardTokens.length; i++) {
        // ... updates for each token
    }
    _;
}
```

If many reward tokens are added via `addReward()`, this could exceed gas limits.

**Impact:** Could make deposits/withdrawals/claims fail if too many reward tokens.

**Recommendation:** Add maximum reward token limit (e.g., 10).

---

### LOW Severity

#### L-1: Anyone Can Trigger Claims for Any Account

**Location:** `ContentRig.sol:270-276`, `Rewarder.sol:107-117`

**Description:**
Both `claim()` and `getReward()` take `account` as a parameter, allowing anyone to trigger claims for any address. While funds go to the correct account, this enables grief attacks.

**Recommendation:** Document as intended behavior or restrict to account owner.

---

#### L-2: No Maximum Content Creation Rate

**Location:** `ContentRig.sol:160-175`

**Description:**
Anyone can call `create()` unlimited times, potentially spamming the collection with content.

**Recommendation:** Consider rate limiting or creation fee.

---

#### L-3: Price Multiplier is Hardcoded

**Location:** `ContentRig.sol:34`

**Description:**
```solidity
uint256 public constant PRICE_MULTIPLIER = 2e18;
```

The 2x price multiplier is hardcoded and cannot be adjusted by the owner.

**Recommendation:** Consider making this configurable.

---

### INFORMATIONAL

#### I-1: Pull Pattern Correctly Used for User Fees

**Location:** `ContentRig.sol:237-238`

Both `prevOwner` and `creator` fees use the pull pattern (`accountToClaimable`), preventing blacklist DoS attacks. This is excellent security design.

---

#### I-2: Soulbound-ish NFTs Prevent Fee Bypass

**Location:** `ContentRig.sol:280-298`

Disabling standard ERC721 transfers ensures all transfers go through `collect()`, maintaining fee structure integrity. Good design.

---

#### I-3: Permissionless Minting Prevents Centralization

**Location:** `Minter.sol:96`

Anyone can call `updatePeriod()`, removing dependence on a centralized keeper. However, this comes with the tradeoff of potentially missed emissions (H-2).

---

## System Invariants

| ID | Invariant | Enforcement | Risk if Violated |
|----|-----------|-------------|------------------|
| INV-1 | `sum(accountToBalance) == totalSupply` | deposit/withdraw math | Reward errors |
| INV-2 | `tokenIdToStake` matches Rewarder balance | ContentRig controls Rewarder | Reward gaming |
| INV-3 | `creator` is immutable per token | Set once | Royalty theft |
| INV-4 | Only `collect()` transfers NFTs | Overridden methods | Fee bypass |
| INV-5 | Per-token `epochId` strictly increases | unchecked increment | Replay |
| INV-6 | Only Minter can mint Unit | `setRig()` once | Inflation |
| INV-7 | `approved` can only go false→true | No unapprove | Permanent |

---

## Trust Boundary Map

```
┌─────────────────────────────────────────────────────────────────┐
│                        UNTRUSTED                                │
│   ┌──────────┐                                                  │
│   │ Creator  │ ───create(to, uri)──────────────────────────────►│
│   │Collector │ ───collect(to, tokenId, ...)────────────────────►│
│   │ Anyone   │ ───Minter.updatePeriod()────────────────────────►│
│   │          │ ───Rewarder.getReward(account)──────────────────►│
│   └──────────┘                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        SEMI-TRUSTED                             │
│   ┌──────────┐                                                  │
│   │  Owner   │ ───setModerators(), setIsModerated()────────►    │
│   │Moderator │ ───approveContents()────────────────────────►    │
│   └──────────┘                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    INTERNAL TRUSTED                             │
│   ContentRig ←──────────→ Rewarder ←───────────→ Minter         │
│   (deposit/withdraw)        (notifyRewardAmount)                │
└─────────────────────────────────────────────────────────────────┘
```

---

## Positive Observations

1. **Pull Pattern** - User fees (prevOwner, creator) use pull pattern preventing blacklist DoS
2. **Soulbound Design** - Disabled transfers enforce fee structure
3. **Permissionless Minting** - No centralized keeper dependency
4. **Perpetual Royalties** - Creators earn 3% forever
5. **Synthetix-style Rewarder** - Battle-tested reward distribution pattern
6. **ReentrancyGuard** - On all critical functions
7. **SafeERC20** - For all token operations

---

## Comparison Summary

| Risk | ContentRig | MineRig | SlotRig | FundRig |
|------|------------|---------|---------|------------|
| **Unique High** | Zero-price grief, Missed emissions | UPS dilution | ETH trapped | Blacklist bricks |
| **Blacklist** | Pull pattern (safe) | Pull pattern (safe) | Direct (risky) | Direct (bricks) |
| **VRF** | None | Optional | Required | None |
| **Emission** | Weekly (missable) | Per-mine | Per-spin | Per-day |
| **Halving** | Time-based | Supply-based | Time-based | Day-based |

---

## Conclusion

ContentRig is the most architecturally complex rig, combining NFT mechanics, staking rewards, and permissionless minting. The main risks are:

1. **H-1:** Zero-price griefing allows free "theft" that removes victim's reward stake
2. **H-2:** Missed weekly emissions are permanently lost
3. **M-1:** Approved content cannot be unapproved

The system demonstrates strong patterns (pull for users, disabled transfers, permissionless minting) but has unique edge cases around zero-price collections and emission timing that should be addressed.

**Recommendation:** Add minimum collection price and implement emission catch-up logic before mainnet deployment.
