# Codex 5.3 Audit Bundle

This folder contains the complete smart contract audit deliverables for this repository.

## Files
- `AuditReport.md` - full professional report with findings, exploit paths, and remediation.
- `Findings.md` - founder-focused concise risk summary.
- `ThreatModel.md` - assets, actors, trust assumptions, attack surfaces, invariants.
- `Architecture.md` - module/value-flow/permission/upgrade analysis.
- `ToolingResults.md` - tool versions, command outputs, and de-dup notes.
- `TestPlan.md` - exact verification commands and expected outcomes.
- `PoC_Index.md` - mapping of PoCs to findings.
- `pocs/high_findings.poc.test.js` - dedicated reproducible PoC test suite.

## Quick Run
```bash
cd /Users/hishamel-husseini/Documents/projects/farplace-monorepo/farplace-monorepo/packages/hardhat
npx hardhat test ../../audits/codex-5.3/pocs/high_findings.poc.test.js
```

Expected: 3 passing tests (`POC-H-01`, `POC-H-02`, `POC-M-01`).
