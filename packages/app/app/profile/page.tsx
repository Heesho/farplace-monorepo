"use client";

import { useState } from "react";
import Link from "next/link";
import { User, Pickaxe, Rocket } from "lucide-react";
import { NavBar } from "@/components/nav-bar";

// Mock user data
const MOCK_USER = {
  name: "vitalik.eth",
  avatar: null,
  totalValue: 1234.56,
  change24h: 5.4,
};

// Mock portfolio holdings
const MOCK_HOLDINGS = [
  {
    address: "0x1234",
    name: "Donut",
    symbol: "DONUT",
    amount: 15000,
    value: 450.5,
    change24h: 12.5,
    color: "from-amber-500 to-orange-600",
  },
  {
    address: "0x2345",
    name: "Moon Token",
    symbol: "MOON",
    amount: 500,
    value: 320.0,
    change24h: -3.2,
    color: "from-purple-500 to-violet-600",
  },
  {
    address: "0x3456",
    name: "Fire Token",
    symbol: "FIRE",
    amount: 10000,
    value: 245.0,
    change24h: 45.8,
    color: "from-orange-500 to-red-600",
  },
];

// Mock launched tokens
const MOCK_LAUNCHED = [
  {
    address: "0x4567",
    name: "My First Token",
    symbol: "MFT",
    marketCap: 12500,
    holders: 34,
    color: "from-blue-500 to-cyan-500",
  },
];

type TabOption = "holdings" | "launched";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);
}

function formatAmount(amount: number): string {
  if (amount >= 1000000) return `${(amount / 1000000).toFixed(2)}M`;
  if (amount >= 1000) return `${(amount / 1000).toFixed(1)}K`;
  return amount.toLocaleString();
}

function TokenLogo({ name, color }: { name: string; color: string }) {
  return (
    <div
      className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold bg-gradient-to-br ${color} text-white`}
    >
      {name.charAt(0)}
    </div>
  );
}

export default function ProfilePage() {
  const [activeTab, setActiveTab] = useState<TabOption>("holdings");

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
          <h1 className="text-2xl font-semibold tracking-tight mb-6">Profile</h1>

          {/* User Info */}
          <div className="flex items-center gap-4 mb-6">
            <div className="w-14 h-14 rounded-full bg-zinc-800 flex items-center justify-center">
              {MOCK_USER.avatar ? (
                <img
                  src={MOCK_USER.avatar}
                  alt={MOCK_USER.name}
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                <User className="w-7 h-7 text-zinc-500" />
              )}
            </div>
            <div>
              <div className="font-semibold text-[17px]">{MOCK_USER.name}</div>
              <div className="text-[13px] text-muted-foreground">
                {MOCK_HOLDINGS.length} tokens held
              </div>
            </div>
          </div>

          {/* Portfolio Value */}
          <div className="mb-6 pb-6 border-b border-white/10">
            <div className="text-[13px] text-muted-foreground mb-1">
              Portfolio Value
            </div>
            <div className="flex items-baseline gap-3">
              <span className="text-[32px] font-semibold tracking-tight tabular-nums">
                {formatCurrency(MOCK_USER.totalValue)}
              </span>
              <span
                className={`text-[14px] tabular-nums ${
                  MOCK_USER.change24h >= 0 ? "text-zinc-400" : "text-zinc-500"
                }`}
              >
                {MOCK_USER.change24h >= 0 ? "+" : ""}
                {MOCK_USER.change24h.toFixed(2)}%
              </span>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab("holdings")}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[13px] font-medium transition-all ${
                activeTab === "holdings"
                  ? "bg-white text-black"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              }`}
            >
              <Pickaxe className="w-3.5 h-3.5" />
              Holdings
            </button>
            <button
              onClick={() => setActiveTab("launched")}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[13px] font-medium transition-all ${
                activeTab === "launched"
                  ? "bg-white text-black"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              }`}
            >
              <Rocket className="w-3.5 h-3.5" />
              Launched
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto scrollbar-hide px-4">
          {activeTab === "holdings" ? (
            <div>
              {MOCK_HOLDINGS.map((holding, index) => (
                <Link
                  key={holding.address}
                  href={`/rig/${holding.address}`}
                  className="grid grid-cols-[auto_1fr_auto] items-center gap-3 py-4 transition-colors hover:bg-white/[0.02]"
                  style={{
                    borderBottom:
                      index < MOCK_HOLDINGS.length - 1
                        ? "1px solid rgba(255,255,255,0.06)"
                        : "none",
                  }}
                >
                  <TokenLogo name={holding.name} color={holding.color} />
                  <div>
                    <div className="font-semibold text-[15px]">{holding.symbol}</div>
                    <div className="text-[13px] text-muted-foreground">
                      {formatAmount(holding.amount)} tokens
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium text-[15px] tabular-nums">
                      {formatCurrency(holding.value)}
                    </div>
                    <div
                      className={`text-[13px] tabular-nums ${
                        holding.change24h >= 0 ? "text-zinc-400" : "text-zinc-500"
                      }`}
                    >
                      {holding.change24h >= 0 ? "+" : ""}
                      {holding.change24h.toFixed(2)}%
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div>
              {MOCK_LAUNCHED.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                  <Rocket className="w-10 h-10 mb-3 opacity-30" />
                  <p className="text-[15px] font-medium">No tokens launched yet</p>
                  <p className="text-[13px] mt-1 opacity-70">
                    Create your first token!
                  </p>
                </div>
              ) : (
                MOCK_LAUNCHED.map((token, index) => (
                  <Link
                    key={token.address}
                    href={`/rig/${token.address}`}
                    className="grid grid-cols-[auto_1fr_auto] items-center gap-3 py-4 transition-colors hover:bg-white/[0.02]"
                    style={{
                      borderBottom:
                        index < MOCK_LAUNCHED.length - 1
                          ? "1px solid rgba(255,255,255,0.06)"
                          : "none",
                    }}
                  >
                    <TokenLogo name={token.name} color={token.color} />
                    <div>
                      <div className="font-semibold text-[15px]">{token.symbol}</div>
                      <div className="text-[13px] text-muted-foreground">
                        {token.name}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium text-[15px] tabular-nums">
                        ${(token.marketCap / 1000).toFixed(1)}K
                      </div>
                      <div className="text-[13px] text-muted-foreground">
                        {token.holders} holders
                      </div>
                    </div>
                  </Link>
                ))
              )}
            </div>
          )}
        </div>
      </div>
      <NavBar />
    </main>
  );
}
