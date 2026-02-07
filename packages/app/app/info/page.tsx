"use client";

import { NavBar } from "@/components/nav-bar";

const INFO_SECTIONS = [
  {
    title: "What is Farplace?",
    content:
      "A fair-launch token platform on Base. No presales, no insiders, no rugs. Tokens are earned through games — not bought from a team.",
    bullets: [
      "Liquidity is locked forever — LP tokens are burned on launch",
      "All contracts are immutable — nobody can change the rules",
      "Three ways to earn: Mine, Spin, and Fund",
    ],
  },
  {
    title: "How Mining Works",
    content:
      "Claim a mining slot and earn token emissions for as long as you hold it. If someone takes your slot, you walk away with 80% of what they paid.",
    bullets: [
      "Slot prices decay over time — wait longer, pay less",
      "Each purchase resets the price higher, then it decays again",
      "Emissions halve over time (like Bitcoin) with a guaranteed floor",
      "Random VRF multipliers (up to 10x) can boost your earnings",
    ],
  },
  {
    title: "How Spinning Works",
    content:
      "The prize pool fills up with token emissions over time — whether or not anyone is playing. Pay to spin and win a random percentage of the pool.",
    bullets: [
      "Payouts are determined by on-chain VRF — fully random, fully verifiable",
      "The pool never fully drains — it keeps compounding between spins",
      "Spin price decays over time, so patience pays off here too",
    ],
  },
  {
    title: "How Funding Works",
    content:
      "Donate to a creator or cause and earn tokens in return. Each day's token emission is split among donors based on how much they contributed.",
    bullets: [
      "50% of every donation goes straight to the recipient",
      "Your share of that day's emission matches your share of donations",
      "Emissions halve on a schedule but never drop below a set floor",
    ],
  },
  {
    title: "Why It's Fair",
    content:
      "Prices start high and drop over time (Dutch auction). Being first costs the most — not the least. Bots and snipers have no edge.",
    bullets: [
      "Everyone sees the same decaying price in real-time",
      "No hidden allocations or team tokens",
      "Treasury fees are auctioned off for LP tokens, which get burned — permanently deepening liquidity",
    ],
  },
  {
    title: "For Launchers",
    content:
      "Launch a token with your own emission schedule, pricing curves, and game mechanics. Everything is configured at launch and locked forever.",
    bullets: [
      "Set your own halvings, emission rates, and epoch durations",
      "Earn 4% of all activity on your rig as the team fee",
      "Treasury accumulates fees that get auctioned to grow your liquidity",
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
