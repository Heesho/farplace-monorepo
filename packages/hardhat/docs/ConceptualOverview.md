# Mineport Conceptual Overview

## 1) What is Mineport?

Mineport is a token launchpad on Base that distributes tokens through mining mechanisms instead of traditional sales. Rather than buying tokens directly, users earn them by participating in various "rigs" - smart contracts that reward specific behaviors over time.

The core principle: **work is verified, then rewarded**. There's no presale to frontrun, no bundle to snipe. Everyone competes on equal terms through transparent mechanisms.

## 2) Why Mining?

Traditional token launches have a fundamental fairness problem:

- **Bundlers and snipers** grab large allocations before regular users can react
- **Fixed-price sales** reward speed over conviction
- **Presales** create insider advantages
- **Team allocations** can be dumped on retail

Mining inverts this:

- **Time-weighted participation** rewards commitment, not speed
- **Dutch auction pricing** means waiting is rewarded (but risks someone else moving first)
- **No team allocation** - everyone earns through the same mechanisms
- **Burned liquidity** means no one can pull the rug

## 3) The Four Rig Types

Mineport supports four distinct rig architectures, each designed to incentivize different behaviors:

### MineRig - Classic Mining

A rotating seat competition where one wallet at a time collects token emissions.

- **Mechanism**: Dutch auction for mining seats. Price starts high and decays toward zero.
- **Earning**: Hold the seat to accumulate tokens over time. Get paid when someone takes your seat.
- **Fee split**: 80% to previous miner, 15% treasury, 4% team, 1% protocol
- **Use case**: Pure speculation and trading activity

### SlotRig - Casino/Gambling

A slot machine where users pay to spin for a chance at the prize pool.

- **Mechanism**: Pay the Dutch auction price to spin. VRF determines your payout.
- **Earning**: Win a percentage of the prize pool based on random odds (1% to 100%)
- **Fee split**: 95% treasury, 4% team, 1% protocol
- **Use case**: Entertainment and gaming

### FundRig - Charitable Giving

Daily donation pools where contributors claim proportional token rewards.

- **Mechanism**: Donate to a daily pool. When the day ends, claim your share of emissions.
- **Earning**: Your claim = (your donation / total daily donations) × daily emissions
- **Fee split**: 50% to charity recipient, 45% treasury, 4% team, 1% protocol
- **Use case**: Fundraising for causes with crypto incentives

### ContentRig - Content Creation

NFT collection with a "steal" mechanic where collectors earn staking rewards.

- **Mechanism**: Create content as NFTs. Others can "collect" (steal) your NFT by paying the Dutch auction price.
- **Earning**: Hold NFTs to earn staking rewards. Get paid when someone collects from you.
- **Fee split**: 80% to previous owner, 15% treasury, 2% creator, 2% team, 1% protocol
- **Use case**: Art, memes, and creative content

## 4) The Launch Process

When someone launches a token through Mineport:

1. **Seed liquidity** - Launcher provides DONUT to create the initial trading pool
2. **Deploy contracts** - Unit token, Rig, and Auction are deployed
3. **Create LP** - Token is paired with DONUT in a Uniswap V2 pool
4. **Burn LP tokens** - LP tokens are sent to a dead address (liquidity locked forever)
5. **Start mining** - The rig begins and users can participate

Once launched, the emission rules are **immutable**. No one can change the emission rate, halving schedule, or price mechanics.

## 5) Tokenomics

All rig types share common tokenomics principles:

### Dutch Auction Pricing

Prices decay linearly within epochs:
- Starts at a configured initial price
- Falls toward zero over a fixed period
- Resets when someone takes action (relative to what they paid)

This prevents frontrunning - there's no advantage to being fastest.

### Halving Emissions

Token supply follows a geometric decay (Bitcoin-style):
- Emissions start at a configured rate
- Halve at predetermined thresholds
- Never drop below a configured floor

This ensures predictable scarcity.

### Burned Liquidity

Initial LP tokens are sent to an unreachable address:
- No one can withdraw the base liquidity
- The trading pool exists forever
- This makes rug pulls impossible by design

## 6) The Cast of Characters

| Actor | Role | Trust Level |
|-------|------|-------------|
| **Launcher** | Creates the rig, sets parameters, receives ownership | Semi-trusted |
| **Users** | Participate in rigs to earn tokens | Untrusted |
| **Treasury** | Receives fee share, used for token buybacks | Automated |
| **Team** | Optional fee recipient set by launcher | Configurable |
| **Protocol** | Platform fee recipient | Trusted |

### What Launchers Can Do
- Set initial parameters (emission rate, pricing, etc.)
- Change treasury and team wallet addresses
- Update metadata URI

### What Launchers Cannot Do
- Change emission rules after launch
- Withdraw user funds
- Mint tokens outside the rig mechanics
- Pull liquidity

## 7) The Treasury Auction

Mining fees accumulate in a treasury (held as the quote token, typically USDC). This treasury can be purchased through a separate Dutch auction:

1. Treasury fees accumulate from rig activity
2. Anyone with LP tokens can buy the treasury
3. They pay LP tokens, receive the accumulated fees
4. LP tokens are burned (sent to dead address)

This creates a virtuous cycle:
- Active rigs → treasury accumulates
- LP holders buy treasury → LP supply shrinks
- Concentrated LP → better liquidity for traders

## 8) Incentive Alignment

The system is designed so that selfish behavior still benefits the ecosystem:

| Actor | Selfish Goal | System Benefit |
|-------|--------------|----------------|
| Miner | Maximize token earnings | Provides liquidity and activity |
| Spinner | Win big payouts | Funds prize pool and treasury |
| Donor | Earn tokens from charity | Actual charitable donations occur |
| Collector | Profit from NFT flipping | Rewards creators and previous holders |
| LP Holder | Buy cheap treasury | Burns LP, concentrating liquidity |

## 9) What This Solves (And What It Doesn't)

### Solves
- **Fair distribution** - No advantage to bots or insiders
- **Rug-proof launches** - Liquidity is permanently locked
- **Continuous price discovery** - Dutch auctions find fair prices
- **Aligned incentives** - Everyone benefits from ecosystem growth

### Does Not Solve
- **Price volatility** - Token prices can still swing wildly
- **Guaranteed profits** - Participation doesn't guarantee returns
- **Low activity** - If no one participates, payouts wait
- **Off-chain risks** - Compromised wallets, phishing, etc.

## 10) FAQ

**Q: What do I need to launch a token?**
A: DONUT to seed the initial liquidity pool, plus configuration choices for emission and timing.

**Q: Can the launcher change the rules after launch?**
A: No. Emission rates, halving schedules, and pricing mechanics are immutable once deployed.

**Q: What happens if no one participates?**
A: For MineRig, accrued tokens wait until someone takes the seat. For other rigs, activity simply pauses.

**Q: How is randomness handled?**
A: SlotRig and MineRig (optionally) use Pyth Entropy VRF for provably fair randomness.

**Q: Can liquidity be removed?**
A: No. Initial LP tokens are burned to a dead address. The trading pool exists forever.

**Q: What are the fees?**
A: Varies by rig type, but typically 80% to participants, 15% treasury, 4% team, 1% protocol.

## 11) Glossary

- **Dutch Auction**: A sale where price starts high and decreases until someone buys
- **Emission Rate**: How many tokens are produced per unit of time
- **Epoch**: One cycle of a Dutch auction (price decay period)
- **Halving**: When the emission rate is cut in half at a threshold
- **LP Tokens**: Proof of providing liquidity to a trading pair
- **Rig**: A smart contract that controls token distribution through a specific mechanism
- **Slot**: A position in a MineRig that can be mined
- **Treasury**: Accumulated fees available for purchase via auction
- **Unit**: The ERC20 token created for each launch
- **UPS**: Units Per Second - the emission rate for MineRig
- **VRF**: Verifiable Random Function - provably fair randomness
