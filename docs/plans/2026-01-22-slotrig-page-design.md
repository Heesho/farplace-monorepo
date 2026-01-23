# SlotRig Page Design

## Overview

Design for the SlotRig "Spin" page - a slot machine gambling interface where users pay to spin for a chance to win tokens from the prize pool. VRF determines payout percentage.

**Design principles:**
- Clean/minimal aesthetic matching MineRig page
- Grayscale color scheme throughout
- Prize pool as the hero element
- Global/social experience - everyone sees spins happen in real-time

## Page Structure

### 1. Header

Same pattern as MineModal:
- X close button (left)
- "Spin" title (center)
- Empty spacer (right)

### 2. Prize Pool Hero (Sticky)

The main focal point of the page.

```
┌─────────────────────────────────┐
│         PRIZE POOL              │
│                                 │
│        [token] 124,532.45       │  <- Ticking up in real-time
│          $1,234.56              │  <- USD value
│                                 │
│   ┌─────────────────────────┐   │
│   │                         │   │
│   │    [Spinner Area]       │   │  <- Idle: shows last winner
│   │                         │   │  <- Spinning: animated
│   └─────────────────────────┘   │
│                                 │
│   Current price: $0.0234        │  <- Decaying price
└─────────────────────────────────┘
```

**States:**
- **Idle**: Shows last winner result (e.g., "0x1234...5678 won 12% -> 1,234 TOKENS")
- **Spinning**: Animation plays while waiting for VRF
- **Reveal**: VRF returns, result displayed, becomes new "last winner"

**Behaviors:**
- Prize pool amount ticks up in real-time (emissions accumulating)
- Spin price decays over epoch period
- Only one spinner at a time - everyone sees the same state

### 3. Odds Breakdown (Always Visible)

Table showing possible payouts based on current pool.

```
┌─────────────────────────────────┐
│  Odds                           │
│                                 │
│  Chance    Payout    Win        │
│  ─────────────────────────────  │
│   50%        1%      1,245 [T]  │
│   25%        5%      6,226 [T]  │
│   15%       15%     18,679 [T]  │
│    8%       35%     43,586 [T]  │
│    2%      100%    124,532 [T]  │  <- Jackpot row
└─────────────────────────────────┘
```

- Three columns: chance %, payout %, actual token amount
- Token amounts update in real-time as pool grows
- Jackpot row (100%) gets subtle lighter background
- Clean table layout, grayscale

### 4. Your Position

2x2 grid of user stats, same pattern as MineRig.

```
┌─────────────────────────────────┐
│  Your position                  │
│                                 │
│  Spent              Won         │
│  $564.68            [T] 45,230  │
│                     $123.45     │
│                                 │
│  Spins              Net         │
│  47                 -$441.23    │
└─────────────────────────────────┘
```

- **Spent**: Total USD spent on spins
- **Won**: Total tokens won + USD value
- **Spins**: Number of spins by user
- **Net**: P&L (won minus spent)
  - Negative: darker/dimmer gray
  - Positive: lighter/brighter white

### 5. Leaderboard

Reuse existing Leaderboard component, ranked by total tokens won.

```
┌─────────────────────────────────┐
│  Leaderboard                    │
│                                 │
│  #1  [av] 0x1234...5678  892K   │
│  #2  [av] 0xabcd...ef01  654K   │
│  #3  [av] 0x9876...5432  421K   │
│  #4  [av] 0xdead...beef  287K   │
│  #5  [av] 0xcafe...babe  156K   │  <- Highlighted if current user
│  ...                            │
│  #10 [av] 0x1111...2222   34K   │
│                                 │
│  [Share your rank]              │
└─────────────────────────────────┘
```

- Top 10 by tokens won
- Avatar, address (or Farcaster name), amount
- Current user highlighted
- Optional share button

### 6. Recent Spins (Live Feed)

Last 10 spins from all users, real-time updates.

```
┌─────────────────────────────────┐
│  Recent Spins                   │
│                                 │
│  [av] 0x1234...5678     2m ago  │
│       Won 12% -> [T] 14,943     │
│       Paid $0.0456              │
│                                 │
│  [av] 0xabcd...ef01     5m ago  │
│       Won 1% -> [T] 1,203       │
│       Paid $0.0234              │
│                                 │
│  [av] 0x9876...5432     8m ago  │
│       Won 35% -> [T] 41,234     │
│       Paid $0.0512              │
│  ...                            │
└─────────────────────────────────┘
```

- Avatar, address, time ago
- Payout percentage and tokens won
- Price paid to spin
- New spins animate in at top
- Grayscale, no special colors for big wins

### 7. Bottom Action Bar (Sticky)

Fixed at bottom, same pattern as MineRig.

```
┌─────────────────────────────────┐
│  Price          Balance  [Spin] │
│  $0.0234        $12.45          │
└─────────────────────────────────┘
```

- **Price**: Current spin price (decaying)
- **Balance**: User's wallet balance
- **Spin button**: White, disabled during pending spin or insufficient balance

**Button states:**
- Enabled: "Spin" (white bg, black text)
- Disabled (spinning): "Spinning..." (gray bg)
- Disabled (no balance): "Spin" (gray bg)

## Key Behaviors

### Prize Pool Ticking
- Emissions accumulate in real-time
- Pool amount visually ticks up every second (or smoother)
- Updates odds table "Win" column in real-time

### Price Decay
- Dutch auction style: starts high, decays to near-zero over epoch
- Resets with multiplier after each spin
- Show decay visually (number decreasing)

### Global Spin State
- Only one person can spin at a time
- When anyone spins, ALL users see:
  1. Spinner area animates
  2. Button shows "Spinning...", disabled for everyone
  3. VRF returns, result revealed to everyone
  4. Prize pool updates (reduced by win amount)
  5. Back to idle state

### Spin Animation
- Simple, clean animation (not casino-flashy)
- Could be: rotating icon, pulsing dots, or slot-reel style numbers
- Grayscale animation, ~2-5 seconds typical VRF wait

## Component Structure

```
SpinModal
├── Header (X, title)
├── PrizePoolHero (sticky)
│   ├── PoolAmount (ticking)
│   ├── SpinnerArea (idle/spinning/result)
│   └── CurrentPrice (decaying)
├── OddsBreakdown (table)
├── YourPosition (2x2 grid)
├── Leaderboard (reuse existing)
├── RecentSpins (live feed)
│   └── SpinHistoryItem (per spin)
└── BottomBar (sticky)
    ├── Price
    ├── Balance
    └── SpinButton
```

## Data Requirements

### From Contract/Subgraph
- `prizePool`: Current pool amount
- `currentPrice`: Decaying spin price
- `epochId`: Current epoch
- `odds`: Array of [chance, payout] tuples
- `spins`: Recent spin events (spinner, payout%, amount, timestamp)
- `userStats`: Spent, won, spin count for current user
- `leaderboard`: Top winners

### Real-time Updates
- Prize pool: Subscribe to emissions/block updates
- Spins: Subscribe to Spin events
- Price: Calculate locally from epoch start + decay rate

## Open Questions

None - design is complete and approved.

## Implementation Notes

- Reuse existing components: Leaderboard, Avatar, NavBar, bottom bar pattern
- Create new: SpinModal, PrizePoolHero, SpinnerArea, OddsBreakdown, SpinHistoryItem
- Similar file structure to MineModal
