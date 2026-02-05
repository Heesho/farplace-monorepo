# PoC Index

## Files
- `/Users/hishamel-husseini/Documents/projects/farplace-monorepo/farplace-monorepo/audits/codex-5.3/pocs/high_findings.poc.test.js`

## PoCs
- `POC-H-01` (`high_findings.poc.test.js`): proves `SpinRig` payout is computed from callback-time pool, enabling delayed-settlement extraction.
- `POC-H-02` (`high_findings.poc.test.js`): proves `MineRig` capacity changes do not rebalance existing slot UPS, causing emission-rate drift and over-mint against rebalanced expectation.
- `POC-M-01` (`high_findings.poc.test.js`): proves excess ETH sent for entropy fee remains trapped in `SpinRig`.

## Run Command
```bash
cd /Users/hishamel-husseini/Documents/projects/farplace-monorepo/farplace-monorepo/packages/hardhat
npx hardhat test ../../audits/codex-5.3/pocs/high_findings.poc.test.js
```
