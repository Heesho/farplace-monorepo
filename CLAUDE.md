# Mineport

## Project Overview
Mineport (also known as Franchiser) is a token launchpad on Base that distributes tokens through a mining mechanism. Instead of traditional token sales, users compete for a "mining seat" via Dutch auction-style pricing. The seat holder earns token emissions over time, and when someone takes the seat, the previous holder gets paid. All tokens are paired with DONUT and initial liquidity is permanently locked.

## Tech Stack
- **Monorepo**: Yarn workspaces
- **Frontend** (`packages/app`): Next.js 16, React 19, TypeScript, TailwindCSS, Radix UI, wagmi/viem
- **Smart Contracts** (`packages/hardhat`): Solidity, Hardhat, OpenZeppelin, Solmate, Pyth Entropy
- **Indexing** (`packages/subgraph`): The Graph (AssemblyScript)
- **Target Chain**: Base
- **Integration**: Farcaster mini-app (via @farcaster/miniapp-sdk)

## Coding Conventions
- TypeScript for frontend, Solidity for contracts
- Use yarn for package management
- Frontend uses shadcn/ui components with Radix primitives
- Contract tests use Hardhat with Chai matchers

## Project Structure
```
packages/
├── app/           # Next.js frontend (Farcaster mini-app)
│   ├── app/       # App router pages
│   ├── components/# React components
│   ├── hooks/     # Custom React hooks
│   └── lib/       # Utilities, constants, contract ABIs
├── hardhat/       # Solidity smart contracts
│   ├── contracts/ # Core contracts (Rig, Unit, Auction, Core, factories)
│   ├── scripts/   # Deployment scripts
│   └── tests/     # Contract test suites
└── subgraph/      # The Graph indexer
    ├── src/       # Mapping handlers
    └── schema.graphql
```

## Key Contracts
- **Core.sol**: Main entry point and factory registry
- **Rig.sol**: Individual mining rig (seat competition + emissions)
- **Unit.sol**: ERC20 token created for each launch
- **Auction.sol**: Dutch auction for treasury sales
- **RigFactory/UnitFactory/AuctionFactory**: Factory contracts

## Development Commands
```bash
# Frontend
cd packages/app && npm run dev

# Contracts
cd packages/hardhat && npx hardhat test
cd packages/hardhat && npm run deploy

# Subgraph
cd packages/subgraph && yarn codegen && yarn build
```

## Development Notes
- Payments are in WETH, tokens are paired with DONUT
- Initial LP tokens are burned (sent to dead address) - liquidity cannot be pulled
- Mining seat price decays linearly each round (Dutch auction style)
- Emission rate halves on a schedule until hitting a floor rate
