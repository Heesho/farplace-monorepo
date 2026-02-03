# Farplace Smart Contract Audit Report

## Scope & Assumptions

**In-scope contracts:**
- `Unit.sol`, `Registry.sol`, `Auction.sol`, `AuctionFactory.sol`, `UnitFactory.sol`
- All `fund/mine/spin` Core/Rig/Factory/Multicall contracts
- All local interfaces under `packages/hardhat/contracts`

**Excluded:** mocks, artifacts, `node_modules`, third-party libraries (except where used as external dependencies: Uniswap V2, Pyth Entropy).

**No tests executed.**

**Threat model:** A sophisticated attacker with full knowledge of Ethereum execution, MEV access, and flash loan capacity.

### Trust Assumptions

- `Registry` is owner-controlled. Only approved factories can register rigs. Trust assumption: owner curates honest factories.
- Each Core (`FundCore`, `MineCore`, `SpinCore`) is `Ownable`. Owner can set protocol fee address and minimum USDC threshold. Trust assumption: core owner is honest and keys are secure.
- Rig ownership is transferred to the launcher. Trust assumption: launcher can set team/treasury/recipient to honest addresses; a malicious owner can DoS fees by setting reversionary addresses.
- No upgradeable proxies are used. Immutability reduces upgrade risk but removes mitigation options for bugs.
- Pyth Entropy is a critical off-chain dependency for Spin/Mine randomness. Trust assumption: entropy responses are timely and not malicious.

---

## Architecture Overview

- **Core contracts** (`FundCore`, `MineCore`, `SpinCore`) create a Unit token, seed a Uniswap V2 Unit/USDC pool, burn LP, deploy an Auction, deploy the Rig, transfer Unit minting to the Rig, and register in Registry.
- **Rig contracts** implement token distribution mechanics:
  - `FundRig`: donation-based daily emission claims.
  - `MineRig`: Dutch-auction slot mining with emissions minted on slot turnover, optional Entropy-based multipliers.
  - `SpinRig`: Dutch-auction spin price with Entropy-based payout odds from a prize pool.
- **Auction**: Dutch auction that allows anyone to buy all accumulated assets using LP tokens; price decays to 0 by epoch end.
- **Registry**: record of rigs by type, approved factories.

---

## Notable Safe Properties

- All state-changing entrypoints (`launch`, `fund`, `claim`, `mine`, `spin`) are protected by `ReentrancyGuard` in their respective rig/core contracts, preventing same-function reentrancy even with malicious ERC20/777 tokens.
- `Unit` minting is restricted to a single `rig` address and can be transferred exactly once via `setRig`, then locked forever. This is a clean privilege boundary for token supply control (`packages/hardhat/contracts/Unit.sol`).
- Price-changing functions use `epochId` and `deadline` checks (`Auction.buy`, `MineRig.mine`, `SpinRig.spin`) to reduce blind front-running and stale execution.
- SafeERC20 is used for ERC20 interactions across rigs and cores.

---

## Findings by Severity

### Critical

No Critical findings identified in the current code scope.

---

### High

#### H-1: Retroactive UPS Multiplier Over-Mints (Supply Inflation)

- **Status**: NOT APPLICABLE -- Intended behavior by design. Retroactive multiplier application is the intended mechanic.
- **Location**: `packages/hardhat/contracts/rigs/mine/MineRig.sol`
- **Description**: When a slot's UPS multiplier is updated via entropy, the new multiplier is applied retroactively to the entire epoch's elapsed time when the slot is later mined again.

#### H-2: Auction Payment Token Is LP Tokens (Flash-Loan / Price-Manipulation Vector)

- **Status**: FALSE POSITIVE -- Auction price is denominated in a fixed number of LP tokens. Minting LP tokens on Uniswap V2 requires depositing proportional real value on both sides; pool ratio manipulation does not yield cheaper LP tokens. No practical exploit path exists.

#### H-3: MineRig Slots Start at Zero Price (Free Slot Capture)

- **Status**: FALSE POSITIVE -- Intended behavior. First mine of a slot is a free initialization: price is 0 but `ups = 0` and `miner = address(0)` so no tokens are minted. The slot is then properly initialized with `minInitPrice` for subsequent miners. No economic advantage is gained by the first miner.

#### H-4: Uniswap Pool Griefing Can Permanently Block Launches

- **Status**: ACCEPTED RISK -- Unit is deployed via CREATE (not CREATE2), so the address depends on UnitFactory's nonce. An attacker would need to predict the exact Unit address, front-run the launch tx, and pre-create the pair. Narrow attack surface requiring mempool monitoring; accepted as low practical risk.

---

### Medium

#### M-1: SpinRig Payout Depends on Pool at Callback Time (MEV/Griefing Risk)

- **Status**: ACCEPTED RISK -- Pool is read at callback time via `balanceOf`. Multiple pending spins share the pool and callback ordering affects payouts. Accepted as inherent to the design; pool grows via emissions between spins and max payout is bounded by the odds array.

#### M-2: Non-Standard ERC20s Can Break Accounting or Cause DoS

- **Status**: ACKNOWLEDGED -- Protocol is designed around USDC (standard ERC20). Non-standard tokens (fee-on-transfer, rebasing, blacklisting) are not supported and would break accounting. No on-chain enforcement; accepted as a known limitation.

#### M-3: Constants Assume 6-Decimal Quote Tokens

- **Status**: NOT APPLICABLE -- Constants are calibrated for 6-decimal tokens (USDC) but remain valid floors for higher-decimal tokens. Accepted as-is.

#### M-4: Capacity Increase Creates Free Slots (Owner-Driven Dilution Risk)

- **Status**: ACCEPTED RISK -- Same as H-3: free first mine is intended behavior. Owner control over capacity is an accepted trust assumption.

#### M-5: Entropy Liveness Risk Without Refund or Cancellation

- **Status**: FIXED -- Added `entropyEnabled` toggle to both MineRig and SpinRig. Renamed from `multipliersEnabled` in MineRig. In SpinRig, when entropy is disabled, spins skip the VRF request and pay out using `odds[0]` as a deterministic fallback. Owner can disable entropy if Pyth becomes unavailable.

#### M-6: SpinRig Epoch Recorded for Callback Is Inconsistent

- **Status**: FIXED -- `sequenceToEpoch`, `SpinRig__EntropyRequested`, and the entropy-off `SpinRig__Win` now all use `currentEpochId` (pre-increment). This also fixes a subgraph bug where `handleWin` could never match `handleSpin` entities because epoch IDs were off by one (`N` vs `N+1`).

---

### Low

#### L-1: ETH Overpayment Stuck in Rig Contracts

- **Status**: ACCEPTED RISK -- Excess ETH from overpayment stays in the contract. Accepted as user responsibility; multicall contracts handle fee calculation for typical usage.

#### L-2: Miner Fee Can Accumulate to address(0)

- **Status**: ACCEPTED -- First mine is free (price=0) so no funds are actually sent to address(0) in practice. Accepted as negligible.

#### L-3: Core/Registry Metadata Becomes Stale After Rig Updates

- **Status**: TO FIX -- Remove redundant mappings from Core contracts (keep only `isDeployedRig` and `rigToAuction` which Multicalls depend on). Slim down Registry to just `approvedFactories` and `isRegistered` -- all other data (`unit`, `launcher`, `rigType`, `allRigs[]`, `rigsByType[]`) is available via launch events and should be indexed by the subgraph instead.

#### L-4: Auction Can Sweep Arbitrary Tokens After Price Decays to 0

- **Status**: ACCEPTED RISK -- By design. Any tokens in the Auction contract are intended to be for sale.

---

### Informational / Observations

#### I-1: No Upgradeability Mechanism

- **Status**: ACCEPTED -- Intentional design choice. No proxies.

#### I-2: Centralization Risk Is Real and Expected

- **Status**: ACCEPTED -- Owner trust is an accepted assumption. Add a 2-step change process for sensitive addresses.

---

## Testing Gaps (High Priority for Coverage)

1. **MineRig slot initialization**
   - No test for slot 0 default price or free mining at deployment.

2. **MineRig multiplier update correctness**
   - Validate time-weighted emissions when `upsMultiplier` changes mid-epoch.
   - Regression test to ensure no retroactive over-minting.

3. **Uniswap pair pre-creation and launch griefing**
   - Test launch with pre-existing pair at different ratio.
   - Ensure behavior is intentional or mitigated.

4. **LP-token-price manipulation on Auction**
   - Simulate flash-loan liquidity skew and LP minting before `Auction.buy`.
   - Quantify value extraction.

5. **Entropy failure modes**
   - Simulate entropy callback absence.
   - Verify whether system halts, and define expected recovery.

6. **Non-standard ERC20 behaviors**
   - Fee-on-transfer token for fund/mine/spin flows.
   - Blacklisting token to ensure `fund`, `mine`, `spin` revert paths are safe.

7. **SpinRig epoch tracking**
   - No test verifying epoch in callback/logs.

---

## Suggested Next Steps

1. Patch MineRig slot initialization and capacity expansion (H-3, M-4).
2. Add time-weighted accrual for UPS multiplier changes (H-1).
3. Evaluate Auction denomination -- consider USDC instead of LP tokens (H-2).
4. Add a "pair must not exist" guard (or slippage) to all Core `launch` flows (H-4).
5. Snapshot SpinRig pool at spin time, not callback time (M-1).
6. Add a token whitelist or enforce standard ERC20 behavior (M-2).
7. Normalize constants to token decimals (M-3).
8. Add an emergency randomness toggle for SpinRig/MineRig (M-5).
9. Fix SpinRig epoch tracking to use pre-increment value (M-6).
10. Add tests for all above scenarios.
