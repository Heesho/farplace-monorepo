# Rig Parameters Documentation

This document details all parameters for each rig type, including launch-time configuration and post-launch settable parameters.

---

## SpinRig (Slot Machine-Style Mining)

**Contracts**: `SpinRig.sol`, `SpinRigFactory.sol`, `SpinCore.sol`

### Parameters Set at Launch (Immutable)

| Parameter | Type | Constraints | Description |
|-----------|------|-------------|-------------|
| `unit` | address | != address(0) | Unit token to be minted |
| `quote` | address | != address(0) | Payment token (e.g., USDC) |
| `entropy` | address | != address(0) | Pyth Entropy VRF provider |
| `treasury` | address | != address(0) | Initial treasury for fee collection |
| `core` | address | != address(0) | Core contract address |
| `epochPeriod` | uint256 | 10 minutes - 365 days | Dutch auction period duration |
| `priceMultiplier` | uint256 | 1.1x - 3x (1e18 scale) | Price multiplier for next epoch |
| `minInitPrice` | uint256 | 1e6 - type(uint192).max | Minimum starting price per epoch |
| `initialUps` | uint256 | 1 - 1e24 | Starting units per second emission rate |
| `tailUps` | uint256 | 1 - initialUps | Floor emission rate (never goes below) |
| `halvingPeriod` | uint256 | 7 days - 365 days | Time between halving events |

### Parameters Settable After Launch

| Function | Parameter | Constraints | Description |
|----------|-----------|-------------|-------------|
| `setTreasury(address)` | `_treasury` | != address(0) | Updates fee recipient |
| `setTeam(address)` | `_team` | Can be address(0) | Updates team fee recipient (4%). If zero, team fees go to treasury |
| `setOdds(uint256[])` | `_odds` | Each: 10-8000 bps (0.1%-80%), non-empty array | Updates spin payout odds |
| `setUri(string)` | `_uri` | Any string | Updates rig metadata URI |

### Fee Distribution
- **95%** to Treasury
- **4%** to Team (or Treasury if team == address(0))
- **1%** to Protocol

### Emission Mechanics
- Emissions halve every `halvingPeriod`
- Floor rate is `tailUps` (emissions never go below this)
- Dutch auction price decays linearly from `initPrice` to 0 over `epochPeriod`

---

## FundRig (Donation-Based Distribution)

**Contracts**: `FundRig.sol`, `FundRigFactory.sol`, `FundCore.sol`

### Parameters Set at Launch (Immutable)

| Parameter | Type | Constraints | Description |
|-----------|------|-------------|-------------|
| `paymentToken` | address | != address(0) | ERC20 token accepted for donations |
| `unit` | address | != address(0) | Unit token to be minted |
| `treasury` | address | != address(0) | Initial treasury for fee collection |
| `team` | address | Can be address(0) | Initial team fee recipient |
| `core` | address | != address(0) | Core contract address |
| `initialEmission` | uint256 | 1e18 - 1e30 | Unit tokens emitted per day initially |
| `minEmission` | uint256 | 1 - initialEmission | Floor emission per day |
| `minDonation` | uint256 | >= 100 | Minimum donation amount |

### Parameters Settable After Launch

| Function | Parameter | Constraints | Description |
|----------|-----------|-------------|-------------|
| `setRecipient(address)` | `_recipient` | != address(0) | Sets the recipient address that receives 50% of donations |
| `setTreasury(address)` | `_treasury` | != address(0) | Updates treasury address |
| `setTeam(address)` | `_team` | Can be address(0) | Updates team fee recipient. If zero, team fees go to treasury |
| `setUri(string)` | `_uri` | Any string | Updates rig metadata URI |

### Fee Distribution
- **50%** to Recipient
- **45%** to Treasury
- **4%** to Team (or Treasury if team == address(0))
- **1%** to Protocol

### Emission Mechanics
- Fixed 1-day periods (86400 seconds)
- Emissions halve every 30 days automatically
- Floor rate is `minEmission`
- Donors claim proportional share after each day ends
- Formula: `userReward = (userDonation / dayTotal) * dayEmission`

---

## MineRig (Slot Competition Mining)

**Contracts**: `MineRig.sol`, `MineRigFactory.sol`, `MineCore.sol`

### Parameters Set at Launch (Immutable)

| Parameter | Type | Constraints | Description |
|-----------|------|-------------|-------------|
| `unit` | address | != address(0) | Unit token to mint |
| `quote` | address | != address(0) | Payment token for mining |
| `entropy` | address | != address(0) | Pyth Entropy for randomness |
| `protocol` | address | Can be address(0) | Protocol fee recipient |
| `treasury` | address | != address(0) | Treasury for fee collection |
| `epochPeriod` | uint256 | 10 minutes - 365 days | Dutch auction period per slot |
| `priceMultiplier` | uint256 | 1.1x - 3x (1e18 scale) | Price multiplier for next epoch |
| `minInitPrice` | uint256 | 1e6 - type(uint192).max | Minimum starting price |
| `initialUps` | uint256 | 1 - 1e24 | Starting units per second |
| `tailUps` | uint256 | 1 - initialUps | Floor emission rate |
| `halvingAmount` | uint256 | >= 1000 ether | Token supply threshold for halving |

### Parameters Settable After Launch

| Function | Parameter | Constraints | Description |
|----------|-----------|-------------|-------------|
| `setTreasury(address)` | `_treasury` | != address(0) | Updates treasury address |
| `setTeam(address)` | `_team` | Can be address(0) | Updates team fee recipient (4%) |
| `setCapacity(uint256)` | `_capacity` | > current capacity, <= 1,000,000 | Increases number of mining slots |
| `setUpsMultipliers(uint256[])` | `_multipliers` | Each: 1x-10x (1e18 scale), non-empty | Updates random UPS multiplier options |
| `setRandomnessEnabled(bool)` | `_enabled` | true/false | Enables/disables entropy-based multipliers |
| `setUpsMultiplierDuration(uint256)` | `_duration` | 1 hour - 7 days | Time multiplier lasts before reset |
| `setUri(string)` | `_uri` | Any string | Updates rig metadata URI |

### Fee Distribution
- **80%** to Previous Miner
- **15%** to Treasury
- **4%** to Team (or Treasury if team == address(0))
- **1%** to Protocol

### Emission Mechanics
- Multiple independent slots (capacity-based)
- Bitcoin-like halving based on total supply minted
- UPS divided by capacity for per-slot rate
- Optional VRF-based UPS multipliers (1x-10x)

---

## Auction Contract (Shared by All Rigs)

Each rig has an associated Auction contract for treasury sales.

### Parameters Set at Launch (via Core)

| Parameter | Type | Constraints | Description |
|-----------|------|-------------|-------------|
| `auctionInitPrice` | uint256 | > 0 | Initial price for auction |
| `auctionEpochPeriod` | uint256 | 1 hour - 365 days | Auction epoch period |
| `auctionPriceMultiplier` | uint256 | 1.1x - 3x (1e18 scale) | Price multiplier after each buy |
| `auctionMinInitPrice` | uint256 | > 0 | Minimum auction starting price |

---

## Common Launch Parameters (via Core)

These are passed during `Core.launch()` for all rig types:

| Parameter | Type | Description |
|-----------|------|-------------|
| `launcher` | address | Receives rig ownership |
| `quoteToken` | address | Payment token for the rig |
| `tokenName` | string | Unit token name |
| `tokenSymbol` | string | Unit token symbol |
| `donutAmount` | uint256 | DONUT provided for Unit/DONUT LP |
| `unitAmount` | uint256 | Initial Unit tokens for LP |

---

## Important Notes

1. **Ownership**: All rigs transfer ownership to the `launcher` address at deployment. Only the owner can call setter functions.

2. **LP Locking**: Initial liquidity (Unit/DONUT) is permanently locked - LP tokens are burned to dead address.

3. **Protocol Fee**: Hardcoded 1% fee to protocol address across all rig types.

4. **Quote Token**: Payment token is set at launch and cannot be changed.

5. **URI Metadata**: All rigs support metadata URIs for branding/display (logos, descriptions, links).
