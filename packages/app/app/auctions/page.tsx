"use client";

import { useState } from "react";
import { Flame, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NavBar } from "@/components/nav-bar";

// Mock auction data
const MOCK_AUCTIONS = [
  {
    id: "1",
    tokenName: "Donut",
    tokenSymbol: "DONUT",
    lpPrice: 0.45,
    usdcReward: 0.52,
    profit: 0.07,
    color: "from-amber-500 to-orange-600",
  },
  {
    id: "2",
    tokenName: "Moon Token",
    tokenSymbol: "MOON",
    lpPrice: 1.23,
    usdcReward: 1.18,
    profit: -0.05,
    color: "from-purple-500 to-violet-600",
  },
  {
    id: "3",
    tokenName: "Fire Token",
    tokenSymbol: "FIRE",
    lpPrice: 0.12,
    usdcReward: 0.25,
    profit: 0.13,
    color: "from-orange-500 to-red-600",
  },
];

function TokenLogo({ name, color }: { name: string; color: string }) {
  return (
    <div
      className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold bg-gradient-to-br ${color} text-white shadow-lg`}
    >
      {name.charAt(0)}
    </div>
  );
}

export default function AuctionsPage() {
  const [selectedAuction, setSelectedAuction] = useState(MOCK_AUCTIONS[0]);

  return (
    <main className="flex h-screen w-screen justify-center bg-zinc-800">
      <div
        className="relative flex h-full w-full max-w-[520px] flex-col bg-background"
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 180px)",
        }}
      >
        {/* Header */}
        <div className="px-4 pb-4">
          <h1 className="text-2xl font-semibold tracking-tight mb-1">Auctions</h1>
          <p className="text-[13px] text-muted-foreground">
            Trade LP tokens for USDC rewards
          </p>
        </div>

        {/* Auction List */}
        <div className="flex-1 overflow-y-auto scrollbar-hide px-4">
          <div>
            {MOCK_AUCTIONS.map((auction, index) => (
              <button
                key={auction.id}
                onClick={() => setSelectedAuction(auction)}
                className={`w-full py-4 transition-all text-left ${
                  selectedAuction.id === auction.id
                    ? "bg-white/[0.03]"
                    : "hover:bg-white/[0.02]"
                }`}
                style={{
                  borderBottom: index < MOCK_AUCTIONS.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none"
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <TokenLogo name={auction.tokenName} color={auction.color} />
                      {selectedAuction.id === auction.id && (
                        <div className="absolute -right-1 -bottom-1 w-5 h-5 rounded-full bg-white flex items-center justify-center">
                          <Check className="w-3 h-3 text-black" />
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="font-semibold text-[15px]">{auction.tokenSymbol}</div>
                      <div className="text-[13px] text-muted-foreground">
                        {auction.tokenName}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className={`font-medium text-[15px] tabular-nums ${
                        auction.profit >= 0 ? "text-zinc-300" : "text-zinc-500"
                      }`}
                    >
                      {auction.profit >= 0 ? "+" : ""}${Math.abs(auction.profit).toFixed(2)}
                    </div>
                    <div className="text-[13px] text-muted-foreground">profit</div>
                  </div>
                </div>
              </button>
            ))}

            {MOCK_AUCTIONS.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center mb-3">
                  <Flame className="w-6 h-6 opacity-50" />
                </div>
                <p className="text-[15px] font-medium">No auctions available</p>
                <p className="text-[13px] mt-1 opacity-70">Check back later</p>
              </div>
            )}
          </div>
        </div>

        {/* Bottom Action Bar */}
        <div
          className="fixed left-0 right-0 bg-background"
          style={{
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 76px)",
            borderTop: "1px solid rgba(255,255,255,0.06)"
          }}
        >
          <div className="max-w-[520px] mx-auto px-4 py-4">
            {/* Trade Summary */}
            <div className="pb-4 mb-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[12px] text-muted-foreground mb-1">You Pay</div>
                  <div className="flex items-center gap-2">
                    <TokenLogo name={selectedAuction.tokenName} color={selectedAuction.color} />
                    <div>
                      <span className="font-semibold text-[17px] tabular-nums">
                        ${selectedAuction.lpPrice.toFixed(2)}
                      </span>
                      <div className="text-[11px] text-muted-foreground">
                        {selectedAuction.tokenSymbol}-DONUT LP
                      </div>
                    </div>
                  </div>
                </div>
                <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center">
                  <ArrowRight className="w-4 h-4 text-zinc-500" />
                </div>
                <div className="text-right">
                  <div className="text-[12px] text-muted-foreground mb-1">
                    You Receive
                  </div>
                  <div className="font-semibold text-[17px] tabular-nums">
                    ${selectedAuction.usdcReward.toFixed(2)}
                  </div>
                  <div className="text-[11px] text-muted-foreground">USDC</div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div
                className={`text-[15px] font-medium tabular-nums ${
                  selectedAuction.profit >= 0 ? "text-zinc-300" : "text-zinc-500"
                }`}
              >
                {selectedAuction.profit >= 0
                  ? `+$${selectedAuction.profit.toFixed(2)} profit`
                  : `-$${Math.abs(selectedAuction.profit).toFixed(2)} loss`}
              </div>
              <button className="h-10 px-6 bg-white text-black text-[14px] font-semibold rounded-xl hover:bg-zinc-200 transition-colors">
                Buy Auction
              </button>
            </div>
          </div>
        </div>
      </div>
      <NavBar />
    </main>
  );
}
