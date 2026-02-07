"use client";

import { NavBar } from "@/components/nav-bar";

const INFO_SECTIONS = [
  {
    title: "What is Farplace?",
    content:
      "A launchpad where anyone can create and distribute tokens through gamified mechanisms. No presales, no VCs, no insider allocations.",
    bullets: [
      "Launch in minutes with full customization",
      "Liquidity is locked forever - no rug pulls possible",
      "All tokens paired with USDC for deep liquidity",
      "Three distribution models: Mine, Spin, and Fund",
    ],
  },
  {
    title: "Mine Rigs",
    content:
      "Compete for mining slots via Dutch auction pricing. Hold a slot to earn token emissions over time.",
    bullets: [
      "Pay the current decaying price to claim a mining slot",
      "Price resets higher after each claim, then decays over time",
      "When your slot is taken, you earn 80% of the payment",
      "Emissions halve over time like Bitcoin",
    ],
  },
  {
    title: "Spin Rigs",
    content:
      "Pay a Dutch auction price to spin for a chance to win tokens from a prize pool that grows with emissions.",
    bullets: [
      "Prize pool grows continuously from token emissions",
      "VRF randomness determines your payout percentage",
      "Higher risk, higher reward - payouts range from 0.1% to 80% of the pool",
      "Every spin has a chance at a big win",
    ],
  },
  {
    title: "Fund Rigs",
    content:
      "Donate to a daily pool and claim your proportional share of that day's token emission.",
    bullets: [
      "50% of donations go directly to the recipient",
      "Daily emission is split proportionally among all donors",
      "Claim your tokens after each day ends",
      "Support creators while earning tokens",
    ],
  },
  {
    title: "Why It's Fair",
    content:
      "Dutch auctions flip the script on snipers and bots.",
    bullets: [
      "Price starts HIGH and drops - being first costs the most",
      "Patience beats speed - no advantage to bots",
      "Everyone sees the same price decay in real-time",
    ],
  },
  {
    title: "For Creators",
    content:
      "Full control over your token's economics:",
    bullets: [
      "Set emission rates and halving schedules",
      "Configure auction timing and price curves",
      "Earn 4% of all payments forever",
      "Treasury collects fees for your project's growth",
    ],
  },
];

export default function InfoPage() {
  return (
    <main className="flex h-screen w-screen justify-center bg-zinc-800">
      <div
        className="relative flex h-full w-full max-w-[520px] flex-col bg-background"
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 80px)",
        }}
      >
        {/* Header */}
        <div className="px-4 pb-4">
          <h1 className="text-2xl font-semibold tracking-tight">About</h1>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto scrollbar-hide px-4">
          <div className="space-y-6">
            {INFO_SECTIONS.map((section, index) => (
              <div
                key={index}
                className=""
              >
                <h2 className="font-semibold text-foreground mb-2">
                  {section.title}
                </h2>
                <p className="text-sm text-muted-foreground mb-3">
                  {section.content}
                </p>
                <ul className="space-y-1.5">
                  {section.bullets.map((bullet, i) => (
                    <li
                      key={i}
                      className="text-sm text-muted-foreground flex items-start gap-2"
                    >
                      <span className="text-zinc-500 mt-0.5">•</span>
                      {bullet}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
      <NavBar />
    </main>
  );
}
