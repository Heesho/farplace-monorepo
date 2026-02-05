# Threat Model

## System Assets
- User quote/payment tokens paid into rigs (`quote`, `paymentToken`) and routed to treasury/team/protocol.
- Unit token supply and distribution fairness across MineRig, SpinRig, and FundRig.
- SpinRig prize pool (`Unit` balance held by `SpinRig`).
- MineRig claimable balances (`accountToClaimable`) and slot state.
- LP tokens minted at launch and burned to `0x...dEaD`.
- Registry integrity (`approvedFactories`, `isRegistered`).

## Actors
- External attacker (no privileged roles).
- Rig owner (launcher; potentially malicious/compromised).
- Core owner (protocol admin; potentially malicious/compromised).
- Entropy provider/callback source (treated as potentially delayed, reordered, or adversarial under compromised assumptions).
- Quote/payment token contracts (treated as potentially non-standard or hostile).
- Treasury/team/protocol fee recipient addresses (can be EOAs or contracts).

## Trust Assumptions
- Uniswap router/factory addresses passed to Core constructors are correct and non-malicious.
- Entropy callback liveness/order is not guaranteed unless explicitly enforced in protocol logic.
- ERC20 quote tokens are expected to be standard, but the protocol does not enforce this onchain.
- No upgradeability is present; deployed logic is immutable.
- Owners may be malicious (explicitly modeled).

## Attacker Goals
- Steal or redirect value from prize pools, claimable balances, or fee flows.
- Inflate Unit issuance beyond expected tokenomics.
- Freeze or grief rig interactions (DoS).
- Manipulate spin/mine economic outcomes through callback/order/price dynamics.
- Exploit token non-standard behavior for accounting breaks.

## Attack Surfaces
- Public/external state-changing entry points:
  - `Auction.buy`
  - `FundCore.launch`, `FundRig.fund`, `FundRig.claim`, `FundMulticall.*`
  - `MineCore.launch`, `MineRig.mine`, `MineRig.claim`, `MineMulticall.*`
  - `SpinCore.launch`, `SpinRig.spin`, `SpinMulticall.*`
  - `Registry.register` (gated by approved factories)
  - `Unit.setRig`, `Unit.mint`, `Unit.burn`
- Entropy callbacks (`IEntropyConsumer._entropyCallback` -> internal `entropyCallback`).
- External token transfers (`transferFrom`, `transfer`) and fee recipient interactions.
- Admin controls (`setProtocolFeeAddress`, `setMinUsdcForLaunch`, rig owner setters).

## Explicit Invariants

### Global
- `Unit` minting is restricted to the current `rig`; after `setRig` once, `rigLocked == true` and rig is immutable.
- Registry writes only from approved factories/cores.
- Auction epoch is monotonic (`epochId` increments per successful buy).

### Fund Module
- `dayToTotalDonated[day]` equals the sum of all `dayAccountToDonation[day][account]`.
- One claim per user per day (`dayAccountToHasClaimed` monotonic true once set).
- For each completed day, total rewards minted should not exceed configured day emission.
- Donation split accounting should sum to the donation amount.

### Mine Module
- `totalMinted` is monotonic non-decreasing.
- For each mine, fee split equals paid price (miner + treasury + team + protocol).
- Per-slot `epochId` is monotonic.
- `getPrice(index)` remains in `[0, initPrice]`.
- Intended invariant: slot emission rates should remain aligned with `capacity` changes.

### Spin Module
- `SpinRig` prize pool equals `Unit.balanceOf(SpinRig)`.
- Per spin: fee split equals paid price (treasury + team + protocol).
- Payout odds remain within bounds `[MIN_ODDS_BPS, MAX_ODDS_BPS]`.
- Callback settlement should remain economically tied to the originating spin context.

### Core Launch Flows
- Launch transaction atomically creates Unit/Rig/Auction or reverts fully.
- LP tokens from launch are transferred to dead address.
- Rig ownership transfers to launcher post-launch.
