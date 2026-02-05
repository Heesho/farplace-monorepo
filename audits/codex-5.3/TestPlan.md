# Test Plan

## Prerequisites
- Install dependencies in repo root (`npm install`) and hardhat workspace (already present in this environment).
- Use Node.js 20.x and Hardhat 2.27.x.

## Baseline Build and Existing Test Suite

```bash
cd /Users/hishamel-husseini/Documents/projects/farplace-monorepo/farplace-monorepo/packages/hardhat
npx hardhat compile
npx hardhat test
```

Expected:
- Compile succeeds.
- Test suite is generally green; fuzz components may show intermittent failures due randomized pricing timing.

## Focused Fuzz Stability Check

```bash
cd /Users/hishamel-husseini/Documents/projects/farplace-monorepo/farplace-monorepo/packages/hardhat
npx hardhat test tests/security/testFuzz.js
```

Expected:
- Fuzz suite passes and validates pricing, fee split, halving, and odds bounds behavior.

## Audit PoC Suite

```bash
cd /Users/hishamel-husseini/Documents/projects/farplace-monorepo/farplace-monorepo/packages/hardhat
npx hardhat test ../../audits/codex-5.3/pocs/high_findings.poc.test.js
```

Expected:
- `POC-H-01` passes and shows callback-time pool settlement extraction behavior in `SpinRig`.
- `POC-H-02` passes and shows MineRig emission drift after `setCapacity` due stale slot UPS.
- `POC-M-01` passes and shows excess ETH retained by `SpinRig` when entropy fee is overpaid.

## What Each PoC Demonstrates
- `POC-H-01`:
  - Initial spin records a pending entropy request.
  - Additional activity grows prize pool before callback.
  - Callback payout uses enlarged pool at callback time, not pool at spin time.
- `POC-H-02`:
  - Slot initialized at capacity=1 stores high UPS.
  - Capacity increased to 2 without re-scaling existing slot.
  - Displacement mint reflects legacy high UPS, exceeding rebalanced expectation.
- `POC-M-01`:
  - User sends `2x` entropy fee.
  - One fee forwarded; excess remains in rig balance with no withdrawal path.

## Coverage Notes
- Existing project tests already include extensive invariants, fuzzing, and exploit scenarios under:
  - `packages/hardhat/tests/mine`
  - `packages/hardhat/tests/slot`
  - `packages/hardhat/tests/fund`
  - `packages/hardhat/tests/security`
- Audit PoCs intentionally target deltas not fully enforced by existing tests:
  - callback-time settlement exposure,
  - capacity/UPS drift,
  - entropy overpayment retention.
