# Farplace Smart Contract Security Audit Report (Codex 5.3)

## Executive Summary
Farplace is a launchpad architecture that deploys a per-project Unit token plus one of three distribution engines (`MineRig`, `SpinRig`, `FundRig`). Liquidity is seeded into a Unit/USDC pool, LP is burned, and a Dutch `Auction` accumulates and sells treasury assets.

The codebase is generally structured and heavily tested, with good use of `ReentrancyGuard`, one-time Unit mint-role handoff, and clear fee split logic. However, the audit identified **two high-severity issues**:
- `SpinRig` callback settlement is tied to **callback-time pool state**, creating delayed-settlement extraction and fairness break under adversarial callback ordering/liveness.
- `MineRig` capacity changes do not rescale existing slot UPS, allowing **emission-rate drift** and over-mint against intended per-capacity economics.

Additionally, three medium issues were identified around entropy ETH overpayment retention, unsupported token behavior enforcement, and protocol fee recipient DoS sensitivity.

No proxy upgrade risk was identified (contracts are non-upgradeable).
As of **February 6, 2026**, all reported findings are explicitly accepted risks by project owner decision for current release posture.

---

## Project Overview
Farplace deploys tokenized launch instances with three game/economic modes:
- `MineRig`: users compete to hold mining slots; displaced miners receive accrued Unit + fee share.
- `SpinRig`: users pay to spin; entropy callback selects payout odds from a configured array.
- `FundRig`: users donate into daily pools and claim Unit emissions proportionally.

Protected assets include user quote token flows, Unit token issuance fairness, Spin prize pool balances, Mine claimable balances, and registry integrity.

---

## Scope

### Commit
- `d9a8e140371d53834c5f7f6518c1a5c1f7a6f2e6`

### In Scope (production)
- `packages/hardhat/contracts/Unit.sol`
- `packages/hardhat/contracts/UnitFactory.sol`
- `packages/hardhat/contracts/Registry.sol`
- `packages/hardhat/contracts/Auction.sol`
- `packages/hardhat/contracts/AuctionFactory.sol`
- `packages/hardhat/contracts/rigs/fund/FundCore.sol`
- `packages/hardhat/contracts/rigs/fund/FundRig.sol`
- `packages/hardhat/contracts/rigs/fund/FundRigFactory.sol`
- `packages/hardhat/contracts/rigs/fund/FundMulticall.sol`
- `packages/hardhat/contracts/rigs/mine/MineCore.sol`
- `packages/hardhat/contracts/rigs/mine/MineRig.sol`
- `packages/hardhat/contracts/rigs/mine/MineRigFactory.sol`
- `packages/hardhat/contracts/rigs/mine/MineMulticall.sol`
- `packages/hardhat/contracts/rigs/spin/SpinCore.sol`
- `packages/hardhat/contracts/rigs/spin/SpinRig.sol`
- `packages/hardhat/contracts/rigs/spin/SpinRigFactory.sol`
- `packages/hardhat/contracts/rigs/spin/SpinMulticall.sol`
- Corresponding interfaces under `packages/hardhat/contracts/interfaces` and `packages/hardhat/contracts/rigs/**/interfaces`

### Out of Scope
- Frontend and app packages (not contract logic).
- Third-party libraries (`node_modules`) except dependency behavior at integration boundaries.
- Mocks excluded from findings severity, but used in PoC harnesses.

---

## Environment and Commands Run

### Versions
- Node.js `v20.19.6`
- npm `10.8.2`
- yarn `1.22.22`
- Hardhat `2.27.1`
- forge `1.2.3-stable`

### Core Commands
```bash
pwd
ls -la
find packages/hardhat/contracts -type f -name "*.sol"
cat packages/hardhat/hardhat.config.js
git rev-parse HEAD
npx hardhat --version
npx hardhat compile
npx hardhat test
npx hardhat test tests/security/testFuzz.js
npx hardhat test ../../audits/codex-5.3/pocs/high_findings.poc.test.js
slither --version
myth --version
semgrep --version
```

### Notes
- `slither`, `myth`, `semgrep` unavailable (`command not found`).
- Full-suite test re-run showed one transient fuzz failure (`MineRig__MaxPriceExceeded`) while targeted fuzz suite passed.

---

## Threat Model Summary
- External protocols and callbacks were treated as adversarial surfaces.
- Admin compromise was explicitly modeled.
- Critical invariants focused on:
  - mint authority correctness,
  - emission integrity,
  - payout fairness,
  - fee split conservation,
  - callback safety/liveness.

See full model: `audits/codex-5.3/ThreatModel.md`.

---

## Architecture Summary and Trust Boundaries
- Core contracts orchestrate launch + registration.
- Rig contracts hold runtime logic and most value movement.
- Auction contracts hold treasury-accrued assets and sell via Dutch pricing.
- Entropy callback path is asynchronous and external.
- Quote token behavior is external and currently under-constrained.

See full breakdown: `audits/codex-5.3/Architecture.md`.

---

## Special Focus Area Results
- **Missing access control / role misconfiguration**: no missing `onlyOwner` found on declared admin functions; however mutable admin endpoints introduce `M-03` governance/DoS risk.
- **Reentrancy and cross-function reentrancy**: `ReentrancyGuard` coverage is strong on core state-changing paths; no direct reentrancy exploit found in production scope.
- **ERC20 edge cases**: unsupported token semantics are not onchain-enforced, creating `M-02` runtime risk.
- **Rounding/precision in economics**: integer rounding dust generally routes to treasury remainder; no overflow identified; emission drift issue captured in `H-02`.
- **Oracle/randomness reliance**: callback ordering/liveness creates `H-01` settlement risk.
- **Upgradeability hazards**: no proxy/upgrade surface detected.
- **DoS via loops/external calls**: multicall read loops can become expensive (`L-01`); fee-recipient transfer dependencies can freeze flows (`M-03`).
- **Event correctness**: event coverage is generally good and aligned with state changes for key flows.
- **Pause/emergency controls**: no pausable circuit breaker in production contracts; this increases operational response burden.

---

## Findings Table

| ID | Title | Severity | Affected Contracts | Likelihood | Impact |
|---|---|---|---|---|---|
| H-01 | SpinRig callback-time payout enables delayed-settlement extraction | High | `SpinRig.sol` | Medium | High |
| H-02 | MineRig capacity updates do not rebalance existing slot UPS | High | `MineRig.sol` | High | High |
| M-01 | Entropy fee overpayment can trap ETH in rig contracts | Medium | `SpinRig.sol`, `MineRig.sol` | Medium | Medium |
| M-02 | Unsupported ERC20 token behavior is not enforced onchain | Medium | `FundRig.sol`, `MineRig.sol`, `SpinRig.sol`, Cores | Medium | Medium |
| M-03 | Protocol fee recipient mutability can induce global fee-flow DoS | Medium | `FundRig.sol`, `MineRig.sol`, `SpinRig.sol`, Cores | Medium | Medium |
| L-01 | Unbounded multicall read loops can be gas-heavy / unreliable for large ranges | Low | `FundMulticall.sol`, `MineMulticall.sol` | Medium | Low |

---

## Detailed Findings

### H-01: SpinRig callback-time payout enables delayed-settlement extraction

**Disposition**: Accepted risk (project owner decision, February 6, 2026).

**Severity justification**
- Payout amount is computed against the **live pool at callback time**, not spin time. Under delayed/reordered callbacks, economic outcome diverges from expected spin context.
- External callback dependency (entropy/provider/liveness) is a hostile surface in this threat model.

**Affected code**
- `packages/hardhat/contracts/rigs/spin/SpinRig.sol:291`
- `packages/hardhat/contracts/rigs/spin/SpinRig.sol:320`
- `packages/hardhat/contracts/rigs/spin/SpinRig.sol:332`

Snippet:
```solidity
sequenceToSpinner[seq] = spinner;
sequenceToEpoch[seq] = currentEpochId;
...
uint256 pool = IERC20(unit).balanceOf(address(this));
uint256 winAmount = pool * oddsBps / DIVISOR;
```

**Exploit scenario**
1. Attacker spins and obtains a pending entropy sequence.
2. Callback is delayed (or reordered) while pool grows from new emissions/spins.
3. Callback resolves later and pays from the enlarged pool.
4. Attacker receives payout larger than what spin-time pool would permit.

**Impact**
- Economic extraction and fairness break in payout scheduling.
- Users cannot reason about payout basis at spin submission time.
- Multiple queued callbacks amplify payout-order sensitivity.

**Recommended remediation**
- Snapshot payout basis at spin time and bind sequence to immutable settlement context:
  - `sequenceToPoolSnapshot` and/or `sequenceToPayoutBase`.
- Enforce callback freshness/expiry (e.g., max callback delay, stale sequence cancellation).
- Provide explicit unresolved-request handling (timeout + deterministic fallback/refund policy).

**How to verify the fix**
- [ ] Delayed callback payout equals spin-time snapshot-based expectation, not current pool.
- [ ] Out-of-order callbacks cannot improve payout above snapshot basis.
- [ ] Stale sequences are explicitly handled (revert/cancel/refund).

**PoC**
- File: `audits/codex-5.3/pocs/high_findings.poc.test.js`
- Test: `POC-H-01`
- Run:
  ```bash
  cd /Users/hishamel-husseini/Documents/projects/farplace-monorepo/farplace-monorepo/packages/hardhat
  npx hardhat test ../../audits/codex-5.3/pocs/high_findings.poc.test.js
  ```

---

### H-02: MineRig capacity updates do not rebalance existing slot UPS

**Disposition**: Accepted risk (project owner decision, February 6, 2026).

**Severity justification**
- `setCapacity` updates only global `capacity`; existing slots keep legacy cached `slot.ups` until individually mined.
- A malicious owner can preserve higher-rate legacy slots while adding lower-rate new slots, then realize disproportionate minting.

**Affected code**
- `packages/hardhat/contracts/rigs/mine/MineRig.sol:329`
- `packages/hardhat/contracts/rigs/mine/MineRig.sol:494`

Snippet:
```solidity
slotCache.ups = _getUpsFromSupply() / capacity;
...
function setCapacity(uint256 _capacity) external onlyOwner {
    capacity = _capacity;
}
```

**Exploit scenario**
1. Owner mines slot at `capacity=1` (high per-slot UPS).
2. Owner increases `capacity` (e.g., to 2+).
3. Existing slot retains old UPS; new slots use reduced UPS.
4. Owner keeps legacy slot active, then displaces to realize excess mint compared to rebalanced model.

**Impact**
- Emission-rate drift and supply inflation vs expected per-capacity economics.
- Potential severe dilution of Unit holders.

**Recommended remediation**
- Preferred: compute effective per-slot emission dynamically from global state at mint/displacement time instead of caching `slot.ups` as long-lived truth.
- Alternative: rebalance all active slots on capacity change (with careful gas strategy).
- Governance hardening: timelock/guardrails for `setCapacity` and explicit economic disclosure.

**How to verify the fix**
- [ ] After capacity increase, legacy slot emission aligns with new per-capacity rate.
- [ ] Displacement mint amount for old slots matches rebalanced expectation.
- [ ] No legacy slot preserves pre-change UPS indefinitely.

**PoC**
- File: `audits/codex-5.3/pocs/high_findings.poc.test.js`
- Test: `POC-H-02`
- Run:
  ```bash
  cd /Users/hishamel-husseini/Documents/projects/farplace-monorepo/farplace-monorepo/packages/hardhat
  npx hardhat test ../../audits/codex-5.3/pocs/high_findings.poc.test.js
  ```

---

### M-01: Entropy fee overpayment can trap ETH in rig contracts

**Disposition**: Accepted risk (project owner decision, February 6, 2026).

**Severity justification**
- Direct calls to payable entropy paths accept `msg.value > fee` and retain excess ETH in contract.
- No native ETH withdrawal/recovery path exists.

**Affected code**
- `packages/hardhat/contracts/rigs/spin/SpinRig.sol:293`
- `packages/hardhat/contracts/rigs/mine/MineRig.sol:345`

**Exploit scenario**
1. User sends more ETH than required entropy fee.
2. Contract forwards only required fee to entropy.
3. Excess remains in rig balance with no rescue method.

**Impact**
- Permanent user fund loss for overpaying callers.

**Recommended remediation**
- Enforce `msg.value == fee` on entropy-required paths, or refund `msg.value - fee`.
- Add explicit native ETH rescue function if retained ETH is unavoidable.

**How to verify the fix**
- [ ] Overpayment reverts or is fully refunded.
- [ ] Contract native ETH balance does not accumulate from user overpayment.

**PoC**
- File: `audits/codex-5.3/pocs/high_findings.poc.test.js`
- Test: `POC-M-01`

---

### M-02: Unsupported ERC20 token behavior is not enforced onchain

**Disposition**: Accepted risk (project owner decision, February 6, 2026).

**Severity justification**
- Protocol expects standard ERC20s but accepts arbitrary quote/payment tokens at launch.
- Fee-on-transfer, rebasing, or blocklist behavior can break accounting or liveness.

**Affected code**
- `packages/hardhat/contracts/rigs/fund/FundRig.sol:165`
- `packages/hardhat/contracts/rigs/mine/MineRig.sol:279`
- `packages/hardhat/contracts/rigs/spin/SpinRig.sol:254`
- `packages/hardhat/contracts/rigs/*Core.sol` launch params (`quoteToken`) without allowlist enforcement.

**Exploit scenario**
1. Rig is launched with non-standard quote token.
2. Transfers do not match expected amount semantics or revert on specific recipients.
3. Runtime operations (`fund`, `mine`, `spin`) fail or behave unexpectedly.

**Impact**
- Partial/full DoS of rig operations.
- User confusion and potential economic mismatches.

**Recommended remediation**
- Add strict quote token allowlist at Core level.
- If broader token support required, use balance-delta accounting and robust failure handling.

**How to verify the fix**
- [ ] Non-allowlisted token launch attempts revert.
- [ ] Supported tokens pass full lifecycle tests (`launch`, action path, fees, claims).

---

### M-03: Protocol fee recipient mutability can induce global fee-flow DoS

**Disposition**: Accepted risk (project owner decision, February 6, 2026).

**Severity justification**
- Core owner can set protocol fee recipient to any address.
- If recipient cannot accept token transfer semantics, user-facing rig actions may revert system-wide for that rig class.

**Affected code**
- `packages/hardhat/contracts/rigs/fund/FundCore.sol:292`
- `packages/hardhat/contracts/rigs/mine/MineCore.sol:308`
- `packages/hardhat/contracts/rigs/spin/SpinCore.sol:306`
- Fee transfer usage in rigs (`FundRig`, `MineRig`, `SpinRig`).

**Exploit scenario**
1. Compromised/malicious core owner sets protocol fee recipient to incompatible address.
2. Fee transfer path reverts on actions.
3. `fund`/`mine`/`spin` calls fail across affected rigs.

**Impact**
- Operational freeze and degraded trust.

**Recommended remediation**
- Two-step/timelocked protocol fee recipient updates.
- Consider non-blocking protocol fee accrual (pull pattern) to avoid hard dependency on transfer success.

**How to verify the fix**
- [ ] Recipient change requires delayed confirmation.
- [ ] Action paths continue if protocol fee collection endpoint is misconfigured.

---

### L-01: Unbounded multicall read loops can be gas-heavy on large ranges

**Disposition**: Accepted risk (project owner decision, February 6, 2026).

**Severity justification**
- User-supplied ranges/arrays in view helpers can become impractical at large sizes.

**Affected code**
- `packages/hardhat/contracts/rigs/fund/FundMulticall.sol:264`
- `packages/hardhat/contracts/rigs/fund/FundMulticall.sol:300`
- `packages/hardhat/contracts/rigs/mine/MineMulticall.sol:300`

**Impact**
- RPC call failures/timeouts for oversized inputs.

**Recommended remediation**
- Add explicit upper bounds on array/range inputs.
- Document client-side pagination requirements.

---

## Positive Notes
- Consistent use of `ReentrancyGuard` for state-changing paths.
- Unit mint authority model is clean: one-time `setRig` lock prevents later mint-role reassignment.
- Broad existing test coverage includes invariants/fuzz/exploit scenarios.
- No delegatecall/proxy upgrade attack surface in production contracts.

---

## Remediation Roadmap
1. **Current posture**
   - All findings accepted as known design/governance/UX risks for release.
2. **Optional hardening (recommended)**
   - Snapshot-based spin settlement or callback liveness guardrails (`H-01`).
   - Explicit capacity economics policy controls (`H-02`).
   - Exact entropy fee or refund model (`M-01`).
   - Onchain quote-token allowlist (`M-02`).
   - Timelocked/two-step protocol fee recipient changes (`M-03`).
   - Multicall pagination limits (`L-01`).

---

## Residual Risk (Post-Remediation Assumptions)
Even after recommended fixes:
- Admin key compromise remains a critical governance risk unless mitigated with multisig/timelock.
- External dependencies (Entropy, token contracts, DEX integrations) remain systemic risk and require monitoring.
- Economic/game-theory parameters still need continuous simulation under realistic market/MEV conditions.
