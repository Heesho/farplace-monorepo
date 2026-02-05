# Findings (Founder Summary)

## Top 5 Risks
1. **H-01: SpinRig delayed-callback extraction**
   - Callback payout uses *current* pool at callback time, not spin-time context, enabling economic manipulation if callback ordering/liveness is adversarial.
2. **H-02: MineRig capacity-induced emission drift**
   - Increasing capacity does not rescale existing slots; legacy slots keep stronger UPS and can over-mint relative to intended split.
3. **M-01: Non-standard quote/payment tokens are not enforced out**
   - Fee-on-transfer/rebasing/blocklist tokens can break accounting or freeze rig flows.
4. **M-02: Mutable protocol fee recipient can freeze core flows**
   - If protocol fee address becomes non-receivable/blocked for token transfers, fund/mine/spin transactions can revert.
5. **M-03: Excess entropy ETH can become permanently trapped**
   - Overpaying entropy fee in direct rig calls retains ETH in contract with no withdrawal path.

## Must-Fix Before Mainnet
- Implement spin settlement hardening for `H-01`:
  - snapshot payout basis at spin time,
  - add callback freshness/expiry,
  - provide timeout/cancel/refund strategy for unresolved requests.
- Fix `H-02` MineRig capacity logic:
  - compute effective per-slot UPS dynamically or normalize all slots on capacity changes.
- Enforce quote token safety:
  - allowlist only supported ERC20s, or add strict balance-delta accounting and receiver-failure tolerance.

## Nice-to-Have Hardening
- Enforce exact entropy fee or auto-refund `msg.value - fee`.
- Add two-step/timelocked admin updates for protocol fee recipient.
- Add operational monitoring alerts for pending entropy requests and callback delays.
