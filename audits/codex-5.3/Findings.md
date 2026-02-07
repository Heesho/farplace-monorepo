# Findings (Founder Summary)

## Current Disposition (February 6, 2026)
All listed findings are accepted risks for the current release posture based on project owner decisions.

## Top 5 Risks
1. **H-01: SpinRig delayed-callback extraction**
   - Callback payout uses *current* pool at callback time, not spin-time context, enabling economic manipulation if callback ordering/liveness is adversarial.
2. **H-02: MineRig capacity-induced emission drift**
   - Increasing capacity does not rescale existing slots; legacy slots keep stronger UPS and can over-mint relative to intended split.
3. **M-01: Excess entropy ETH can become permanently trapped**
   - Overpaying entropy fee in direct rig calls retains ETH in contract with no withdrawal path.
4. **M-02: Non-standard quote/payment tokens are not enforced out**
   - Fee-on-transfer/rebasing/blocklist tokens can break accounting or freeze rig flows.
5. **M-03: Mutable protocol fee recipient can freeze core flows**
   - If protocol fee address becomes non-receivable/blocked for token transfers, fund/mine/spin transactions can revert.

## Must-Fix Before Mainnet
None mandated by current risk acceptance stance.

## Nice-to-Have Hardening
- Enforce exact entropy fee or auto-refund `msg.value - fee`.
- Add two-step/timelocked admin updates for protocol fee recipient.
- Add operational monitoring alerts for pending entropy requests and callback delays.
