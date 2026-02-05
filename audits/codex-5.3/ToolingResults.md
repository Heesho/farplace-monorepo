# Tooling Results

## Environment
- OS: macOS (workspace environment)
- Node.js: `v20.19.6`
- npm: `10.8.2`
- yarn: `1.22.22`
- Hardhat: `2.27.1`
- Foundry/forge: `1.2.3-stable`

## Static Analysis Tools

### Attempted
- `slither --version`
- `myth --version`
- `semgrep --version`

### Result
- All three commands returned `command not found` in this environment.
- No Slither/Mythril/Semgrep findings available.

## Build and Test Execution

### Compile
```bash
cd /Users/hishamel-husseini/Documents/projects/farplace-monorepo/farplace-monorepo/packages/hardhat
npx hardhat compile
```
- Result: `Nothing to compile`

### Baseline Test Run (full suite)
```bash
cd /Users/hishamel-husseini/Documents/projects/farplace-monorepo/farplace-monorepo/packages/hardhat
npx hardhat test
```
- First run during baseline phase: `968 passing`.
- Re-run later in audit session: `967 passing, 1 failing`.
  - Failure observed in fuzz test category due `MineRig__MaxPriceExceeded()` (transient/non-deterministic behavior in randomized test flow).

### Focused Fuzz Re-run
```bash
cd /Users/hishamel-husseini/Documents/projects/farplace-monorepo/farplace-monorepo/packages/hardhat
npx hardhat test tests/security/testFuzz.js
```
- Result: `217 passing`.

### Audit PoC Suite
```bash
cd /Users/hishamel-husseini/Documents/projects/farplace-monorepo/farplace-monorepo/packages/hardhat
npx hardhat test ../../audits/codex-5.3/pocs/high_findings.poc.test.js
```
- Result: `3 passing`.
- PoCs covered:
  - `POC-H-01` delayed callback extraction in `SpinRig`.
  - `POC-H-02` capacity-related emission drift in `MineRig`.
  - `POC-M-01` excess entropy ETH retained in `SpinRig`.

## De-duplication and False Positive Notes
- Existing in-repo “security/exploit” tests include scenarios labeled as exploits but some are intended design tradeoffs. These were not auto-accepted as vulnerabilities.
- Findings in this report are tied to code-level exploitability and reproducible impact, with explicit PoCs for high findings.
