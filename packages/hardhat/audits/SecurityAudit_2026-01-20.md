# Farplace Smart Contract Security Audit Report

**Date:** January 20, 2026
**Auditor:** Claude Code (Trail of Bits Skills)
**Scope:** All Solidity contracts in `packages/hardhat/contracts/`
**Commit:** Current working directory state

---

## Executive Summary

Analyzed **49 Solidity files** (~3,568 SLOC) across 4 rig types (Seat, Spin, Charity, Content), plus core infrastructure (Registry, Unit, Auction, Multicall). Overall the codebase is **well-designed with appropriate security measures**. Most Slither warnings are false positives or properly mitigated.

### Summary Statistics

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 5 |
| Low | 9 |
| Informational | 5 |

---

## System Overview

### Why Mining?

Traditional token launches suffer from a fundamental fairness problem: sophisticated actors (bundlers, snipers, MEV bots) extract value at the expense of regular users. By the time an average person can participate, prices have already pumped and early insiders are dumping.

**Mining inverts this dynamic.** There's no bundle to snipe, no presale to frontrun. Everyone competes on equal footing through a Dutch auction mechanism where the seat goes to whoever values it most at any given moment. The work is verifiable (you held the seat), the incentive is clear (token emissions), and the outcome is fair (proportional to contribution).

### How It Works

Farplace is a token launchpad on Base that distributes tokens through mining mechanisms instead of traditional sales. When a new token launches:

1. A "rig" is deployed that controls token emission and distribution
2. Initial liquidity pairs the new token with USDC
3. LP tokens are permanently burned (sent to dead address) - liquidity cannot be pulled
4. Users interact with the rig to earn tokens through various mechanisms

This creates rug-proof launches by design: there's no team allocation to dump, no LP to pull, just pure emission mechanics.

### The Four Rig Types

Farplace supports four distinct "rig" architectures, each designed to incentivize different behaviors:

| Rig Type | Purpose | Mechanism | Target Behavior |
|----------|---------|-----------|-----------------|
| **MineRig** | Classic mining | Dutch auction for seats, time-based emissions | Pure speculation/trading |
| **SlotRig** | Casino/gambling | VRF-powered slot machine with prize pool | Entertainment/gaming |
| **FundRig** | Charitable giving | Daily donation pools, proportional claims | Fundraising for causes |
| **ContentRig** | Content creation | NFT "stealing" with staking rewards | Art, memes, creative work |

Each rig type follows the same core pattern but channels it toward different outcomes:

```
Work → Verification → Incentive → Outcome
```

- **MineRig**: Hold seat → Time elapsed → Token emissions → Trading activity
- **SlotRig**: Pay to spin → VRF determines → Prize payout → Entertainment
- **FundRig**: Donate funds → Day ends → Proportional claim → Charitable impact
- **ContentRig**: Create/collect art → Approval/ownership → Staking rewards → Culture

### Tokenomics Design

All rig types share common tokenomics principles:

1. **Dutch Auction Pricing**: Prices decay linearly within epochs, preventing frontrunning
2. **Halving Emissions**: Token supply follows geometric decay (Bitcoin-style) to ensure scarcity
3. **Fee Distribution**: Consistent split between operators, treasury, team, and protocol
4. **Burned Liquidity**: Initial LP tokens are permanently locked, preventing rug pulls

### Trust Model

| Actor | Trust Level | Can Do | Cannot Do |
|-------|-------------|--------|-----------|
| **Users** | Untrusted | Mine, spin, donate, collect | Mint tokens, change parameters |
| **Launchers** | Semi-trusted | Configure rig parameters, set fees | Withdraw user funds, mint arbitrary tokens |
| **Protocol** | Trusted | Receive fee share | Change individual rig behavior |
| **Pyth VRF** | External/Trusted | Provide randomness | Influence token distribution |

The key insight: **launchers can customize incentives but cannot extract user funds**. Even a malicious launcher cannot rug because:
- LP is burned on launch
- Token minting is rate-limited by rig logic
- Fee addresses can change but fees always flow outward

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Findings by Severity](#findings-by-severity)
3. [Slither Static Analysis Results](#slither-static-analysis-results)
4. [Contract-by-Contract Analysis](#contract-by-contract-analysis)
5. [Business Logic Verification](#business-logic-verification)
6. [Recommendations](#recommendations)
7. [Property-Based Testing Opportunities](#property-based-testing-opportunities)

---

## Findings by Severity

### CRITICAL SEVERITY (0 findings)

No critical vulnerabilities that could lead to immediate fund loss.

---

### HIGH SEVERITY (0 findings)

No high-severity vulnerabilities identified.

---

### MEDIUM SEVERITY (5 findings)

#### M-1: Multicall Auto-claim DoS

**Contract:** `Multicall.sol`
**Location:** Lines 149-152, 217-223
**Severity:** Medium

**Description:**
The auto-claim feature in `mine()` and `mineMultiple()` calls `IMineRig(rig).claim(prevMiner)` for the previous miner. If the previous miner is a blacklisted address (e.g., USDC blacklist) or a contract that reverts on token receipt, the entire mining transaction will revert.

```solidity
// Current implementation
if (prevMiner != address(0) && IMineRig(rig).accountToClaimable(prevMiner) > 0) {
    IMineRig(rig).claim(prevMiner);  // Can revert and block mining
}
```

**Impact:**
Denial of service - legitimate miners cannot mine slots where the previous miner is unable to receive funds.

**Recommendation:**
Wrap the auto-claim in a try-catch:
```solidity
if (prevMiner != address(0)) {
    try IMineRig(rig).claim(prevMiner) {} catch {}
}
```

---

#### M-2: ContentRig Zero-Price Griefing

**Contract:** `ContentRig.sol`
**Location:** Lines 220-249
**Severity:** Medium

**Description:**
When the Dutch auction price decays to 0, an attacker can "collect" (steal) an NFT for free. This wipes the previous owner's stake in the Rewarder without any compensation.

```solidity
if (price > 0) {
    // Fee transfers and deposit only happen if price > 0
}

if (prevStake > 0) {
    IRewarder(rewarder).withdraw(prevOwner, prevStake);  // Always executes
}
```

**Impact:**
Previous owners lose their entire stake if they don't monitor their NFTs and someone collects at price = 0.

**Recommendation:**
Either:
1. Require `price > 0` in the `collect()` function
2. Set a minimum price floor that never decays to zero
3. Document this behavior explicitly as intended

---

#### M-3: ContentRig No Content Unapproval Mechanism

**Contract:** `ContentRig.sol`
**Location:** Lines 334-342
**Severity:** Medium

**Description:**
Once content is approved via `approveContents()`, there is no way to revoke the approval. If inappropriate or malicious content gets approved, it cannot be unapproved.

**Impact:**
Inappropriate content may remain permanently collectible on the platform.

**Recommendation:**
Add an unapproval function:
```solidity
function unapproveContent(uint256 tokenId) external onlyOwner {
    tokenIdToApproved[tokenId] = false;
    emit ContentRig__Unapproved(tokenId);
}
```

---

#### M-4: SlotRig Owner Can Manipulate Odds

**Contract:** `SlotRig.sol`
**Location:** Lines 382-384
**Severity:** Medium

**Description:**
The contract owner can change the odds array at any time via `setOdds()`. This creates a centralization risk where the owner could:
1. Front-run a known favorable VRF callback by setting `odds = [100]` (1% payout)
2. Manipulate odds to minimize payouts

**Impact:**
Centralization risk - users must trust the owner not to manipulate odds maliciously.

**Recommendation:**
Implement a timelock on odds changes:
```solidity
uint256 public pendingOddsUpdateTime;
uint256[] public pendingOdds;
uint256 public constant ODDS_TIMELOCK = 24 hours;

function proposeOdds(uint256[] calldata _odds) external onlyOwner {
    _validateOdds(_odds);
    pendingOdds = _odds;
    pendingOddsUpdateTime = block.timestamp + ODDS_TIMELOCK;
}

function executeOddsUpdate() external {
    require(block.timestamp >= pendingOddsUpdateTime, "Timelock not expired");
    odds = pendingOdds;
    delete pendingOdds;
}
```

---

#### M-5: MineRig Entropy Callback Griefing

**Contract:** `MineRig.sol`
**Location:** Lines 359-375
**Severity:** Medium

**Description:**
An attacker can monitor pending entropy callbacks in the mempool and front-run them with a `mine()` transaction to the same slot. This advances the epoch, causing the callback to be silently ignored (line 367 check), effectively wasting the original miner's entropy fee.

```solidity
if (slotCache.epochId != epoch || slotCache.miner == address(0)) return;
```

**Impact:**
Griefing attack - victims lose their entropy fee (~$0.01-0.10 per callback).

**Recommendation:**
Document this behavior as a known limitation. The economic cost to attackers (paying slot price) typically exceeds the griefing benefit.

---

### LOW SEVERITY (9 findings)

#### L-1: Rewarder CEI Violation in notifyRewardAmount

**Contract:** `Rewarder.sol`
**Location:** Lines 125-147
**Severity:** Low

**Description:**
The `notifyRewardAmount()` function performs an external `safeTransferFrom` call before updating state variables. However, this is protected by the `nonReentrant` modifier.

**Status:** Mitigated by ReentrancyGuard.

---

#### L-2: MineRig Excess ETH Stays in Contract

**Contract:** `MineRig.sol`
**Location:** Line 330
**Severity:** Low

**Description:**
When entropy is requested, any excess ETH over the required fee stays in the contract with no recovery mechanism.

**Recommendation:** Add an admin function to recover accidentally sent ETH.

---

#### L-3: MineRig Capacity Change UPS Dilution

**Contract:** `MineRig.sol`
**Location:** Lines 308, 472-476
**Severity:** Low

**Description:**
When capacity is increased via `setCapacity()`, existing slots retain their old `ups` value until re-mined. New slots get lower `ups` values, creating temporary inconsistency.

**Status:** Likely intentional design - document this behavior.

---

#### L-4: ContentRig Anyone Can Create for Any Address

**Contract:** `ContentRig.sol`
**Location:** Lines 155-170
**Severity:** Low

**Description:**
No check that `msg.sender` has any relation to `to`. Anyone can create content on behalf of anyone else.

**Impact:** Potential for spam or content attribution issues.

---

#### L-5: ContentRig Self-Collection Stake Edge Case

**Contract:** `ContentRig.sol`
**Location:** Lines 214, 244, 248-249
**Severity:** Low

**Description:**
When a user collects their own NFT (`to == prevOwner`), stake accounting works correctly but the order of operations (deposit then withdraw) could be optimized.

---

#### L-6: Minter Divide-Before-Multiply

**Contract:** `Minter.sol`
**Location:** Lines 86, 99
**Severity:** Low

**Description:**
The pattern `(block.timestamp / WEEK) * WEEK` loses precision by rounding down to week boundaries. This is intentional for period alignment but worth noting.

---

#### L-7: Multicall TOCTOU in mineMultiple

**Contract:** `Multicall.sol`
**Location:** Lines 186-215
**Severity:** Low

**Description:**
Prices are calculated upfront for all slots, but the actual price may change between sequential `mine()` calls within the same transaction.

**Status:** Protected by `maxPrice` parameter in each `MineParams`.

---

#### L-8: FundRig No Minimum Donation

**Contract:** `FundRig.sol`
**Location:** Lines 128-155
**Severity:** Low

**Description:**
No minimum donation amount. A user could donate 1 wei on a low-activity day and claim a disproportionate share of daily emissions.

**Recommendation:** Consider adding a `minDonation` parameter.

---

#### L-9: SlotRig Modulo Bias (Theoretical)

**Contract:** `SlotRig.sol`
**Location:** Lines 313-318
**Severity:** Low

**Description:**
`uint256(randomNumber) % length` has slight bias toward lower indices when `odds.length` doesn't evenly divide 2^256. For practical array lengths, bias is negligible (~10^-75 probability difference).

---

### INFORMATIONAL (5 findings)

| # | Contract | Issue | Notes |
|---|----------|-------|-------|
| I-1 | `Auction.sol` | Free purchase at price=0 | Intentional Dutch auction behavior |
| I-2 | `ContentRig.sol` | Creator gets 82% when self-collecting | 80% prev owner + 2% creator fees to same address |
| I-3 | `MineRig.sol` | Epoch ID uses unchecked | Safe - would take 10^70 years to overflow |
| I-4 | `MockEntropy.sol` | Locked ether | Mock contract only, not production |
| I-5 | `MockUniswapV2.sol` | Unchecked transfer | Mock contract only |

---

## Slither Static Analysis Results

**Tool:** Slither v0.11.4
**Configuration:** `--exclude-dependencies`

### Summary

| Severity | Count |
|----------|-------|
| High | 5 |
| Medium | 19 |
| Low | 79 |
| Informational | 237 |
| Optimization | 2 |

### Notable Findings Analysis

| Slither Check | Count | Assessment |
|---------------|-------|------------|
| arbitrary-send-eth | 3 | **False Positive** - ETH sent to validated system contracts only |
| reentrancy-no-eth | 7 | **Mitigated** - All protected by `nonReentrant` modifier |
| unchecked-transfer | 2 | **Mock only** - Not in production contracts |
| divide-before-multiply | 2 | **Low** - Only in Minter.sol, intentional for period alignment |
| incorrect-equality | 3 | **False Positive** - Intentional strict equality checks |
| locked-ether | 1 | **Mock only** - MockEntropy.sol |
| unused-return | 7 | **Acceptable** - Return values intentionally unused |

---

## Contract-by-Contract Analysis

### MineRig.sol

**Purpose:** Seat-based mining rig with Dutch auctions for slot acquisition.

| Component | Status | Notes |
|-----------|--------|-------|
| Dutch Auction Formula | ✅ Correct | Linear decay, no overflow risk |
| Fee Distribution | ✅ Correct | Treasury receives remainder/dust |
| UPS Halving | ✅ Correct | Bounded at 64 halvings, tailUps floor |
| Miner Fee Pull Pattern | ✅ Secure | CEI pattern followed |
| Entropy Callback | ✅ Secure | Proper authentication, stale check |
| Reentrancy | ✅ Protected | nonReentrant on all state-changing functions |

### SlotRig.sol

**Purpose:** Slot machine-style mining with VRF-determined payouts.

| Component | Status | Notes |
|-----------|--------|-------|
| VRF Integration | ✅ Secure | Pyth Entropy properly integrated |
| Prize Pool | ✅ Secure | Cannot be drained via reentrancy |
| Odds Mechanism | ⚠️ Centralized | Owner can change without timelock |
| Emission Minting | ✅ Correct | Time-based accumulation |

### FundRig.sol

**Purpose:** Donation-based token distribution with daily pools.

| Component | Status | Notes |
|-----------|--------|-------|
| Daily Pool Logic | ✅ Correct | Proper isolation between days |
| Emission Halving | ✅ Correct | 30-day periods, minEmission floor |
| Fee Distribution | ✅ Correct | 50/45/5 split correctly implemented |
| Claim Mechanism | ✅ Secure | CEI pattern, double-claim prevention |

### ContentRig.sol

**Purpose:** NFT collection with "steal" mechanic and staking rewards.

| Component | Status | Notes |
|-----------|--------|-------|
| Transfer Restrictions | ✅ Secure | All external transfer paths blocked |
| Fee Math | ✅ Correct | Treasury receives remainder |
| Stake Tracking | ✅ Correct | Proper Rewarder integration |
| Moderation | ⚠️ Incomplete | No unapproval mechanism |
| Zero-Price | ⚠️ Griefable | Can collect for free at epoch end |

### Auction.sol

**Purpose:** Dutch auction for treasury asset sales.

| Component | Status | Notes |
|-----------|--------|-------|
| Price Formula | ✅ Correct | Linear decay |
| Front-running | ✅ Protected | epochId, deadline, maxPayment checks |
| Reentrancy | ✅ Protected | nonReentrant applied |

### Multicall.sol

**Purpose:** Batching helper for mining operations.

| Component | Status | Notes |
|-----------|--------|-------|
| Rig Validation | ✅ Secure | Checks isDeployedRig |
| Launch Function | ✅ Secure | Launcher override prevents impersonation |
| Auto-claim | ⚠️ DoS Risk | Can block mining if prev miner blacklisted |

### Rewarder.sol

**Purpose:** Staking rewards distribution for ContentRig.

| Component | Status | Notes |
|-----------|--------|-------|
| Reward Calculation | ✅ Correct | Standard reward-per-token model |
| Reentrancy | ✅ Protected | nonReentrant on all functions |
| CEI Pattern | ⚠️ Minor violation | notifyRewardAmount, but protected |

---

## Business Logic Verification

| Mechanism | Status | Verified Behavior |
|-----------|--------|-------------------|
| Dutch Auction Formula | ✅ | Price = initPrice - (initPrice * timePassed / epochPeriod) |
| Fee Distribution | ✅ | All fees sum correctly, treasury gets remainder |
| UPS Halving | ✅ | Geometric series threshold, bounded iterations |
| Miner Fee Pull Pattern | ✅ | Balance zeroed before transfer |
| VRF Callback Auth | ✅ | msg.sender == entropy validated |
| Transfer Restrictions | ✅ | All external ERC721 transfer paths blocked |
| Epoch Overflow | ✅ | uint256 - practically impossible to overflow |

---

## Recommendations

### Priority 1: Fix Before Mainnet

1. **M-1: Multicall Auto-claim DoS** - Wrap in try-catch
2. **M-2: ContentRig Zero-Price** - Add minimum price or document behavior
3. **M-3: Content Unapproval** - Add unapproval function

### Priority 2: Consider for V2

4. **M-4: Odds Timelock** - Add timelock for SlotRig odds changes
5. **L-2: ETH Recovery** - Add admin function to recover stuck ETH
6. **L-8: Minimum Donation** - Add minDonation parameter to FundRig

### Documentation

- Document the entropy callback griefing possibility (M-5)
- Document zero-price collection behavior if intentional (M-2)
- Document UPS dilution on capacity change (L-3)

---

## Property-Based Testing Opportunities

### Invariants to Test

1. `totalMinted` should always equal the sum of all `mint()` calls
2. `sum(tokenIdToStake)` should always equal `rewarder.totalSupply`
3. Fee splits should always sum to 100% (10,000 basis points)
4. Price should always decay monotonically within an epoch
5. `accountToClaimable[x]` should never exceed total fees collected

### Fuzz Testing Targets

1. Random `upsMultipliers` array values within MIN/MAX bounds
2. Extreme `halvingAmount` values near boundaries
3. Random epoch timing for price calculations
4. Multiple concurrent miners on same slot
5. Donation amounts at uint256 boundaries

---

## Conclusion

The Farplace smart contracts demonstrate **solid security practices**:

- ✅ Proper use of OpenZeppelin security primitives (ReentrancyGuard, SafeERC20, Ownable)
- ✅ Comprehensive input validation throughout
- ✅ CEI pattern mostly followed
- ✅ Immutables for critical parameters
- ✅ Appropriate access controls

**Primary concerns** are:
1. Centralization risks (owner-controlled odds, no timelocks)
2. Edge cases around zero-price scenarios enabling griefing
3. Auto-claim feature potentially blocking legitimate operations

**Overall Assessment:** The codebase is production-ready with the recommended fixes for medium-severity findings.

---

## Appendix: Files Analyzed

```
packages/hardhat/contracts/
├── Auction.sol
├── Multicall.sol
├── Registry.sol
├── Unit.sol
├── UnitFactory.sol
├── interfaces/
│   ├── IAuction.sol
│   ├── IAuctionFactory.sol
│   ├── IRegistry.sol
│   ├── IUniswapV2.sol
│   ├── IUnit.sol
│   └── IUnitFactory.sol
├── mocks/
│   ├── MockEntropy.sol
│   └── MockUniswapV2.sol
└── rigs/
    ├── charity/
    │   ├── FundCore.sol
    │   ├── FundRig.sol
    │   ├── FundRigFactory.sol
    │   └── interfaces/
    ├── content/
    │   ├── ContentCore.sol
    │   ├── ContentRig.sol
    │   ├── ContentRigFactory.sol
    │   ├── Minter.sol
    │   ├── MinterFactory.sol
    │   ├── Rewarder.sol
    │   ├── RewarderFactory.sol
    │   └── interfaces/
    ├── seat/
    │   ├── MineCore.sol
    │   ├── MineRig.sol
    │   ├── MineRigFactory.sol
    │   └── interfaces/
    └── spin/
        ├── SlotCore.sol
        ├── SlotRig.sol
        ├── SlotRigFactory.sol
        └── interfaces/
```

**Total Files:** 49
**Total SLOC:** ~3,568
**Dependencies SLOC:** ~2,001 (OpenZeppelin, Pyth)

---

## Supplemental Review (January 20, 2026 - Second Pass)

### Additional Findings

#### M-6: Unit Token Rig Address Not Truly Immutable

**Contract:** `Unit.sol`
**Location:** Lines 42-47

**Description:**
The `setRig()` function allows the current rig to transfer minting rights. The NatSpec claims this becomes "permanently locked" when set to a Rig contract (which has no `setRig` function), but there's no on-chain enforcement.

```solidity
function setRig(address _rig) external {
    if (msg.sender != rig) revert Unit__NotRig();
    if (_rig == address(0)) revert Unit__ZeroRig();
    rig = _rig;  // No verification that _rig lacks setRig capability
}
```

**Impact:**
- If accidentally set to an EOA, that EOA can change it again
- If set to a malicious contract with a `setRig` selector, minting rights could be stolen

**Recommendation:**
Consider making `rig` immutable or adding a one-time lock.

---

#### M-7: ContentRig Creator Address Can Block All Future Collections

**Contract:** `ContentRig.sol`
**Location:** Line 233

**Description:**
The creator address receives 2% on every collection via `safeTransfer`. If the creator address is a contract that reverts on token receipt, all future `collect()` calls will permanently fail.

```solidity
IERC20(quote).safeTransfer(creator, creatorAmount);
```

**Impact:**
Permanent DoS on a specific content NFT with no recovery mechanism.

**Recommendation:**
Use a pull pattern for creator fees similar to MineRig's miner fees:
```solidity
mapping(address => uint256) public creatorClaimable;

// In collect():
creatorClaimable[creator] += creatorAmount;

// Add claim function:
function claimCreatorFees() external {
    uint256 amount = creatorClaimable[msg.sender];
    creatorClaimable[msg.sender] = 0;
    IERC20(quote).safeTransfer(msg.sender, amount);
}
```

---

#### L-10: SlotRig Excess ETH Not Refunded

**Contract:** `SlotRig.sol`
**Location:** Lines 284-289

**Description:**
Similar to MineRig, excess ETH above the entropy fee is trapped with no recovery mechanism.

**Recommendation:**
Refund excess or add admin recovery function.

---

### Security Properties Re-Verified

| Property | Status |
|----------|--------|
| All reentrancy guards in place | ✅ |
| SafeERC20 used consistently | ✅ |
| Input validation comprehensive | ✅ |
| Frontrun protection (epochId/deadline) | ✅ |
| Slippage protection (maxPrice) | ✅ |
| CEI pattern in claims | ✅ |
| No unbounded loops in user functions | ✅ |

### Updated Recommendations Priority

**Priority 1 (Critical Path):**
1. M-1: Multicall Auto-claim DoS - wrap in try-catch
2. M-7: ContentRig creator DoS - use pull pattern
3. M-4: SlotRig odds timelock - prevent manipulation between spin/callback

**Priority 2 (Before Mainnet):**
4. M-2: ContentRig zero-price griefing
5. M-3: Content unapproval mechanism
6. M-6: Unit rig address locking

**Priority 3 (Nice to Have):**
7. L-2/L-10: ETH recovery mechanisms
8. L-8: Minimum donation for FundRig
