# Farplace Protocol Architecture

## Overview

Farplace is a decentralized token launchpad on Base with three distinct rig types, each implementing different token distribution mechanics. All rigs share common infrastructure (Unit tokens, Auctions, LP burning) but differ in how users earn tokens.

## Contract Hierarchy

```
                              +-------------+
                              |  Registry   |
                              | (optional)  |
                              +------+------+
                                     |
        +----------------------------+----------------------------+
        |                            |                            |
+-------v-------+           +--------v--------+          +--------v--------+
|   MineCore    |           |    SpinCore     |          |    FundCore     |
+-------+-------+           +--------+--------+          +--------+--------+
        |                            |                            |
+-------v-------+           +--------v--------+          +--------v--------+
| UnitFactory   |           | RigFactory      |          | RigFactory      |
| RigFactory    |           +--------+--------+          +--------+--------+
|AuctionFactory |                    |                            |
+-------+-------+           +--------v--------+          +--------v--------+
        |                   |     Rig         |          |     Rig         |
+-------v-------+           | (SpinRig)       |          | (FundRig)       |
|     Unit      |           +--------+--------+          +--------+--------+
|   (ERC20)     |                    |                            |
+---------------+           +--------v--------+          +--------v--------+
                            |   Auction       |          |   Auction       |
                            | (Treasury)      |          | (Treasury)      |
                            +-----------------+          +-----------------+
```

## Rig Types Comparison

| Feature | MineRig | SpinRig | FundRig |
|---------|---------|---------|---------|
| **Mechanism** | Slot competition | Slot machine | Daily pools |
| **Multi-slot** | Yes (configurable) | No | No |
| **VRF** | Optional (multiplier) | Required (payout) | None |
| **Emission** | Time × UPS × multiplier | Time-based to pool | Day-based |
| **Payout timing** | On slot takeover | On VRF callback | After day ends |
| **Pull pattern** | Yes (miner fees) | No | No |

## Common Launch Flow

All rig types follow the same launch pattern:

```
User calls Core.launch(params)
        |
        v
+-------+-------+
| 1. Transfer   |
|    DONUT      |
+-------+-------+
        |
        v
+-------+-------+
| 2. Deploy     |
|    Unit Token |
+-------+-------+
        |
        v
+-------+-------+
| 3. Mint       |
|    Initial    |
|    Units      |
+-------+-------+
        |
        v
+-------+-------+
| 4. Create     |
|  Unit/DONUT   |
|   LP Pool     |
+-------+-------+
        |
        v
+-------+-------+
| 5. Burn LP    |
|  (to dead     |
|   address)    |
+-------+-------+
        |
        v
+-------+-------+
| 6. Deploy     |
|   Auction     |
+-------+-------+
        |
        v
+-------+-------+
| 7. Deploy     |
|     Rig       |
+-------+-------+
        |
        v
+-------+-------+
| 8. Transfer   |
|   Unit mint   |
|    rights     |
+-------+-------+
        |
        v
+-------+-------+
| 9. Transfer   |
|  Ownership    |
|  to launcher  |
+---------------+
```

---

## MineRig Architecture

### Mining Flow

```
User calls mine(miner, index, epochId, deadline, maxPrice) + msg.value
        |
        v
+-------+-------+
| Validate      |
| - miner ≠ 0   |
| - deadline    |
| - index valid |
| - epochId     |
| - price       |
+-------+-------+
        |
        v
+-------+-------+
| Transfer      |
| quote token   |
| from user     |
+-------+-------+
        |
        v
+-------+-------+
| Calculate &   |
| distribute    |
| fees          |
+-------+-------+
        |
        +---> Protocol (1%)  --> protocolFeeAddress
        |
        +---> Treasury (15%) --> Auction contract
        |
        +---> Team (4%)      --> team address (or treasury)
        |
        +---> Miner (80%)    --> accountToClaimable[prevMiner]
        |
        v
+-------+-------+
| Mint Units to |
| prev miner    |
| (time × UPS × |
|  multiplier)  |
+-------+-------+
        |
        v
+-------+-------+
| Update slot   |
| - epochId++   |
| - initPrice   |
| - startTime   |
| - miner       |
| - ups         |
+-------+-------+
        |
        v
+-------+-------+
| Request VRF   |
| (if enabled)  |
+---------------+
        |
        | (async callback)
        v
+-------+-------+
| Set UPS       |
| multiplier    |
| (1x - 10x)    |
+---------------+
```

### Fee Distribution

```
Mining Fee (100%)
       |
       +---> Protocol (1%)  --> protocolFeeAddress
       |
       +---> Treasury (15%) --> Auction contract
       |
       +---> Team (4%)      --> team address (or treasury if not set)
       |
       +---> Miner (80%)    --> accountToClaimable[prevMiner] (PULL)
```

### UPS Halving (Supply-Based)

```
totalMinted     |  UPS (example: initialUps=100, halvingAmount=1000)
----------------|--------------------------------------------------
0 - 999         |  100 (full rate)
1000 - 1499     |  50  (1st halving)
1500 - 1749     |  25  (2nd halving)
1750 - 1874     |  12  (3rd halving)
...             |  ... (continues halving)
> threshold     |  tailUps (minimum floor)

Thresholds (geometric series):
  T[n] = H × (2 - 1/2^n) → approaches 2×H
```

---

## SpinRig Architecture

### Spin Flow

```
User calls spin(spinner, epochId, deadline, maxPrice) + msg.value
        |
        v
+-------+-------+
| Validate      |
| - spinner ≠ 0 |
| - deadline    |
| - epochId     |
| - price       |
+-------+-------+
        |
        v
+-------+-------+
| Transfer      |
| quote token   |
| from user     |
+-------+-------+
        |
        v
+-------+-------+
| Distribute    |
| fees (PUSH)   |
+-------+-------+
        |
        +---> Protocol (1%)  --> protocolFeeAddress
        |
        +---> Treasury (95%) --> Auction contract
        |
        +---> Team (4%)      --> team address
        |
        v
+-------+-------+
| Mint emissions|
| to prize pool |
| (this contract|
+-------+-------+
        |
        v
+-------+-------+
| Update epoch  |
| - epochId++   |
| - initPrice   |
| - startTime   |
+-------+-------+
        |
        v
+-------+-------+
| Request VRF   |
+---------------+
        |
        | (async callback from Pyth)
        v
+-------+-------+
| Draw odds     |
| index from    |
| random number |
+-------+-------+
        |
        v
+-------+-------+
| Calculate     |
| winAmount =   |
| pool × odds   |
| / 10000       |
+-------+-------+
        |
        v
+-------+-------+
| Transfer win  |
| to spinner    |
+---------------+
```

### Emission (Time-Based Halving)

```
Time elapsed    |  UPS (example: initialUps=100, halvingPeriod=30 days)
----------------|--------------------------------------------------
0 - 29 days     |  100 (full rate)
30 - 59 days    |  50  (1st halving)
60 - 89 days    |  25  (2nd halving)
...             |  tailUps (minimum floor)
```

---

## FundRig Architecture

### Donation Flow

```
User calls donate(account, recipient, amount)
        |
        v
+-------+-------+
| Validate      |
| - account ≠ 0 |
| - amount ≥ min|
| - recipient   |
|   whitelisted |
+-------+-------+
        |
        v
+-------+-------+
| Transfer      |
| payment token |
| from user     |
+-------+-------+
        |
        v
+-------+-------+
| Distribute    |
| immediately   |
+-------+-------+
        |
        +---> Recipient (50%) --> recipient address
        |
        +---> Treasury (45%) --> Auction contract
        |
        +---> Team (4%)      --> team address
        |
        +---> Protocol (1%)  --> protocolFeeAddress
        |
        v
+-------+-------+
| Update state  |
| dayToTotal    |
|   Donated[day]|
|   += amount   |
| dayAccountTo  |
|   Donation    |
|   [day][acct] |
|   += amount   |
+---------------+
```

### Claim Flow

```
User calls claim(account, day)
        |
        v
+-------+-------+
| Validate      |
| - day < today |
| - not claimed |
| - has donation|
+-------+-------+
        |
        v
+-------+-------+
| Calculate     |
| reward =      |
| (userDonation |
|  × dayEmission|
| / dayTotal)   |
+-------+-------+
        |
        v
+-------+-------+
| Mark claimed  |
+-------+-------+
        |
        v
+-------+-------+
| Mint Unit     |
| to account    |
+---------------+
```

### Emission (Day-Count Halving)

```
Day number      |  Emission (example: initial=1000, halvingPeriod=30)
----------------|--------------------------------------------------
Day 0-29        |  1000 (full rate)
Day 30-59       |  500  (1st halving)
Day 60-89       |  250  (2nd halving)
...             |  minEmission (floor)
```

---

## Treasury Auction Flow (All Rigs)

```
+------------------+
| Quote token      |
| accumulates in   |
| Auction from     |
| treasury fees    |
+--------+---------+
         |
         v
+--------+---------+
| Dutch Auction    |
| (price decays    |
|  over epoch)     |
+--------+---------+
         |
         v
+--------+---------+
| Buyer pays LP    |
| tokens           |
+--------+---------+
         |
         v
+--------+---------+
| Receives         |
| accumulated      |
| quote tokens     |
+--------+---------+
         |
         v
+--------+---------+
| LP tokens sent   |
| to dead address  |
| (burned)         |
+------------------+
```

---

## Key Invariants

### All Rigs
1. **Unit minting**: Only the Rig can mint Unit tokens (after `setRig`)
2. **LP burning**: Initial LP tokens sent to dead address, unrecoverable
3. **Immutable emissions**: Emission parameters cannot change after launch
4. **Ownership**: Two-step transfer via Ownable2Step

### MineRig Specific
5. **Capacity**: Can only increase, never decrease
6. **UPS floor**: Never drops below `tailUps`
7. **Pull pattern**: Miner fees credited to claimable balance

### SpinRig Specific
8. **Odds bounds**: All odds values between 100 (1%) and 10000 (100%)
9. **VRF required**: Every spin requires entropy callback

### FundRig Specific
10. **Day isolation**: Donations in one day don't affect other days
11. **Single claim**: Each account can only claim once per day

---

## Contract Addresses (Deployed)

| Contract | Address | Network |
|----------|---------|---------|
| MineCore | 0x504d4f579b5e16dB130d1ABd8579BA03087AE1b1 | Base |
| SpinCore | 0x2E392a607F94325871C74Ee9b9F5FBD44CcB5631 | Base |
| FundCore | 0x85f3e3135329272820ADC27F2561241f4b4e90db | Base |
| Registry | TBD | Base |
