# Farplace

## Project Overview

Farplace is a token launchpad on Base that distributes tokens through gamified mechanisms instead of traditional token sales. Anyone can launch a token by pairing it with DONUT, and initial liquidity is permanently locked (LP tokens burned to dead address). The platform runs as a Farcaster mini-app.

Each token launch creates a **Rig** (the distribution mechanism), a **Unit** (the ERC20 token), and an **Auction** (for treasury sales). There are three rig types, each with a different distribution model.

## Rig Types

### MineRig (Slot Mining)

Users compete for "mining slots" via Dutch auction pricing. While you hold a slot, you earn Unit token emissions proportional to time held. When someone takes your slot, they pay the current auction price -- 80% of which goes to you as the displaced miner. The slot price resets to `lastPrice * priceMultiplier` and decays linearly back to zero over the epoch period. If no one takes the slot before the epoch ends, the next person can take it for free.

Each rig starts with 1 slot but the owner can increase capacity up to 256. UPS (units per second) is divided evenly across all slots. Emissions follow a Bitcoin-like halving schedule based on total tokens minted: once `halvingAmount` tokens are minted, UPS halves, then halves again at `halvingAmount * 1.5`, then at `halvingAmount * 1.75`, etc. (geometric series approaching `2 * halvingAmount`). UPS never drops below `tailUps`.

Optionally, Pyth Entropy VRF can assign a random UPS multiplier (1x-10x) to a slot each time it changes hands. The multiplier lasts for `upsMultiplierDuration` then resets to 1x until the next mine action triggers a new draw.

**Fee split (on slot purchase price):** 80% to previous miner, 15% to treasury, 4% to team, 1% to protocol. Miner fees use a pull-based claim pattern to prevent griefing.

**Launch parameters (immutable):**
- `quoteToken` -- ERC20 used for slot payments (e.g. USDC)
- `tokenName`, `tokenSymbol` -- Unit token identity
- `donutAmount` -- DONUT provided for initial LP
- `unitAmount` -- Unit tokens minted for initial LP
- `initialUps` -- starting units per second (max 1e24)
- `tailUps` -- minimum UPS floor after halvings
- `halvingAmount` -- total minted threshold for first halving (min 1000e18)
- `epochPeriod` -- Dutch auction duration per slot (10 min - 365 days)
- `priceMultiplier` -- price reset multiplier on purchase (1.1x - 3x, 18 decimals)
- `minInitPrice` -- minimum starting price per epoch (min 1e6)
- `upsMultipliers[]` -- array of possible multiplier values (1x-10x, drawn randomly)
- `upsMultiplierDuration` -- how long a multiplier lasts (1 hour - 7 days)
- `auctionInitPrice`, `auctionEpochPeriod`, `auctionPriceMultiplier`, `auctionMinInitPrice` -- treasury Auction config

**Owner-settable (live):**
- `treasury` -- treasury fee recipient (cannot be zero)
- `team` -- team fee recipient (zero disables team fees, redirects to treasury)
- `capacity` -- number of mining slots (can only increase, max 256)
- `multipliersEnabled` -- toggle Pyth Entropy random multipliers on/off
- `uri` -- rig metadata URI

### SpinRig (Slot Machine)

Users pay a Dutch auction price to spin for a chance to win Unit tokens from a prize pool. The spin price follows the same decay pattern as MineRig -- starts at `initPrice`, decays linearly to zero over `epochPeriod`, resets to `lastPrice * priceMultiplier` on each spin.

On every spin, accumulated emissions since the last spin are minted into the prize pool (held by the contract). Then Pyth Entropy VRF draws a random entry from the `odds[]` array (in basis points), and the spinner receives that percentage of the current pool balance. For example, if `odds = [100, 500, 1000, 5000]` then possible payouts are 1%, 5%, 10%, or 50% of the pool, each with equal probability.

Emissions are time-based rather than supply-based: UPS halves every `halvingPeriod` of wall-clock time since deployment, floored at `tailUps`. The prize pool grows continuously whether or not anyone is spinning.

100% of the spin price goes to fees (nothing goes to another user like in MineRig). The spinner's "return" is the VRF payout from the prize pool.

**Fee split (on spin price):** 95% to treasury, 4% to team, 1% to protocol.

**Launch parameters (immutable):**
- `quoteToken` -- ERC20 used for spin payments
- `tokenName`, `tokenSymbol` -- Unit token identity
- `donutAmount` -- DONUT provided for initial LP
- `unitAmount` -- Unit tokens minted for initial LP
- `initialUps` -- starting units per second
- `tailUps` -- minimum UPS floor after halvings
- `halvingPeriod` -- wall-clock time between halvings (7 - 365 days)
- `epochPeriod` -- Dutch auction duration per spin (10 min - 365 days)
- `priceMultiplier` -- price reset multiplier on spin (1.1x - 3x)
- `minInitPrice` -- minimum starting price per epoch
- `odds[]` -- array of payout percentages in basis points (0.1% - 80% each, drawn uniformly at random)
- `auctionInitPrice`, `auctionEpochPeriod`, `auctionPriceMultiplier`, `auctionMinInitPrice` -- treasury Auction config

**Owner-settable (live):**
- `treasury` -- treasury fee recipient (cannot be zero)
- `team` -- team fee recipient (zero disables team fees)
- `uri` -- rig metadata URI

### FundRig (Donations)

Users donate a payment token into a daily pool. After the day ends, each donor can claim their proportional share of that day's Unit emission. For example, if the day's emission is 1000 tokens and you contributed 10% of donations, you can claim 100 tokens.

Donations are immediately split on deposit: 50% to the recipient, 45% to treasury, 4% to team, 1% to protocol. The daily pool only tracks amounts for proportional emission calculation -- funds are distributed instantly.

Emissions halve every `halvingPeriod` days (wall-clock, counting from deployment). So if `halvingPeriod = 30` and `initialEmission = 1000e18`, days 0-29 emit 1000, days 30-59 emit 500, days 60-89 emit 250, etc., floored at `minEmission`.

Claims are per-day: you must call `claim(account, day)` for each day individually, and only after that day has ended. Anyone can trigger a claim on behalf of any account.

**Fee split (on each donation):** 50% to recipient, 45% to treasury, 4% to team, 1% to protocol.

**Launch parameters (immutable):**
- `quoteToken` -- ERC20 accepted for donations
- `recipient` -- address receiving 50% of all donations (required, non-zero)
- `tokenName`, `tokenSymbol` -- Unit token identity
- `donutAmount` -- DONUT provided for initial LP
- `unitAmount` -- Unit tokens minted for initial LP
- `initialEmission` -- Unit tokens emitted per day (1e18 - 1e30)
- `minEmission` -- minimum daily emission floor
- `halvingPeriod` -- days between halvings (7 - 365)
- `auctionInitPrice`, `auctionEpochPeriod`, `auctionPriceMultiplier`, `auctionMinInitPrice` -- treasury Auction config

**Owner-settable (live):**
- `recipient` -- donation recipient address (cannot be zero)
- `treasury` -- treasury fee recipient (cannot be zero)
- `team` -- team fee recipient (zero disables team fees)
- `uri` -- rig metadata URI

## Tech Stack

- **Monorepo**: Yarn workspaces
- **Frontend** (`packages/app`): Next.js 16, React 19, TypeScript, TailwindCSS, Radix UI, wagmi/viem
- **Smart Contracts** (`packages/hardhat`): Solidity 0.8.19, Hardhat, OpenZeppelin, Solmate, Pyth Entropy
- **Indexing** (`packages/subgraph`): The Graph (AssemblyScript)
- **Target Chain**: Base (chain ID 8453)
- **Integration**: Farcaster mini-app (via @farcaster/miniapp-sdk)

## Coding Conventions

- TypeScript for frontend, Solidity for contracts
- Use yarn for package management
- Frontend uses shadcn/ui components with Radix primitives
- Contract tests use Hardhat with Chai matchers

## Project Structure

```
packages/
├── app/              # Next.js frontend (Farcaster mini-app)
│   ├── app/          # App router pages
│   ├── components/   # React components
│   ├── hooks/        # Custom React hooks
│   └── lib/          # Utilities, constants, contract ABIs
├── hardhat/          # Solidity smart contracts
│   ├── contracts/
│   │   ├── Registry.sol          # Central registry for all rig types
│   │   ├── Unit.sol              # ERC20 token created per launch
│   │   ├── UnitFactory.sol       # Deploys Unit tokens
│   │   ├── Auction.sol           # Dutch auction for treasury sales
│   │   ├── AuctionFactory.sol    # Deploys Auctions
│   │   └── rigs/
│   │       ├── mine/             # MineCore, MineRig, MineRigFactory, MineMulticall
│   │       ├── spin/             # SpinCore, SpinRig, SpinRigFactory, SpinMulticall
│   │       └── fund/             # FundCore, FundRig, FundRigFactory, FundMulticall
│   ├── scripts/      # Deployment and verification scripts
│   └── tests/        # Contract test suites
└── subgraph/         # The Graph indexer
    ├── src/
    │   ├── cores/    # MineCore, SpinCore, FundCore launch handlers
    │   ├── rigs/     # MineRig, SpinRig, FundRig event handlers
    │   ├── pair.ts   # Uniswap V2 pair price/volume tracking
    │   └── unit.ts   # ERC20 transfer tracking
    ├── abis/         # Contract ABIs
    └── schema.graphql
```

## Key Contracts

- **Registry.sol**: Central registry for all rigs across all types. Only approved factories (Core contracts) can register rigs.
- **MineCore.sol / SpinCore.sol / FundCore.sol**: Entry points for launching each rig type. Handle token creation, LP setup, and rig deployment. Each Core is approved as a factory in the Registry.
- **MineRig.sol / SpinRig.sol / FundRig.sol**: The distribution mechanisms. Each handles its own pricing, emissions, and fee splits.
- **Unit.sol**: ERC20 token created for each launch. Mintable only by its parent rig.
- **Auction.sol**: Dutch auction for treasury token sales (separate from the rig mechanism).
- **Multicall contracts**: Read helpers (MineMulticall, SpinMulticall, FundMulticall) for batched frontend queries.
- **Factories**: UnitFactory, AuctionFactory, MineRigFactory, SpinRigFactory, FundRigFactory deploy child contracts.

## Development Commands

```bash
# Frontend
cd packages/app && npm run dev

# Contracts
cd packages/hardhat && npx hardhat test
cd packages/hardhat && npm run deploy

# Subgraph
cd packages/subgraph && yarn codegen && yarn build
cd packages/subgraph && yarn deploy
```

## Development Notes

- Payments are in USDC (configurable quote token per rig), tokens are paired with DONUT for LP
- Initial LP tokens are burned (sent to dead address) - liquidity cannot be pulled
- Launchers must hold a minimum amount of DONUT to create a rig
- All rig types use Dutch auction-style pricing that decays over each epoch
- Emission rates halve on a schedule until hitting a configurable floor
- Fee splits go to: treasury, team (optional), and protocol
- Pyth Entropy provides on-chain randomness for MineRig multipliers and SpinRig outcomes
