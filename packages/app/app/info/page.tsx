"use client";

import { NavBar } from "@/components/nav-bar";
import { useFarcaster } from "@/hooks/useFarcaster";

const INFO_SECTIONS = [
  {
    title: "Why Mining?",
    content:
      "Mining is the fairest way to distribute tokens. No presales, no VCs, no insider allocations. Just time, commitment, and fair competition.",
    bullets: [
      "Everyone starts equal - no special access",
      "Tokens are earned, not bought in bulk",
      "Distribution happens over time, not all at once",
    ],
  },
  {
    title: "What is Farplace?",
    content:
      "A launchpad where anyone can create their own mineable token. You set the rules - emission rate, halving schedule, auction timing - and let the community mine.",
    bullets: [
      "Launch in minutes with full customization",
      "Liquidity is locked forever - no rug pulls possible",
      "All tokens paired with DONUT for deep liquidity",
    ],
  },
  {
    title: "How It Works",
    content:
      "Each token has a mining rig. One slot, many competitors. Hold the slot to earn emissions.",
    bullets: [
      "Pay to claim the mining slot and start earning tokens",
      "Price resets high after each claim, then decays over time",
      "When someone takes your slot, you get 80% of what they paid",
      "Emissions halve over time like Bitcoin",
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
      "Earn 4% of all mining payments forever",
      "Treasury collects 15% for your project's growth",
    ],
  },
];

export default function InfoPage() {
  const { address } = useFarcaster();

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
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold tracking-tight">About</h1>
            {address && (
              <div className="px-3 py-1.5 rounded-full bg-secondary text-[13px] text-muted-foreground font-mono">
                {address.slice(0, 6)}...{address.slice(-4)}
              </div>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto scrollbar-hide px-4">
          <div className="space-y-6">
            {INFO_SECTIONS.map((section, index) => (
              <div
                key={index}
                className={index < INFO_SECTIONS.length - 1 ? "pb-6 border-b border-white/10" : ""}
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
