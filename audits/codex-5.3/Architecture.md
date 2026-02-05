# Architecture

## Plain-English System Diagram
```
Launcher/User
  -> Core (MineCore | SpinCore | FundCore)
      -> UnitFactory -> Unit token
      -> UniswapV2 Router/Factory -> Unit/USDC LP
      -> LP burned to dead address
      -> AuctionFactory -> Auction (treasury asset seller)
      -> RigFactory -> Rig (MineRig | SpinRig | FundRig)
      -> Unit.setRig(rig) [one-time mint authority handoff]
      -> Rig ownership -> launcher
      -> Registry.register(rig)

Runtime:
  Users <-> Rig functions (mine/spin/fund/claim)
  Rig fee flows -> treasury/team/protocol
  Treasury assets accumulate in Auction
  Buyers use LP token in Auction.buy to claim accumulated treasury assets
```

## Module Breakdown

### Core Layer
- `MineCore`, `SpinCore`, `FundCore`
- Responsibilities:
  - Validate launch params.
  - Pull launch USDC.
  - Deploy Unit via `UnitFactory`.
  - Seed Unit/USDC LP through Uniswap router.
  - Burn LP to dead address.
  - Deploy treasury `Auction`.
  - Deploy rig via rig-specific factory.
  - Transfer Unit minting rights to rig.
  - Transfer rig ownership to launcher.
  - Register rig in `Registry`.

### Rig Layer
- `MineRig`: Dutch-auction slot takeovers + time-held minting + optional entropy multiplier.
- `SpinRig`: Dutch-auction spins + entropy-selected payout odds from Unit prize pool.
- `FundRig`: Donation splitting + per-day proportional Unit emission claims.

### Shared Infrastructure
- `Unit`: ERC20 + Permit + Votes; mint authority held by rig.
- `Auction`: Dutch auction that sells accumulated assets for LP token payment.
- `Registry`: approved factory gate + rig registration marker.
- Factories: `UnitFactory`, `AuctionFactory`, `MineRigFactory`, `SpinRigFactory`, `FundRigFactory`.
- Multicalls: convenience wrappers for launch/mine/spin/fund/buy/read aggregation.

## Value Flow

### Launch Flow (All Rig Types)
1. Launcher approves USDC to Core.
2. Core pulls USDC and deploys Unit.
3. Core mints initial Unit and seeds Unit/USDC LP.
4. LP tokens are sent to dead address.
5. Core deploys Auction using LP token as payment token.
6. Core deploys rig and wires treasury to Auction.
7. Core locks Unit mint role to rig and transfers rig ownership to launcher.
8. Core registers rig in Registry.

### Ongoing Runtime Flow
- MineRig:
  - Miner pays quote token to displace slot holder.
  - 80% credited as claimable to previous miner, remainder distributed to treasury/team/protocol.
  - On displacement, elapsed emission mints Unit to previous miner.
- SpinRig:
  - Spinner pays quote token fee split.
  - Emissions minted into prize pool.
  - Entropy callback selects odds and pays spinner from prize pool.
- FundRig:
  - Donor pays quote token split (recipient/treasury/team/protocol).
  - Donation accounting accrues per day.
  - Claim mints Unit proportional to donation share after day end.

## Permission Model

### Protocol Admin (`Ownable` on Core + Registry)
- Core:
  - `setProtocolFeeAddress`
  - `setMinUsdcForLaunch`
- Registry:
  - `setFactoryApproval`

### Rig Owner (`Ownable` on each rig)
- MineRig:
  - `setTreasury`, `setTeam`, `setCapacity`, `setEntropyEnabled`, `setUri`
- SpinRig:
  - `setTreasury`, `setTeam`, `setEntropyEnabled`, `setUri`
- FundRig:
  - `setRecipient`, `setTreasury`, `setTeam`, `setUri`

### Public Users
- Launch via Core/Multicall.
- Interact with rig mechanics (`mine`, `spin`, `fund`, `claim`, `buy`).

## Upgrade Model
- No proxy pattern detected (no UUPS/Transparent/Beacon/Diamond).
- No delegatecall-based upgrade path in production contracts.
- All core business logic is immutable once deployed.

## Trust Boundaries
- Entropy callback path is external and asynchronous.
- Quote/payment token contracts are external dependencies.
- Uniswap router/factory are external dependencies.
- Fee recipient addresses (treasury/team/protocol) can be arbitrary contracts and can affect liveness.

## Risk Hotspots
- SpinRig callback settlement path (`spin` -> `entropyCallback`).
- MineRig capacity changes vs cached per-slot UPS.
- Fee transfer paths tied to mutable recipient addresses.
- Non-standard ERC20 behavior in quote/payment tokens.
- Entropy fee handling for payable entry points.
