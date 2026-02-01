# Farplace

A permissionless token launchpad on Base that distributes tokens through gamified mining mechanisms. Instead of traditional token sales or airdrops, users compete for tokens through Dutch auction-style mechanics where engagement determines distribution.

## Overview

Farplace reimagines token distribution by turning it into a competitive game. When someone launches a token on Farplace:

1. A new **Unit** token is created with minting controlled by a "Rig" contract
2. Initial liquidity is created by pairing the Unit with USDC on Uniswap V2
3. **The LP tokens are permanently burned** - liquidity can never be pulled
4. Users compete through the Rig's mechanism to earn token emissions over time

This creates a fair launch environment where tokens are distributed based on participation rather than pre-sales or insider allocations.

## How It Works

### The Basic Flow

```
Creator provides USDC → Unit token created → LP created & burned → Rig deployed → Users compete to mine
```

1. **Launch**: A creator provides USDC to launch. The system mints initial Unit tokens, creates a Unit/USDC liquidity pool, and burns the LP tokens forever.

2. **Mining**: Users interact with the Rig contract to earn Unit tokens. Each rig type has a different mechanic (slot mining, spinning, donations).

3. **Emissions**: Unit tokens are minted over time according to a halving schedule, similar to Bitcoin's emission model.

4. **Fees**: When users pay to mine, fees are distributed to the previous participants, treasury, team, and protocol.

## Rig Types

Farplace supports multiple "Rig" types, each with a unique distribution mechanism:

### Mine Rig

**Mechanic**: Competitive slot ownership with continuous emissions

Users compete to control "mining slots" in a Dutch auction. The slot holder passively earns token emissions over time. When someone takes the slot:

- The new holder pays the auction price
- **80%** goes to the previous slot holder
- **15%** goes to treasury (Auction contract for LP buybacks)
- **4%** goes to the team
- **1%** goes to the protocol

The previous holder receives their accumulated emissions based on time held.

**Key Features**:
- Multiple slots available (configurable capacity)
- Optional VRF-based multipliers (1x-10x) using Pyth Entropy
- Price decays linearly each epoch, then resets with a multiplier

```
Price starts at initPrice → decays to 0 over epochPeriod → resets to (lastPrice × multiplier)
```

### Spin Rig

**Mechanic**: Slot machine-style gambling for prize pool winnings

Users pay a Dutch auction price to "spin" for a chance to win tokens from a continuously growing prize pool:

- Emissions accumulate in the prize pool over time
- VRF randomness (Pyth Entropy) determines payout percentage (1%-100% of pool)
- Configurable odds array allows custom payout distributions

**Fee Split**:
- **95%** to Treasury
- **4%** to Team
- **1%** to Protocol

### Fund Rig

**Mechanic**: Donation-based daily pools with proportional distribution

Users donate payment tokens to daily pools. At the end of each day, donors claim their proportional share of that day's Unit emission:

```
Your reward = (your donation / total daily donations) × daily emission
```

**Fee Split on Donations**:
- **50%** to recipient
- **45%** to Treasury (remainder)
- **4%** to Team
- **1%** to Protocol

**Emission Schedule**: Halves every `halvingPeriod` days down to a configurable floor.

## Core Concepts

### Dutch Auctions

All rigs use Dutch auction mechanics for price discovery:

```
currentPrice = initPrice - (initPrice × timePassed / epochPeriod)
```

- Price starts at `initPrice` and decays linearly to 0 over `epochPeriod`
- When someone buys, price resets: `newInitPrice = pricePaid × priceMultiplier`
- Prices are bounded by `minInitPrice` and `maxInitPrice`

This creates natural price discovery - if no one buys, price drops. High demand causes prices to rise.

### Token Emissions

Unit tokens are minted by Rig contracts over time. The emission rate (Units Per Second - UPS) determines how many tokens are created:

```
tokensEarned = timeHeld × ups × multiplier
```

### Halving Schedule

Similar to Bitcoin, emission rates decrease over time:

**Mine Rig** (supply-based halvings):
```
Threshold[n] = halvingAmount × (2 - 1/2^n)

Example with halvingAmount = 1000:
  totalMinted < 1000:  full emissions
  totalMinted < 1500:  50% emissions (1 halving)
  totalMinted < 1750:  25% emissions (2 halvings)
  ...continues until tailUps floor
```

**Spin/Fund Rigs** (time-based halvings):
```
halvings = (currentTime - startTime) / halvingPeriod
currentUps = initialUps >> halvings  // divide by 2^halvings
if (currentUps < tailUps) currentUps = tailUps
```

### Permanent Liquidity

When a token is launched:
1. Creator's USDC + minted Units create initial LP on Uniswap V2
2. LP tokens are sent to the dead address (`0x...dEaD`)
3. **Liquidity can never be removed**

This provides permanent trading liquidity and prevents rug pulls.

## Architecture

```
                                    ┌─────────────────┐
                                    │    Registry     │
                                    │ (all rig types) │
                                    └────────┬────────┘
                                             │
        ┌────────────────┬───────────────────┼───────────────────┐
        │                │                   │                   │
   ┌────▼────┐     ┌─────▼─────┐      ┌──────▼──────┐      ┌─────▼─────┐
   │MineCore │     │ SpinCore  │      │  FundCore   │      │  Future   │
   └────┬────┘     └─────┬─────┘      └──────┬──────┘      │  Cores    │
        │                │                   │             └───────────┘
   ┌────▼────┐     ┌─────▼─────┐      ┌──────▼──────┐
   │ MineRig │     │  SpinRig  │      │  FundRig    │
   └────┬────┘     └─────┬─────┘      └──────┬──────┘
        │                │                   │
        └────────────────┴───────────────────┘
                                    │
                               ┌────▼────┐
                               │  Unit   │
                               │ (ERC20) │
                               └─────────┘
```

### Key Contracts

| Contract | Description |
|----------|-------------|
| `Registry` | Central registry for all rig types, enables discovery |
| `Unit` | ERC20 token with mint rights controlled by its Rig |
| `Auction` | Dutch auction for treasury fee collection, burns LP tokens |
| `MineRig` | Slot-based mining with Dutch auctions and VRF multipliers |
| `SpinRig` | Slot machine spinning with VRF-determined payouts |
| `FundRig` | Daily donation pools with proportional distribution |
| `*Core` | Factory/launchpad for each rig type |
| `*Factory` | Creates individual rig/unit/auction contracts |

## Fee Distribution

### Summary by Rig Type

| Recipient | Mine | Spin | Fund |
|-----------|------|------|------|
| Previous Holder | 80% | - | - |
| Treasury (remainder) | 15% | 95% | 45% |
| Team | 4% | 4% | 4% |
| Protocol | 1% | 1% | 1% |
| Fund Recipient | - | - | 50% |

All rig types share consistent **4% team** and **1% protocol** fees. Treasury always receives the remainder after other fees.

### Treasury Auctions

Treasury fees accumulate in an Auction contract. Users can buy all accumulated fees by paying LP tokens, which are then burned. This creates a deflationary mechanism for the LP supply.

## Technical Details

### Randomness

Mine and Spin rigs use [Pyth Entropy](https://docs.pyth.network/entropy) for verifiable randomness:

- **Mine Rig**: Random UPS multiplier (1x-10x) after mining
- **Spin Rig**: Random payout percentage from configurable odds array

### Token Properties

**Unit Token**:
- ERC20 with ERC20Permit (gasless approvals)
- ERC20Votes (governance compatible)
- Mint rights exclusively controlled by Rig contract
- Anyone can burn their own tokens

### Security Features

- Reentrancy guards on all state-changing functions
- Pull pattern for miner fee claims (prevents blacklist griefing)
- Frontrun protection via epoch IDs and deadlines
- Slippage protection via max price parameters
- Input validation with bounds checking

### Parameter Bounds

| Parameter | Min | Max |
|-----------|-----|-----|
| Epoch Period | 10 minutes | 365 days |
| Price Multiplier | 1.1x | 3x |
| Init Price | 1e6 | type(uint192).max |
| UPS Multiplier | 1x | 10x |
| Capacity (slots) | 1 | 1,000,000 |

## Development

### Tech Stack

- **Monorepo**: Yarn workspaces
- **Frontend**: Next.js, React, TypeScript, TailwindCSS, wagmi/viem
- **Contracts**: Solidity 0.8.19, Hardhat, OpenZeppelin, Solmate
- **Indexing**: The Graph (AssemblyScript)
- **Chain**: Base
- **Randomness**: Pyth Entropy

### Project Structure

```
packages/
├── app/              # Next.js frontend (Farcaster mini-app)
│   ├── app/          # App router pages
│   ├── components/   # React components
│   ├── hooks/        # Custom React hooks
│   └── lib/          # Utilities, constants, ABIs
├── hardhat/          # Solidity smart contracts
│   ├── contracts/    # Core contracts
│   │   ├── rigs/     # Rig implementations by type
│   │   ├── interfaces/
│   │   └── mocks/
│   ├── scripts/      # Deployment scripts
│   └── tests/        # Contract test suites
└── subgraph/         # The Graph indexer
    ├── src/          # Mapping handlers
    └── schema.graphql
```

### Commands

```bash
# Install dependencies
yarn install

# Frontend development
cd packages/app && npm run dev

# Contract compilation
cd packages/hardhat && npx hardhat compile

# Run tests
cd packages/hardhat && npx hardhat test

# Deploy contracts
cd packages/hardhat && npm run deploy

# Subgraph
cd packages/subgraph && yarn codegen && yarn build
```

### Testing

The test suite includes:
- Unit tests for all contract functions
- Invariant tests for economic properties
- Business logic tests for fee distributions
- Edge case coverage for bounds and errors

```bash
cd packages/hardhat
npx hardhat test                           # Run all tests
npx hardhat test tests/mine/*              # Run mine rig tests
npx hardhat test tests/spin/*              # Run spin rig tests
npx hardhat test tests/fund/*             # Run fund rig tests
```

---

## License

MIT
