# System Architecture

## Overview

Farplace is composed of layered smart contracts that separate concerns between discovery (Registry), orchestration (Cores), deployment (Factories), token distribution (Rigs), token representation (Units), and treasury management (Auctions). All contracts are non-upgradeable and deployed on Base.

## Contract Relationship Diagram

```
                     +-------------------+
                     |     Registry      |
                     |  (all rig types)  |
                     +-------------------+
                       ^       ^       ^
          register()   |       |       |   register()
      +----------------+       |       +----------------+
      |                        |                        |
+-----+--------+       +------+-------+       +--------+-----+
|   MineCore   |       |   SpinCore   |       |   FundCore   |
+-----+--------+       +------+-------+       +--------+-----+
      |                        |                        |
      |   uses                 |   uses                 |   uses
      |                        |                        |
      v                        v                        v
+------------+           +------------+           +------------+
|  MineRig   |           |  SpinRig   |           |  FundRig   |
|  Factory   |           |  Factory   |           |  Factory   |
+------------+           +------------+           +------------+

Shared Factories (one instance each, used by all Cores):

+------------------+         +------------------+
|   UnitFactory    |         | AuctionFactory   |
| (deploys Unit    |         | (deploys Auction |
|  ERC20 tokens)   |         |  contracts)      |
+------------------+         +------------------+
```

Each Core contract holds references to UnitFactory and AuctionFactory. When a launch
is triggered, the Core calls both shared factories plus its own rig-specific factory
to deploy the full set of per-launch contracts.

Each launch creates an isolated set of contracts:

```
Per-Launch Contract Set:
+-------------------------------------------------------------------+
|                                                                   |
|  Unit (ERC20)  <--- mint only by --->  Rig (Mine/Spin/Fund)      |
|       |                                     |                     |
|       +--- paired with USDC --->  LP Token  |  fees flow to:     |
|                                      |      |   - Auction (treasury) |
|                                      |      |   - Team (launcher)    |
|                                  burned to  |   - Protocol           |
|                                  dead addr  |                     |
|                                             |                     |
|  Auction  <--- treasury fees from ----------+                     |
|    |                                                              |
|    +--- sells accumulated tokens for LP tokens                   |
|    +--- LP payment burned to dead address                        |
|                                                                   |
+-------------------------------------------------------------------+
```

## Contract Hierarchy

### Registry

The Registry is the single source of truth for discovering all rigs deployed across the platform. It is intentionally minimal.

- Maintains a mapping of approved factories (Core contracts) that are authorized to register new rigs.
- Stores a mapping of registered rig addresses.
- Emits `Registry__RigRegistered` events with the rig address, unit token, launcher, and factory. The subgraph indexes these events to build the global rig directory.
- Only the Registry owner can approve or revoke factories. The Registry does not validate what constitutes a "rig" -- that responsibility belongs to the factory.
- Adding a new rig type to Farplace requires only deploying a new Core contract and approving it as a factory in the Registry.

**Key functions:**

| Function | Access | Description |
|---|---|---|
| `register(rig, unit, launcher)` | Approved factories only | Register a new rig |
| `setFactoryApproval(factory, approved)` | Owner only | Approve or revoke a factory |
| `rigToIsRegistered(rig)` | Public (view) | Check if an address is a registered rig |
| `factoryToIsApproved(factory)` | Public (view) | Check if an address is an approved factory |

### Core Contracts (MineCore, SpinCore, FundCore)

The Core contracts are the entry points for launching new rigs. Each rig type has its own Core contract that orchestrates the full launch sequence. Cores are approved as factories in the Registry, granting them permission to register the rigs they deploy.

Responsibilities:

- Validate launch parameters (fail fast before any state changes).
- Transfer USDC from the launcher.
- Deploy a Unit token via UnitFactory.
- Create and seed the Uniswap V2 liquidity pool.
- Burn the LP tokens to the dead address.
- Deploy an Auction contract via AuctionFactory.
- Deploy the Rig contract via the appropriate RigFactory.
- Transfer Unit minting rights to the Rig (permanent, one-time lock).
- Set initial metadata URI on the rig.
- Transfer rig ownership to the launcher.
- Register the rig in both the local Core registry and the central Registry.

Each Core also maintains its own local registry of deployed rigs with mappings to their associated Auction contracts and LP token addresses. The Core owner can update the protocol fee address and the minimum USDC required to launch.

### Factories (UnitFactory, AuctionFactory, MineRigFactory, SpinRigFactory, FundRigFactory)

Factories are thin deployment contracts. Their sole purpose is to deploy new instances of their respective contracts. They encapsulate constructor arguments and deployment logic so that the Core contracts do not need to contain the bytecode of every contract they deploy.

There are two categories of factories:

**Shared factories** -- A single instance of each, used by all three Core contracts:

| Factory | Deploys | Called By |
|---|---|---|
| UnitFactory | Unit (ERC20 token) | MineCore, SpinCore, FundCore |
| AuctionFactory | Auction (Dutch auction) | MineCore, SpinCore, FundCore |

**Rig-specific factories** -- One per rig type, used only by its corresponding Core:

| Factory | Deploys | Called By |
|---|---|---|
| MineRigFactory | MineRig | MineCore |
| SpinRigFactory | SpinRig | SpinCore |
| FundRigFactory | FundRig | FundCore |

### Rigs (MineRig, SpinRig, FundRig)

The Rig contracts are the distribution mechanisms. Each rig type implements different game mechanics but shares common traits:

- **Dutch auction pricing.** All rig interactions (mining, spinning, donating) use a price that starts high and decays linearly to zero over an epoch period. Activity resets the price upward via a configurable multiplier.
- **Halving emission schedule.** Token emissions decrease over time according to a halving schedule (supply-based for MineRig, time-based for SpinRig and FundRig) with a configurable minimum floor.
- **Fee splits.** Each interaction generates fees that are split between treasury (Auction contract), team (launcher), and protocol.
- **Sole minting authority.** Each rig is the only address that can mint its Unit token. This is enforced by the `setRig()` one-time lock on the Unit contract.

Rigs are owned by the launcher after deployment. The owner can adjust operational parameters (treasury address, team address, metadata URI, and type-specific settings like slot capacity), but core game mechanics (emission rates, halving schedule, epoch period, price multiplier) are immutable.

### Unit

The Unit contract is an ERC20 token with ERC20Permit (gasless approvals) and ERC20Votes (on-chain governance) capabilities. Each launch creates a new Unit token.

Key design decisions:

- **One-time minting authority transfer.** The Unit is initially deployed with MineCore (or SpinCore/FundCore) as the minter. The Core mints the initial supply for LP seeding, then calls `setRig()` to permanently transfer minting authority to the Rig. The `rigLocked` flag ensures this can only happen once.
- **No admin mint.** Once `setRig()` is called, only the Rig contract can mint tokens. The Rig contracts have no function to transfer minting rights further, so the authority is effectively immutable.
- **Burn capability.** Any token holder can burn their own tokens. There is no admin burn.

### Auction

The Auction contract implements a Dutch auction for selling accumulated treasury assets. Rig fees designated for the treasury are sent to the Auction contract, which accumulates them until a buyer purchases the entire batch.

How it works:

1. Fee tokens (USDC or the rig's quote token) accumulate in the Auction contract over time.
2. The Dutch auction price starts at `initPrice` and decays linearly to zero over `epochPeriod`.
3. A buyer calls `buy()`, paying the current price in LP tokens. The buyer receives all accumulated assets. The LP tokens are sent to the dead address (burned).
4. A new epoch begins with a starting price of `lastPaidPrice * priceMultiplier`, clamped between `minInitPrice` and the absolute maximum.

This mechanism creates continuous buy pressure on the token (LP tokens are burned, reducing circulating supply) while allowing market-driven price discovery for treasury assets.

## Launch Flow

When a user calls `Core.launch()`, the following steps execute atomically in a single transaction:

### Step 1: Validate Parameters

The Core contract validates all launcher-provided parameters: non-zero addresses, non-empty strings, minimum USDC requirement, and valid ranges for all numeric values. Rig-specific and Auction-specific parameter validation is additionally enforced by the respective constructors. If any check fails, the entire transaction reverts before any state changes.

### Step 2: Transfer USDC from Launcher

```solidity
IERC20(usdcToken).safeTransferFrom(msg.sender, address(this), params.usdcAmount);
```

The launcher must have approved the Core contract to spend their USDC beforehand.

### Step 3: Deploy Unit Token

```solidity
unit = IUnitFactory(unitFactory).deploy(params.tokenName, params.tokenSymbol);
```

The UnitFactory deploys a new Unit ERC20 contract. The Core contract is set as the initial `rig` (minter) of the Unit.

### Step 4: Mint Unit Tokens for LP

```solidity
IUnit(unit).mint(address(this), params.unitAmount);
```

The Core, acting as the initial minter, mints `unitAmount` Unit tokens to itself for liquidity pool seeding. This is the only time tokens are minted outside of the Rig's emission schedule.

### Step 5: Create Uniswap V2 LP

```solidity
IUniswapV2Router(uniswapV2Router).addLiquidity(
    unit, usdcToken,
    params.unitAmount, params.usdcAmount,
    params.unitAmount, params.usdcAmount,
    address(this),
    block.timestamp + 20 minutes
);
```

The Core approves the Uniswap V2 Router to spend both tokens, then adds liquidity. The minimum amounts equal the desired amounts (no slippage tolerance) since this is the first liquidity provision for a brand-new pair.

### Step 6: Burn LP Tokens

```solidity
lpToken = IUniswapV2Factory(uniswapV2Factory).getPair(unit, usdcToken);
IERC20(lpToken).safeTransfer(DEAD_ADDRESS, liquidity);
```

All LP tokens received from the liquidity provision are sent to `0x000000000000000000000000000000000000dEaD`. This permanently locks the liquidity in the pool. No one -- not the launcher, not the protocol, not the Core contract -- can ever withdraw it.

### Step 7: Deploy Auction

```solidity
auction = IAuctionFactory(auctionFactory).deploy(
    lpToken,           // payment token (LP)
    DEAD_ADDRESS,      // payment receiver (burn)
    params.auctionInitPrice,
    params.auctionEpochPeriod,
    params.auctionPriceMultiplier,
    params.auctionMinInitPrice
);
```

The Auction contract is configured to accept LP tokens as payment and send them to the dead address (burned). Treasury fees from the Rig accumulate in the Auction for periodic sale.

### Step 8: Deploy Rig

The Rig is deployed via its type-specific factory. The constructor receives the core game parameters, with:
- `treasury` set to the Auction contract address (treasury fees flow there)
- `team` set to the launcher's address (team fees flow to them)
- `core` set to the Core contract address (protocol fee routing)

### Step 9: Transfer Unit Minting Rights

```solidity
IUnit(unit).setRig(rig);
```

This is the critical one-time lock. Minting authority transfers from the Core to the Rig. The `rigLocked` flag is set to `true` on the Unit contract, preventing any further transfers. Since the Rig contracts do not expose a `setRig()` function, this authority is permanently locked to the Rig.

### Step 10: Register Rig in Registry

```solidity
IRegistry(registry).register(rig, unit, params.launcher);
```

The Core (an approved factory in the Registry) registers the new rig. This emits an event that the subgraph indexes for discovery.

### Step 11: Transfer Ownership to Launcher

```solidity
IMineRig(rig).transferOwnership(params.launcher);
```

The Rig's `Ownable` ownership transfers from the Core to the launcher. The launcher can now adjust operational parameters (treasury, team, capacity, metadata URI) but cannot change immutable game mechanics.

## Fee Architecture

All rig types generate fees from user interactions. Fees are denominated in the rig's configured quote token (typically USDC). The split varies by rig type:

### MineRig Fee Split

When a user mines (takes a slot), they pay the current Dutch auction price. That payment is split:

| Recipient | Share | Description |
|---|---|---|
| Previous miner | 80% | Compensation for being displaced (pull-based claim) |
| Treasury (Auction) | 15% | Accumulates for periodic Dutch auction sale |
| Team (launcher) | 4% | Sent directly to the team address |
| Protocol | 1% | Sent directly to the protocol fee address |

The previous miner's fee uses a pull-based claim pattern: fees accumulate in the contract and the miner must call `claimFees()` to withdraw. This prevents griefing attacks where a malicious contract could revert on receive and block the mining action.

If the team address is set to zero, the team's 4% share is redirected to treasury.

### SpinRig Fee Split

When a user spins, they pay the current Dutch auction price. The entire payment goes to fees (the user's return comes from the VRF prize pool payout, not from the fee flow):

| Recipient | Share | Description |
|---|---|---|
| Treasury (Auction) | 95% | Accumulates for periodic Dutch auction sale |
| Team (launcher) | 4% | Sent directly to the team address |
| Protocol | 1% | Sent directly to the protocol fee address |

### FundRig Fee Split

When a user donates, their donation is split immediately on deposit:

| Recipient | Share | Description |
|---|---|---|
| Recipient | 50% | The designated donation recipient |
| Treasury (Auction) | 45% | Accumulates for periodic Dutch auction sale |
| Team (launcher) | 4% | Sent directly to the team address |
| Protocol | 1% | Sent directly to the protocol fee address |

### Treasury Fee Flow

Treasury fees accumulate in the Auction contract. Periodically, a buyer purchases the entire accumulated balance by paying the current Dutch auction price in LP tokens. Those LP tokens are burned (sent to the dead address), reducing the circulating LP token supply and permanently deepening relative liquidity.

```
User interaction --> Fee split --> Treasury share --> Auction contract
                                                         |
Buyer pays LP tokens --> LP burned --> Buyer gets treasury assets
```

## Token Lifecycle

### MineRig

1. **Emission.** The MineRig mints Unit tokens continuously based on its UPS (units per second) rate. UPS is divided evenly across all active slots. Emissions halve at supply-based thresholds following a geometric series.
2. **Earning.** Miners earn tokens proportional to the time they hold a slot. Pending emissions are calculated at each state change and credited to the miner.
3. **Claiming.** Miners call `claim()` to withdraw their accumulated Unit tokens. The rig mints tokens on demand.
4. **Halving.** As total minted supply crosses halving thresholds (`halvingAmount`, then `halvingAmount * 1.5`, then `halvingAmount * 1.75`, ...), the UPS rate halves. UPS never drops below `tailUps`.

### SpinRig

1. **Emission.** The SpinRig mints Unit tokens into a prize pool based on elapsed time since the last spin. UPS halves every `halvingPeriod` of wall-clock time.
2. **Pool growth.** The prize pool grows continuously whether or not anyone is spinning. Unminted emissions are calculated and minted into the pool at each spin.
3. **Payout.** On each spin, Pyth Entropy VRF selects a random entry from the `odds[]` array (in basis points). The spinner receives that percentage of the current pool balance.
4. **Circulation.** Tokens that leave the prize pool enter open circulation. The pool retains the remainder, which compounds with new emissions.

### FundRig

1. **Emission.** The FundRig emits a fixed number of Unit tokens per day. The daily emission halves every `halvingPeriod` days, floored at `minEmission`.
2. **Donation tracking.** Each day accumulates donation totals per user. The donation amounts determine proportional shares but the donated funds are distributed instantly (not held by the rig).
3. **Claiming.** After a day ends, any address can call `claim(account, day)` to mint and transfer that account's proportional share of the day's emission. Claims are per-day and can only be made after the day has concluded.
4. **Distribution.** If a day has 10,000 USDC in total donations and a user contributed 1,000 USDC (10%), that user can claim 10% of that day's Unit emission.
