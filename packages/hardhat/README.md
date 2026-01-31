# Farplace Smart Contracts

A decentralized token launchpad on Base with three distribution mechanisms: mining, spinning, and funding. All tokens are paired with DONUT, initial liquidity is permanently locked, and token emissions follow halving schedules.

---

## Table of Contents

- [Overview](#overview)
- [Rig Types](#rig-types)
  - [MineRig - Competitive Mining](#minerig---competitive-mining)
  - [SpinRig - Slot Machine](#spinrig---slot-machine)
  - [FundRig - Donation Pool](#fundrig---donation-pool)
- [Shared Infrastructure](#shared-infrastructure)
  - [Launch Sequence](#launch-sequence)
  - [Unit Token](#unit-token)
  - [Dutch Auction Pricing](#dutch-auction-pricing)
  - [Treasury Auctions](#treasury-auctions)
  - [Registry](#registry)
- [Contract Architecture](#contract-architecture)
- [Contract Reference](#contract-reference)
- [Parameter Bounds](#parameter-bounds)
- [Security Model](#security-model)
- [Development](#development)

---

## Overview

When someone launches a token on Farplace, the system:

1. Deploys an ERC20 token (Unit) with voting/permit support
2. Creates a Unit/DONUT liquidity pool on Uniswap V2
3. Burns the LP tokens permanently (liquidity can never be removed)
4. Deploys a Rig contract that controls all future token minting
5. Deploys an Auction contract for treasury LP buybacks
6. Locks minting rights to the Rig (one-time, irreversible)

The launcher chooses one of three rig types, each with different distribution mechanics. All three share the same token, LP, and auction infrastructure.

---

## Rig Types

### MineRig - Competitive Mining

Users compete for mining slots via Dutch auction. The active miner earns token emissions over time. When someone takes over a slot, the previous miner gets paid.

**How it works:**

```
Epoch 1: Price starts at initPrice, decays linearly to 0
  Alice pays 0.5 USDC when price hits that level
  Alice is now mining slot 0, earning tokens at UPS rate

Epoch 2: Price resets to 0.5 * priceMultiplier
  Bob pays 0.8 USDC to take over
  Alice receives: her mined tokens + 0.64 USDC (80% of Bob's payment)
  Bob is now mining

Epoch 3+: Cycle continues...
```

**Fee split on each mine:**

| Recipient | Share | Description |
|-----------|-------|-------------|
| Previous Miner | 80% | Reward for holding the slot |
| Treasury | 15% | Accumulates for LP auctions |
| Team | 4% | Launcher's revenue |
| Protocol | 1% | Platform fee |

**Token emissions:**

- Each slot earns `globalUps / capacity` tokens per second
- `globalUps` halves based on total tokens minted (supply-based halving)
- Halving uses a geometric threshold: first halving at `halvingAmount`, second at `halvingAmount + halvingAmount/2`, third at `halvingAmount + halvingAmount/2 + halvingAmount/4`, etc.
- Emissions floor at `tailUps` (never stops completely)

**Multi-slot support:**

- Rigs start with 1 slot, owner can increase up to 256
- Total emission rate stays constant regardless of capacity (divided equally among slots)
- Each slot has its own independent Dutch auction and miner

**UPS Multipliers (optional):**

- When enabled, each mine requests VRF randomness from Pyth Entropy
- A random multiplier (1x-10x) is applied to that slot's emission rate
- Multiplier expires after `upsMultiplierDuration`, resetting to 1x on next mine
- Requires ETH for the entropy fee

**Miner fee distribution:**

Previous miners accumulate claimable balances (pull pattern). They call `claim()` to withdraw, or the Multicall auto-claims on their behalf during the next mine.

---

### SpinRig - Slot Machine

Users pay to spin a slot machine. A VRF-determined random outcome decides what percentage of the prize pool they win.

**How it works:**

```
1. Token emissions accumulate in the prize pool over time
2. User pays the current Dutch auction price to spin
3. Pyth Entropy provides a random number via VRF callback
4. Random number selects an odds entry from the configured array
5. User wins that percentage of the current prize pool
```

**Fee split on each spin:**

| Recipient | Share | Description |
|-----------|-------|-------------|
| Treasury | 95% | Accumulates for LP auctions |
| Team | 4% | Launcher's revenue |
| Protocol | 1% | Platform fee |

**Odds configuration:**

The launcher defines an array of possible payout percentages (in basis points). Each spin randomly selects one entry.

Example: `odds = [100, 500, 1000, 5000]` means each spin has equal chance of winning 1%, 5%, 10%, or 50% of the prize pool. Maximum single payout is 80% (`MAX_ODDS_BPS = 8000`), ensuring the pool never fully drains.

**Token emissions:**

- Emissions are time-based: `timeElapsed * currentUps`
- `currentUps` halves every `halvingPeriod` seconds
- Emissions are minted to the prize pool (the SpinRig contract itself) on each spin
- Emissions floor at `tailUps`

**VRF mechanics:**

Every spin requires an entropy fee (paid in ETH). The Pyth Entropy contract calls back with randomness, and the payout is calculated and transferred in the callback. If multiple spins happen before callbacks resolve, each callback uses the live prize pool balance at callback time.

---

### FundRig - Donation Pool

Users donate payment tokens to a daily pool. Donations are split between a designated recipient and the treasury. At the end of each day, donors claim their proportional share of that day's token emission.

**How it works:**

```
Day 0: Emission = 1000 tokens
  Alice donates 60 USDC, Bob donates 40 USDC
  Total donations: 100 USDC

  50 USDC -> recipient (charity, creator, etc.)
  45 USDC -> treasury (for LP auctions)
   4 USDC -> team
   1 USDC -> protocol

Day 1: Alice claims 600 tokens (60%), Bob claims 400 tokens (40%)

Day 1: Emission = 1000 tokens (same until halving)
  ...cycle continues
```

**Fee split on each donation:**

| Recipient | Share | Description |
|-----------|-------|-------------|
| Recipient | 50% | The cause/creator being funded |
| Treasury | 45% | Accumulates for LP auctions |
| Team | 4% | Launcher's revenue |
| Protocol | 1% | Platform fee |

**Token emissions:**

- Each day has a fixed emission amount: `initialEmission >> (day / halvingPeriod)`
- Halving is day-count based (e.g., every 30 days)
- Floor at `minEmission`
- Donors claim proportionally: `(userDonation / dayTotal) * dayEmission`

**Claiming:**

- Claims are available once the day ends (day < currentDay)
- Each account can claim once per day
- No double claims (tracked per account per day)
- Multicall provides batch claiming across multiple days

**Minimum donation:** 10,000 wei of the payment token (prevents dust donations that produce zero fee splits).

---

## Shared Infrastructure

### Launch Sequence

All three rig types follow the same launch flow, orchestrated by their respective Core contract:

```
User calls Core.launch(params)
    |
    +-- 1. Validate Core-specific params (launcher, quoteToken, donut, name, symbol, unitAmount)
    +-- 2. Transfer DONUT from launcher
    +-- 3. Deploy Unit token (ERC20 with voting/permit)
    +-- 4. Mint initial Unit tokens for LP seeding
    +-- 5. Create Uniswap V2 pair (Unit/DONUT), add liquidity
    +-- 6. Burn LP tokens to 0x000...dEaD (permanent liquidity)
    +-- 7. Deploy Auction contract (LP buyback mechanism)
    +-- 8. Deploy Rig contract via factory (validates rig-specific params)
    +-- 9. Lock minting rights: Unit.setRig(rig) (one-time, irreversible)
    +-- 10. Transfer Rig ownership to launcher
    +-- 11. Register with central Registry
```

### Unit Token

Every launch creates a new Unit (ERC20) with:

- **ERC20Permit** - Gasless approvals via signatures
- **ERC20Votes** - On-chain governance voting support
- **Controlled minting** - Only the Rig contract can mint, permanently locked via one-time `setRig()`
- **No supply cap** - Supply is bounded only by the rig's halving schedule and tail emission
- **Burn support** - Anyone can burn their own tokens

### Dutch Auction Pricing

All rig types and the Auction contract use the same Dutch auction mechanism:

```
Price = initPrice * (epochPeriod - elapsed) / epochPeriod
```

Price starts at `initPrice` and decays linearly to 0 over `epochPeriod`. When someone buys:
- A new epoch starts
- `initPrice` is set to `max(pricePaid * priceMultiplier, minInitPrice)`

This makes front-running unprofitable (being first means paying the highest price) and provides natural price discovery.

### Treasury Auctions

Each rig has an associated Auction contract. Treasury fees (15-95% depending on rig type) accumulate as the rig's quote token in the Auction contract. Anyone can buy the accumulated tokens by paying with LP tokens, which are sent to the burn address.

This creates deflationary pressure on the LP supply: as more treasury fees accumulate and get auctioned off, LP tokens are permanently removed from circulation.

### Registry

A central Registry contract tracks all deployed rigs across all types. Only approved Core contracts (factories) can register new rigs. The Registry provides:

- Enumeration of all rigs (paginated)
- Filtering by rig type ("mine", "spin", "fund")
- Lookup of rig metadata (type, unit token, launcher, creation time)

---

## Contract Architecture

```
                        +------------------+
                        |    Registry      |
                        | (central index)  |
                        +--------+---------+
                                 |
            +--------------------+--------------------+
            |                    |                    |
   +--------v--------+  +-------v--------+  +--------v--------+
   |    MineCore      |  |   SpinCore     |  |   FundCore      |
   | (mine launcher)  |  | (spin launcher)|  | (fund launcher) |
   +--+----+----+-----+  +--+----+---+----+  +--+----+---+-----+
      |    |    |            |    |   |          |    |   |
      v    v    v            v    v   v          v    v   v
   Unit  Mine  Auction    Unit  Spin Auction   Unit  Fund Auction
   Factory Rig  Factory   Factory Rig Factory  Factory Rig Factory
         Factory                Factory              Factory
      |    |    |            |    |   |          |    |   |
      v    v    v            v    v   v          v    v   v
   +-----+ +------+ +-----+ +----+ +-+---+ +--+ +----+ +-+---+ +--+
   |Unit | |Mine  | |Auct.| |Unit| |Spin | |Au| |Unit| |Fund | |Au|
   |ERC20| |Rig   | |     | |    | |Rig  | |  | |    | |Rig  | |  |
   +-----+ +------+ +-----+ +----+ +-----+ +--+ +----+ +-----+ +--+

   +------------------+  +-----------------+  +------------------+
   |  MineMulticall   |  | SpinMulticall   |  |  FundMulticall   |
   | (batch ops +     |  | (batch ops +    |  | (batch ops +     |
   |  view helpers)   |  |  view helpers)  |  |  view helpers)   |
   +------------------+  +-----------------+  +------------------+
```

### File Structure

```
contracts/
+-- Auction.sol              # Dutch auction for treasury LP buybacks
+-- AuctionFactory.sol       # Deploys Auction instances
+-- Registry.sol             # Central rig registry
+-- Unit.sol                 # ERC20 token with voting/permit
+-- UnitFactory.sol          # Deploys Unit instances
+-- interfaces/              # Shared interfaces
+-- rigs/
    +-- mine/
    |   +-- MineCore.sol         # Launch orchestrator for MineRigs
    |   +-- MineRig.sol          # Competitive mining with slots
    |   +-- MineRigFactory.sol   # Deploys MineRig instances
    |   +-- MineMulticall.sol    # Batch mining + view helpers
    |   +-- interfaces/
    +-- spin/
    |   +-- SpinCore.sol         # Launch orchestrator for SpinRigs
    |   +-- SpinRig.sol          # VRF slot machine
    |   +-- SpinRigFactory.sol   # Deploys SpinRig instances
    |   +-- SpinMulticall.sol    # Batch spin + view helpers
    |   +-- interfaces/
    +-- fund/
        +-- FundCore.sol         # Launch orchestrator for FundRigs
        +-- FundRig.sol          # Donation pool with daily claims
        +-- FundRigFactory.sol   # Deploys FundRig instances
        +-- FundMulticall.sol    # Batch fund/claim + view helpers
        +-- interfaces/
```

---

## Contract Reference

### Core Contracts (MineCore / SpinCore / FundCore)

```solidity
// Launch a new rig (deploys Unit + LP + Auction + Rig)
function launch(LaunchParams calldata params)
    external returns (address unit, address rig, address auction, address lpToken)

// Admin
function setProtocolFeeAddress(address) external      // owner only
function setMinDonutForLaunch(uint256) external        // owner only

// View
function deployedRigsLength() external view returns (uint256)
function isDeployedRig(address) external view returns (bool)
function rigToUnit(address) external view returns (address)
function rigToAuction(address) external view returns (address)
function rigToLP(address) external view returns (address)
```

### MineRig

```solidity
// Mine a slot (take over as active miner)
function mine(
    address miner,        // who receives future tokens
    uint256 index,        // slot index (0 for single-slot rigs)
    uint256 _epochId,     // frontrun protection
    uint256 deadline,     // tx deadline
    uint256 maxPrice,     // slippage protection
    string memory _uri    // slot metadata
) external payable returns (uint256 price)

// Withdraw accumulated miner fees
function claim(address account) external returns (uint256 amount)

// Owner functions
function setCapacity(uint256 _capacity) external      // increase slots (one-way)
function setTreasury(address) external
function setTeam(address) external
function setUri(string memory) external

// View
function getPrice(uint256 index) external view returns (uint256)
function getUps() external view returns (uint256)
function getSlot(uint256 index) external view returns (Slot memory)
function accountToClaimable(address) external view returns (uint256)
```

### SpinRig

```solidity
// Spin the slot machine (requires ETH for entropy fee)
function spin(
    address spinner,      // who receives winnings
    uint256 _epochId,     // frontrun protection
    uint256 deadline,     // tx deadline
    uint256 maxPrice      // slippage protection
) external payable returns (uint256 price)

// Owner functions
function setTreasury(address) external
function setTeam(address) external
function setUri(string memory) external

// View
function getPrice() external view returns (uint256)
function getUps() external view returns (uint256)
function getPrizePool() external view returns (uint256)
function getPendingEmissions() external view returns (uint256)
function getOdds() external view returns (uint256[] memory)
function getEntropyFee() external view returns (uint256)
```

### FundRig

```solidity
// Donate to the daily pool
function fund(address account, uint256 amount) external

// Claim token reward for a past day
function claim(address account, uint256 day) external

// Owner functions
function setRecipient(address) external
function setTreasury(address) external
function setTeam(address) external
function setUri(string memory) external

// View
function currentDay() external view returns (uint256)
function getDayEmission(uint256 day) external view returns (uint256)
function getDayTotal(uint256 day) external view returns (uint256)
function getPendingReward(uint256 day, address account) external view returns (uint256)
function getUserDonation(uint256 day, address account) external view returns (uint256)
```

### Auction

```solidity
// Buy accumulated treasury tokens with LP tokens (LP is burned)
function buy(
    address[] calldata assets,      // tokens to claim
    address assetsReceiver,         // receives claimed tokens
    uint256 _epochId,               // frontrun protection
    uint256 deadline,               // tx deadline
    uint256 maxPaymentTokenAmount   // slippage protection
) external returns (uint256 paymentAmount)

// View
function getPrice() external view returns (uint256)
function epochId() external view returns (uint256)
```

### Multicall Contracts

Each rig type has a Multicall helper that handles token approvals and provides aggregated view functions.

```solidity
// MineMulticall
function mine(address rig, uint256 index, uint256 epochId, uint256 deadline, uint256 maxPrice, string calldata slotUri) external payable
function mineMultiple(address rig, MineParams[] calldata params, uint256 deadline) external payable
function buy(address rig, uint256 epochId, uint256 deadline, uint256 maxPaymentTokenAmount) external
function launch(LaunchParams calldata params) external returns (address, address, address, address)
function getRig(address rig, uint256 index, address account) external view returns (RigState memory)
function getAuction(address rig, address account) external view returns (AuctionState memory)

// SpinMulticall
function spin(address rig, uint256 epochId, uint256 deadline, uint256 maxPrice) external payable
function buy(...) external
function launch(...) external returns (...)
function getRig(address rig, address account) external view returns (RigState memory)
function getAuction(address rig, address account) external view returns (AuctionState memory)

// FundMulticall
function fund(address rig, address account, uint256 amount) external
function claim(address rig, address account, uint256 day) external
function claimMultiple(address rig, address account, uint256[] calldata dayIds) external
function buy(...) external
function launch(...) external returns (...)
function getRig(address rig, address account) external view returns (RigState memory)
function getClaimableDays(address rig, address account, uint256 startDay, uint256 endDay) external view returns (ClaimableDay[] memory)
function getAuction(address rig, address account) external view returns (AuctionState memory)
```

---

## Parameter Bounds

### MineRig

| Parameter | Min | Max | Description |
|-----------|-----|-----|-------------|
| `initialUps` | 1 | 1e24 | Starting token emission (units/sec) |
| `tailUps` | 1 | initialUps | Minimum emission floor |
| `halvingAmount` | 1000e18 | - | Supply threshold for first halving |
| `epochPeriod` | 10 minutes | 365 days | Dutch auction duration |
| `priceMultiplier` | 1.1x | 3x | Price reset multiplier |
| `minInitPrice` | 1e6 | uint192 max | Floor starting price |
| `upsMultipliers[]` | 1x | 10x | Random emission multiplier options |
| `upsMultiplierDuration` | 1 hour | 7 days | How long a multiplier lasts |
| `capacity` | 1 | 256 | Number of mining slots |

### SpinRig

| Parameter | Min | Max | Description |
|-----------|-----|-----|-------------|
| `initialUps` | 1 | 1e24 | Starting token emission (units/sec) |
| `tailUps` | 1 | initialUps | Minimum emission floor |
| `halvingPeriod` | 7 days | 365 days | Time between halvings |
| `epochPeriod` | 10 minutes | 365 days | Dutch auction duration |
| `priceMultiplier` | 1.1x | 3x | Price reset multiplier |
| `minInitPrice` | 1e6 | uint192 max | Floor starting price |
| `odds[]` | 10 bps (0.1%) | 8000 bps (80%) | Payout percentages |

### FundRig

| Parameter | Min | Max | Description |
|-----------|-----|-----|-------------|
| `initialEmission` | 1e18 | 1e30 | Starting daily token emission |
| `minEmission` | 1 | initialEmission | Minimum daily emission floor |
| `halvingPeriod` | 7 days | 365 days | Days between halvings |

### Auction (shared)

| Parameter | Min | Max | Description |
|-----------|-----|-----|-------------|
| `epochPeriod` | 1 hour | 365 days | Auction duration |
| `priceMultiplier` | 1.1x | 3x | Price reset multiplier |
| `minInitPrice` | 1e6 | uint192 max | Floor starting price |
| `initPrice` | minInitPrice | uint192 max | Initial starting price |

---

## Security Model

### Immutable After Launch

- Token name and symbol
- Quote token (payment token)
- All emission parameters (UPS, halving, tail)
- All price parameters (epoch period, multiplier, min price)
- Odds array (SpinRig)
- Recipient address split percentages (all rigs)
- Initial liquidity (LP burned to dead address)
- Minting rights (permanently locked to Rig)

### Mutable by Rig Owner

- Treasury address
- Team address (can be set to zero to disable)
- Metadata URI
- Capacity (MineRig only, can only increase)
- Recipient address (FundRig only)

### Cannot Be Done

- Mint tokens outside the Rig mechanism
- Remove or reduce initial liquidity
- Pause, stop, or freeze any rig
- Change emission rates or price mechanics
- Upgrade contracts (all are non-upgradeable)

### Protections

- **ReentrancyGuard** on all state-changing entry points
- **SafeERC20** for all token transfers
- **Frontrun protection** via epochId, deadline, and maxPrice on all user-facing functions
- **Pull-pattern** for MineRig miner fee distribution (prevents DoS via reverting recipients)
- **VRF randomness** via Pyth Entropy for SpinRig and MineRig multipliers

### Unsupported Token Types

The following are **not supported** as quote/payment tokens:

- **Fee-on-transfer tokens** (transfer amount != received amount)
- **Rebasing tokens** (balances change without transfers)
- **Tokens with blocklists** (may cause unexpected reverts)

Use standard ERC20 tokens: USDC, WETH, DAI, etc.

### Audit

See [SECURITY_AUDIT_REPORT.md](./docs/SECURITY_AUDIT_REPORT.md) for the full audit report.

- 0 Critical, 0 High severity findings
- 928 tests passing (including invariant, fuzz, exploit, and edge case tests)
- 10 findings documented (all INFO or LOW, most acknowledged as intended)

---

## Development

### Setup

```bash
npm install
npx hardhat compile
```

### Testing

```bash
# Run all 928 tests
npx hardhat test

# Run specific test file
npx hardhat test tests/mine/testBusinessLogic.js

# With gas reporting
REPORT_GAS=true npx hardhat test
```

### Test Suite

| Directory | Files | Coverage |
|-----------|-------|----------|
| `tests/mine/` | 9 files | MineRig core, business logic, exploits, factory, multicall, invariants |
| `tests/spin/` | 3 files | SpinRig core, invariants |
| `tests/fund/` | 3 files | FundRig core, fund rig, invariants |
| `tests/security/` | 4 files | Edge cases, exploits, fuzz testing, invariants |

### Deployment

```bash
# Configure .env
PRIVATE_KEY=your_deployer_private_key
RPC_URL=https://mainnet.base.org
SCAN_API_KEY=your_basescan_api_key

# Deploy
npx hardhat run scripts/deploy.js --network base
```

### Dependencies

- Solidity 0.8.19 (Paris EVM target)
- OpenZeppelin Contracts (ERC20, Ownable, ReentrancyGuard, SafeERC20)
- Pyth Entropy (VRF for SpinRig and MineRig multipliers)
- Uniswap V2 (LP creation)

---

## License

MIT
