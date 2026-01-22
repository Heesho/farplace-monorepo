"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Search, Zap, Clock, Star, X } from "lucide-react";
import { NavBar } from "@/components/nav-bar";

// Pre-generated sparkline data (deterministic to avoid hydration mismatch)
const SPARKLINES = {
  up1: [30, 35, 32, 40, 38, 45, 42, 50, 48, 55, 52, 58, 55, 62, 60, 65, 63, 70, 68, 75],
  up2: [25, 28, 35, 30, 42, 38, 45, 50, 48, 55, 60, 58, 65, 62, 70, 72, 75, 78, 80, 85],
  up3: [40, 38, 45, 42, 48, 52, 50, 55, 58, 60, 62, 65, 68, 70, 72, 75, 78, 80, 82, 88],
  up4: [20, 25, 22, 30, 28, 35, 40, 38, 45, 50, 55, 52, 60, 65, 62, 70, 75, 78, 82, 90],
  up5: [35, 40, 38, 42, 45, 48, 50, 52, 55, 58, 60, 62, 65, 68, 70, 72, 75, 78, 80, 82],
  down1: [75, 70, 72, 65, 68, 60, 62, 55, 58, 50, 52, 45, 48, 40, 42, 35, 38, 30, 32, 25],
  down2: [80, 78, 75, 72, 70, 68, 65, 62, 60, 58, 55, 52, 50, 48, 45, 42, 40, 38, 35, 30],
  down3: [70, 72, 68, 65, 62, 60, 58, 55, 52, 50, 48, 45, 42, 40, 38, 35, 32, 30, 28, 22],
  down4: [85, 82, 80, 78, 75, 72, 70, 68, 65, 60, 58, 55, 50, 48, 45, 40, 38, 35, 30, 20],
  down5: [65, 68, 62, 60, 58, 55, 52, 50, 48, 45, 42, 40, 38, 35, 32, 30, 28, 25, 22, 18],
};

// Mock data for coins
const INITIAL_COINS = [
  // Demo tokens for each rig type (at top for easy testing)
  { address: "0xmine", name: "[Mine Rig Demo]", symbol: "MINE", price: 0.00234, change24h: 12.5, marketCap: 234000, color: "from-emerald-500 to-green-600", sparkline: SPARKLINES.up1, lastBumped: 100000 },
  { address: "0xcontentc", name: "[Content Rig Demo]", symbol: "CONTENT", price: 0.0567, change24h: 34.2, marketCap: 456000, color: "from-pink-500 to-purple-600", sparkline: SPARKLINES.up4, lastBumped: 99000 },
  // Regular tokens
  { address: "0x1234", name: "Donut", symbol: "DONUT", price: 0.00234, change24h: 12.5, marketCap: 234000, color: "from-amber-500 to-orange-600", sparkline: SPARKLINES.up1, lastBumped: 1000 },
  { address: "0x2345", name: "PepeCoin", symbol: "PEPE", price: 0.00000123, change24h: -5.2, marketCap: 89000, color: "from-green-500 to-emerald-600", sparkline: SPARKLINES.down1, lastBumped: 2000 },
  { address: "0x3456", name: "Moon Token", symbol: "MOON", price: 0.0456, change24h: 45.8, marketCap: 567000, color: "from-purple-500 to-violet-600", sparkline: SPARKLINES.up2, lastBumped: 3000 },
  { address: "0x4567", name: "Rocket Finance", symbol: "RCKT", price: 1.23, change24h: 8.3, marketCap: 1200000, color: "from-red-500 to-rose-600", sparkline: SPARKLINES.up3, lastBumped: 4000 },
  { address: "0x5678", name: "Diamond Hands", symbol: "DMND", price: 0.089, change24h: -12.4, marketCap: 45000, color: "from-cyan-500 to-blue-600", sparkline: SPARKLINES.down2, lastBumped: 5000 },
  { address: "0x6789", name: "Ape Coin", symbol: "APE", price: 2.34, change24h: 3.2, marketCap: 890000, color: "from-amber-600 to-yellow-500", sparkline: SPARKLINES.up4, lastBumped: 6000 },
  { address: "0x7890", name: "Fire Token", symbol: "FIRE", price: 0.0067, change24h: 156.7, marketCap: 123000, color: "from-orange-500 to-red-600", sparkline: SPARKLINES.up5, lastBumped: 7000 },
  { address: "0x8901", name: "Aqua", symbol: "AQUA", price: 0.00089, change24h: -2.1, marketCap: 34000, color: "from-blue-400 to-cyan-500", sparkline: SPARKLINES.down3, lastBumped: 8000 },
  { address: "0x9012", name: "Galaxy", symbol: "GLXY", price: 0.0145, change24h: 23.4, marketCap: 456000, color: "from-indigo-500 to-purple-600", sparkline: SPARKLINES.up1, lastBumped: 9000 },
  { address: "0x0123", name: "Thunder", symbol: "THND", price: 0.0089, change24h: -8.7, marketCap: 78000, color: "from-yellow-400 to-amber-500", sparkline: SPARKLINES.down4, lastBumped: 10000 },
  { address: "0x1235", name: "Stellar Coin", symbol: "STLR", price: 0.234, change24h: 5.6, marketCap: 345000, color: "from-sky-400 to-blue-500", sparkline: SPARKLINES.up2, lastBumped: 11000 },
  { address: "0x2346", name: "Phoenix", symbol: "PHNX", price: 0.567, change24h: 67.8, marketCap: 890000, color: "from-orange-400 to-red-500", sparkline: SPARKLINES.up3, lastBumped: 12000 },
  { address: "0x3457", name: "Nebula", symbol: "NBLA", price: 0.0034, change24h: -15.2, marketCap: 23000, color: "from-pink-500 to-rose-600", sparkline: SPARKLINES.down5, lastBumped: 13000 },
  { address: "0x4568", name: "Cosmos", symbol: "CSMS", price: 1.89, change24h: 12.3, marketCap: 1500000, color: "from-violet-500 to-purple-600", sparkline: SPARKLINES.up4, lastBumped: 14000 },
  { address: "0x5679", name: "Infinity Token", symbol: "INFT", price: 0.00456, change24h: -3.4, marketCap: 67000, color: "from-teal-400 to-emerald-500", sparkline: SPARKLINES.down1, lastBumped: 15000 },
  { address: "0x6780", name: "Blaze", symbol: "BLZE", price: 0.078, change24h: 89.5, marketCap: 234000, color: "from-red-400 to-orange-500", sparkline: SPARKLINES.up5, lastBumped: 16000 },
  { address: "0x7891", name: "Frost", symbol: "FRST", price: 0.0123, change24h: -6.7, marketCap: 45000, color: "from-cyan-300 to-blue-400", sparkline: SPARKLINES.down2, lastBumped: 17000 },
  { address: "0x8902", name: "Shadow", symbol: "SHDW", price: 0.345, change24h: 4.5, marketCap: 567000, color: "from-gray-600 to-zinc-700", sparkline: SPARKLINES.up1, lastBumped: 18000 },
  { address: "0x9013", name: "Solar", symbol: "SOLR", price: 2.34, change24h: 34.5, marketCap: 2300000, color: "from-yellow-500 to-orange-500", sparkline: SPARKLINES.up2, lastBumped: 19000 },
  { address: "0xa001", name: "Cyber", symbol: "CYBR", price: 0.456, change24h: 22.1, marketCap: 678000, color: "from-fuchsia-500 to-pink-600", sparkline: SPARKLINES.up3, lastBumped: 20000 },
  { address: "0xa002", name: "Neon", symbol: "NEON", price: 0.0234, change24h: -4.5, marketCap: 123000, color: "from-lime-400 to-green-500", sparkline: SPARKLINES.down3, lastBumped: 21000 },
  { address: "0xa003", name: "Quantum", symbol: "QNTM", price: 3.45, change24h: 18.9, marketCap: 3400000, color: "from-blue-600 to-indigo-700", sparkline: SPARKLINES.up4, lastBumped: 22000 },
  { address: "0xa004", name: "Vortex", symbol: "VRTX", price: 0.0078, change24h: -9.8, marketCap: 56000, color: "from-purple-400 to-violet-500", sparkline: SPARKLINES.down4, lastBumped: 23000 },
  { address: "0xa005", name: "Titan", symbol: "TITAN", price: 1.56, change24h: 7.2, marketCap: 890000, color: "from-slate-500 to-gray-600", sparkline: SPARKLINES.up5, lastBumped: 24000 },
  { address: "0xa006", name: "Echo", symbol: "ECHO", price: 0.089, change24h: -1.3, marketCap: 234000, color: "from-emerald-400 to-teal-500", sparkline: SPARKLINES.down5, lastBumped: 25000 },
  { address: "0xa007", name: "Pulse", symbol: "PULSE", price: 0.567, change24h: 45.6, marketCap: 567000, color: "from-rose-500 to-red-600", sparkline: SPARKLINES.up1, lastBumped: 26000 },
  { address: "0xa008", name: "Nova", symbol: "NOVA", price: 0.0345, change24h: 28.4, marketCap: 345000, color: "from-amber-400 to-yellow-500", sparkline: SPARKLINES.up2, lastBumped: 27000 },
  { address: "0xa009", name: "Drift", symbol: "DRFT", price: 0.00234, change24h: -7.6, marketCap: 78000, color: "from-sky-500 to-cyan-600", sparkline: SPARKLINES.down1, lastBumped: 28000 },
  { address: "0xa010", name: "Zenith", symbol: "ZNTH", price: 4.56, change24h: 12.8, marketCap: 4500000, color: "from-violet-600 to-purple-700", sparkline: SPARKLINES.up3, lastBumped: 29000 },
  { address: "0xa011", name: "Mystic", symbol: "MYST", price: 0.123, change24h: -11.2, marketCap: 189000, color: "from-indigo-400 to-blue-500", sparkline: SPARKLINES.down2, lastBumped: 30000 },
];

type SortOption = "bump" | "newest" | "top";
type Coin = typeof INITIAL_COINS[number];

function formatMarketCap(mcap: number): string {
  if (mcap >= 1_000_000) return `$${(mcap / 1_000_000).toFixed(2)}M`;
  if (mcap >= 1_000) return `$${(mcap / 1_000).toFixed(0)}K`;
  return `$${mcap}`;
}

function TokenLogo({ name, color }: { name: string; color: string }) {
  return (
    <div
      className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold bg-gradient-to-br ${color} text-white shadow-lg`}
    >
      {name.charAt(0)}
    </div>
  );
}

function Sparkline({ data, isPositive }: { data: number[]; isPositive: boolean }) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data
    .map((value, i) => {
      const x = (i / (data.length - 1)) * 100;
      const y = 100 - ((value - min) / range) * 100;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      viewBox="0 0 100 100"
      className="w-16 h-8"
      preserveAspectRatio="none"
    >
      <polyline
        fill="none"
        stroke={isPositive ? "#a1a1aa" : "#52525b"}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

export default function ExplorePage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("bump");
  const [coins, setCoins] = useState<Coin[]>(INITIAL_COINS);
  const [bumpedCoin, setBumpedCoin] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Simulate random bumps for demo
  useEffect(() => {
    if (sortBy !== "bump") return;

    const interval = setInterval(() => {
      setCoins((prevCoins) => {
        // Pick a random coin that's not already #1
        const notFirst = prevCoins.slice(1);
        if (notFirst.length === 0) return prevCoins;

        const randomIndex = Math.floor(Math.random() * notFirst.length);
        const coinToBump = notFirst[randomIndex];

        // Update the lastBumped timestamp
        const updatedCoins = prevCoins.map((c) =>
          c.address === coinToBump.address
            ? { ...c, lastBumped: Date.now() }
            : c
        );

        // Sort by lastBumped (most recent first)
        const sorted = [...updatedCoins].sort((a, b) => b.lastBumped - a.lastBumped);

        // Trigger animation
        setBumpedCoin(coinToBump.address);
        setTimeout(() => setBumpedCoin(null), 600);

        return sorted;
      });
    }, 3000); // Bump every 3 seconds

    return () => clearInterval(interval);
  }, [sortBy]);

  // Sort coins based on selected option
  const sortedCoins = [...coins].sort((a, b) => {
    if (sortBy === "bump") return b.lastBumped - a.lastBumped;
    if (sortBy === "newest") return 0; // Would sort by creation date
    if (sortBy === "top") return b.marketCap - a.marketCap;
    return 0;
  });

  const filteredCoins = sortedCoins.filter(
    (coin) =>
      coin.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      coin.symbol.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
        <div className="px-4 pb-2">
          <h1 className="text-2xl font-semibold tracking-tight mb-4">Explore</h1>

          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-muted-foreground" />
            <input
              type="text"
              placeholder="Search tokens..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-11 pl-10 pr-10 rounded-xl bg-secondary text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-white/20 text-[15px] transition-shadow"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-muted transition-colors"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            )}
          </div>

          {/* Sort Tabs */}
          <div className="flex gap-2 mt-3">
            {[
              { key: "bump" as const, label: "Bump", icon: Zap },
              { key: "newest" as const, label: "New", icon: Clock },
              { key: "top" as const, label: "Top", icon: Star },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setSortBy(tab.key)}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[13px] font-medium transition-all ${
                  sortBy === tab.key
                    ? "bg-white text-black"
                    : "bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/80"
                }`}
              >
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Coin List */}
        <div ref={listRef} className="flex-1 overflow-y-auto scrollbar-hide px-4 pt-2">
          <div>
            {filteredCoins.map((coin, index) => {
              const isBumped = bumpedCoin === coin.address;
              const isFirstAndBumped = index === 0 && isBumped;

              return (
              <Link
                key={coin.address}
                href={`/rig/${coin.address}`}
                className={`grid grid-cols-[auto_1fr_auto] items-center gap-3 py-4 transition-all duration-300 hover:bg-white/[0.02] ${
                  isFirstAndBumped ? "animate-bump-in bg-white/[0.05]" : ""
                } ${!isFirstAndBumped && isBumped ? "animate-slide-down" : ""}`}
                style={{
                  borderBottom: index < filteredCoins.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none'
                }}
              >
                {/* Left side - Logo, Symbol, Name */}
                <div className="flex items-center gap-3">
                  <TokenLogo name={coin.name} color={coin.color} />
                  <div>
                    <div className="font-semibold text-[15px]">
                      {coin.symbol.length > 6 ? `${coin.symbol.slice(0, 6)}...` : coin.symbol}
                    </div>
                    <div className="text-[13px] text-muted-foreground">
                      {coin.name.length > 12 ? `${coin.name.slice(0, 12)}...` : coin.name}
                    </div>
                  </div>
                </div>

                {/* Middle - Sparkline (centered) */}
                <div className="flex justify-center">
                  <Sparkline data={coin.sparkline} isPositive={coin.change24h >= 0} />
                </div>

                {/* Right side - Market cap and change */}
                <div className="text-right">
                  <div className="font-medium text-[15px] tabular-nums">
                    {formatMarketCap(coin.marketCap)}
                  </div>
                  <div
                    className={`text-[13px] tabular-nums ${
                      coin.change24h >= 0 ? "text-zinc-400" : "text-zinc-500"
                    }`}
                  >
                    {coin.change24h >= 0 ? "+" : ""}
                    {coin.change24h.toFixed(2)}%
                  </div>
                </div>
              </Link>
              );
            })}
          </div>

          {filteredCoins.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Search className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-[15px] font-medium">No tokens found</p>
              <p className="text-[13px] mt-1 opacity-70">Try a different search term</p>
            </div>
          )}
        </div>
      </div>
      <NavBar />
    </main>
  );
}
