"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Share2, Copy } from "lucide-react";
import { NavBar } from "@/components/nav-bar";
import { MineModal } from "@/components/mine-modal";
import { SpinModal } from "@/components/spin-modal";
import { FundModal } from "@/components/fund-modal";
import { TradeModal } from "@/components/trade-modal";
import { AuctionModal } from "@/components/auction-modal";
import { LiquidityModal } from "@/components/liquidity-modal";
import { AdminModal } from "@/components/admin-modal";

type Timeframe = "1H" | "1D" | "1W" | "1M" | "ALL";
type RigType = "mine" | "spin" | "fund";

// Helper to truncate address for display
function truncateAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// Clickable address component
function AddressLink({ address }: { address: string | null }) {
  if (!address) return <span>None</span>;
  return (
    <a
      href={`https://basescan.org/address/${address}`}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:underline hover:text-white transition-colors"
    >
      {truncateAddress(address)}
    </a>
  );
}

// Mock data for different rig types
type MineConfig = {
  rigType: "Mine";
  // Immutable (launch) parameters
  capacity: number;
  initialUps: number;
  tailUps: number;
  halvingAmount: number;
  epochPeriod: number;
  priceMultiplier: number;
  minInitPrice: number;
  // Settable parameters
  treasury: string;
  team: string | null;
  randomnessEnabled: boolean;
  upsMultipliers: number[]; // In 1e18 scale (1e18 = 1x)
  upsMultiplierDuration: number;
};

type SpinConfig = {
  rigType: "Spin";
  // Immutable (launch) parameters
  initialUps: number;
  tailUps: number;
  halvingPeriod: number;
  epochPeriod: number;
  priceMultiplier: number;
  minInitPrice: number;
  // Settable parameters
  treasury: string;
  team: string | null;
  odds: number[];
};

type FundConfig = {
  rigType: "Fund";
  // Immutable (launch) parameters
  initialEmission: number;
  minEmission: number;
  halvingPeriod: number;
  // Settable parameters
  recipient: string | null;
  treasury: string;
  team: string | null;
};

type RigConfig = MineConfig | SpinConfig | FundConfig;

const RIG_DATA: Record<RigType, {
  token: { name: string; symbol: string; price: number; change24h: number; description: string; color: string };
  config: RigConfig;
  stats: { marketCap: number; totalSupply: number; liquidity: number; volume24h: number; treasuryRevenue: number; teamRevenue: number };
  position: { balance: number; balanceUsd: number };
}> = {
  mine: {
    token: {
      name: "Mine Token",
      symbol: "MINE",
      price: 0.00234,
      change24h: 12.5,
      description: "A mining rig token. Compete for mining seats to earn token emissions over time.",
      color: "from-emerald-500 to-green-600",
    },
    config: {
      rigType: "Mine",
      // Immutable
      capacity: 9,
      initialUps: 4.0,
      tailUps: 0.5,
      halvingAmount: 1000000,
      epochPeriod: 3600,
      priceMultiplier: 2.0,
      minInitPrice: 0.01,
      // Settable
      treasury: "0x1234567890123456789012345678901234567890",
      team: "0xabcdef0123456789abcdef0123456789abcdef01",
      randomnessEnabled: true,
      upsMultipliers: [1, 1, 1, 2, 2, 5, 10], // 1x, 1x, 1x, 2x, 2x, 5x, 10x
      upsMultiplierDuration: 86400, // 24 hours
    },
    stats: {
      marketCap: 234000,
      totalSupply: 9993464,
      liquidity: 122.69,
      volume24h: 2.12,
      treasuryRevenue: 45.60,
      teamRevenue: 12.16,
    },
    position: { balance: 154888, balanceUsd: 362.44 },
  },
  spin: {
    token: {
      name: "Spin Token",
      symbol: "SPIN",
      price: 0.0456,
      change24h: 28.3,
      description: "A slot machine rig token. Spin to win from the prize pool with randomized odds.",
      color: "from-purple-500 to-violet-600",
    },
    config: {
      rigType: "Spin",
      // Immutable
      initialUps: 2.0,
      tailUps: 0.25,
      halvingPeriod: 604800, // 7 days
      epochPeriod: 1800,
      priceMultiplier: 1.5,
      minInitPrice: 0.05,
      // Settable
      treasury: "0x1234567890123456789012345678901234567890",
      team: "0xabcdef0123456789abcdef0123456789abcdef01",
      odds: [10, 10, 10, 50, 50, 100, 500, 1000], // basis points (0.1%, 0.5%, 1%, 5%, 10%)
    },
    stats: {
      marketCap: 345000,
      totalSupply: 7564200,
      liquidity: 89.45,
      volume24h: 5.67,
      treasuryRevenue: 78.90,
      teamRevenue: 21.04,
    },
    position: { balance: 45230, balanceUsd: 2062.49 },
  },
  fund: {
    token: {
      name: "Fund Token",
      symbol: "FUND",
      price: 0.0089,
      change24h: 15.7,
      description: "A charity funding rig token. Fund daily to earn token emissions proportional to your contribution.",
      color: "from-sky-500 to-blue-600",
    },
    config: {
      rigType: "Fund",
      // Immutable
      initialEmission: 50000,
      minEmission: 5000,
      halvingPeriod: 2592000, // 30 days
      // Settable
      recipient: "0x9876543210987654321098765432109876543210",
      treasury: "0x1234567890123456789012345678901234567890",
      team: "0xabcdef0123456789abcdef0123456789abcdef01",
    },
    stats: {
      marketCap: 189000,
      totalSupply: 21234567,
      liquidity: 56.78,
      volume24h: 1.23,
      treasuryRevenue: 34.56,
      teamRevenue: 9.22,
    },
    position: { balance: 12456, balanceUsd: 110.86 },
  },
};

// Mock chart data
const MOCK_CHART_DATA = [
  { time: "9:00", price: 0.0021 },
  { time: "10:00", price: 0.00215 },
  { time: "11:00", price: 0.00208 },
  { time: "12:00", price: 0.00225 },
  { time: "13:00", price: 0.00218 },
  { time: "14:00", price: 0.0023 },
  { time: "15:00", price: 0.00228 },
  { time: "16:00", price: 0.00234 },
];

// Mock launcher
const MOCK_LAUNCHER = {
  name: "Heeshilio Frost",
  avatar: "https://api.dicebear.com/7.x/shapes/svg?seed=heesho",
  launchDate: "2d ago",
};

// Mock links
const MOCK_LINKS = {
  tokenAddress: "0x1234...5678",
  lpAddress: "0xabcd...ef01",
};

function formatPrice(price: number): string {
  if (price >= 1) return `$${price.toFixed(2)}`;
  if (price >= 0.01) return `$${price.toFixed(4)}`;
  if (price >= 0.0001) return `$${price.toFixed(6)}`;
  return `$${price.toExponential(2)}`;
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toFixed(2);
}

function formatMarketCap(mcap: number): string {
  if (mcap >= 1_000_000) return `$${(mcap / 1_000_000).toFixed(2)}M`;
  if (mcap >= 1_000) return `$${(mcap / 1_000).toFixed(0)}K`;
  return `$${mcap}`;
}

function TokenLogo({
  name,
  color,
  size = "md",
}: {
  name: string;
  color: string;
  size?: "xs" | "sm" | "md" | "lg";
}) {
  const sizeClasses = {
    xs: "w-4 h-4 text-[8px]",
    sm: "w-5 h-5 text-[9px]",
    md: "w-10 h-10 text-sm",
    lg: "w-12 h-12 text-base",
  };

  return (
    <div
      className={`${sizeClasses[size]} rounded-full flex items-center justify-center font-semibold bg-gradient-to-br ${color} text-white`}
    >
      {name.charAt(0)}
    </div>
  );
}

// Simple chart component
function SimpleChart({
  data,
  isPositive,
}: {
  data: typeof MOCK_CHART_DATA;
  isPositive: boolean;
}) {
  const prices = data.map((d) => d.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;

  const points = data
    .map((d, i) => {
      const x = (i / (data.length - 1)) * 100;
      const y = 100 - ((d.price - min) / range) * 80 - 10;
      return `${x},${y}`;
    })
    .join(" ");

  const fillPoints = `0,100 ${points} 100,100`;

  return (
    <svg
      viewBox="0 0 100 100"
      className="w-full h-full"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
          <stop
            offset="0%"
            stopColor={isPositive ? "hsl(0, 0%, 70%)" : "hsl(0, 0%, 45%)"}
            stopOpacity="0.3"
          />
          <stop
            offset="100%"
            stopColor={isPositive ? "hsl(0, 0%, 70%)" : "hsl(0, 0%, 45%)"}
            stopOpacity="0"
          />
        </linearGradient>
      </defs>
      <polygon fill="url(#chartGradient)" points={fillPoints} />
      <polyline
        fill="none"
        stroke={isPositive ? "hsl(0, 0%, 70%)" : "hsl(0, 0%, 45%)"}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

function getRigTypeFromAddress(address: string): RigType {
  if (address.includes("spin") || address.includes("slot")) return "spin";
  if (address.includes("fund")) return "fund";
  return "mine";
}

export default function RigDetailPage() {
  const params = useParams();
  const address = (params?.address as string) || "";

  const rigType = useMemo(() => getRigTypeFromAddress(address), [address]);
  const rigData = RIG_DATA[rigType];
  const { token, config, stats, position } = rigData;

  const [timeframe, setTimeframe] = useState<Timeframe>("1D");
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [showHeaderPrice, setShowHeaderPrice] = useState(false);
  const [showMineModal, setShowMineModal] = useState(false);
  const [showSpinModal, setShowSpinModal] = useState(false);
  const [showFundModal, setShowFundModal] = useState(false);
  const [showTradeModal, setShowTradeModal] = useState(false);
  const [tradeMode, setTradeMode] = useState<"buy" | "sell">("buy");
  const [showAuctionModal, setShowAuctionModal] = useState(false);
  const [showLiquidityModal, setShowLiquidityModal] = useState(false);
  const [showAdminModal, setShowAdminModal] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const tokenInfoRef = useRef<HTMLDivElement>(null);

  // Mock owner check - in real implementation, compare connected wallet to rig owner
  const isOwner = true; // TODO: Replace with real ownership check

  const isPositive = token.change24h >= 0;
  const hasPosition = position.balance > 0;

  // Primary action - always "Mine" regardless of rig type
  const primaryAction = "Mine";
  const showPrimaryModal = () => {
    if (rigType === "spin") setShowSpinModal(true);
    else if (rigType === "fund") setShowFundModal(true);
    else setShowMineModal(true);
  };

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    const tokenInfo = tokenInfoRef.current;

    if (!scrollContainer || !tokenInfo) return;

    const handleScroll = () => {
      const tokenInfoBottom = tokenInfo.getBoundingClientRect().bottom;
      const containerTop = scrollContainer.getBoundingClientRect().top;
      setShowHeaderPrice(tokenInfoBottom < containerTop + 10);
    };

    scrollContainer.addEventListener("scroll", handleScroll);
    return () => scrollContainer.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <main className="flex h-screen w-screen justify-center bg-zinc-800">
      <div
        className="relative flex h-full w-full max-w-[520px] flex-col bg-background"
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 8px)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 130px)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-2">
          <Link
            href="/explore"
            className="p-2 -ml-2 rounded-xl hover:bg-secondary transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          {/* Center - Price appears on scroll */}
          <div className={`text-center transition-opacity duration-200 ${showHeaderPrice ? "opacity-100" : "opacity-0"}`}>
            <div className="text-[15px] font-semibold">{formatPrice(token.price)}</div>
            <div className="text-[11px] text-muted-foreground">{token.symbol}</div>
          </div>
          <button className="p-2 -mr-2 rounded-xl hover:bg-secondary transition-colors">
            <Share2 className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-4">
          {/* Token Info Section */}
          <div ref={tokenInfoRef} className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <TokenLogo name={token.name} color={token.color} size="lg" />
              <div>
                <div className="text-[13px] text-muted-foreground">{token.symbol}</div>
                <div className="text-[15px] font-medium">{token.name}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="price-large">{formatPrice(token.price)}</div>
              <div
                className={`text-[13px] font-medium ${
                  isPositive ? "text-zinc-300" : "text-zinc-500"
                }`}
              >
                {isPositive ? "+" : ""}
                {token.change24h.toFixed(2)}%
              </div>
            </div>
          </div>

          {/* Chart */}
          <div className="h-44 mb-2 -mx-4">
            <SimpleChart data={MOCK_CHART_DATA} isPositive={isPositive} />
          </div>

          {/* Timeframe Selector */}
          <div className="flex justify-between mb-5 px-2">
            {(["1H", "1D", "1W", "1M", "ALL"] as Timeframe[]).map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-3.5 py-1.5 rounded-lg text-[13px] font-medium transition-all ${
                  timeframe === tf
                    ? "bg-zinc-700 text-white"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          {/* User Position Section */}
          {hasPosition && (
            <div className="mb-6">
              <div className="font-semibold text-[18px] mb-3">Your position</div>
              <div className="grid grid-cols-2 gap-y-4 gap-x-8">
                <div>
                  <div className="text-muted-foreground text-[12px] mb-1">Balance</div>
                  <div className="font-semibold text-[15px] tabular-nums flex items-center gap-1.5">
                    <TokenLogo name={token.name} color={token.color} size="sm" />
                    <span>{formatNumber(position.balance)}</span>
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[12px] mb-1">Value</div>
                  <div className="font-semibold text-[15px] tabular-nums text-white">
                    ${position.balanceUsd.toFixed(2)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Global Stats Grid */}
          <div className="mb-6">
            <div className="font-semibold text-[18px] mb-3">Stats</div>
            <div className="grid grid-cols-2 gap-y-4 gap-x-8">
              <div>
                <div className="text-muted-foreground text-[12px] mb-0.5">Market cap</div>
                <div className="font-semibold text-[15px] tabular-nums">
                  {formatMarketCap(stats.marketCap)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-0.5">Total supply</div>
                <div className="font-semibold text-[15px] tabular-nums">
                  {formatNumber(stats.totalSupply)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-0.5">Liquidity</div>
                <div className="font-semibold text-[15px] tabular-nums">
                  ${stats.liquidity.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-0.5">24h volume</div>
                <div className="font-semibold text-[15px] tabular-nums">
                  ${stats.volume24h.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-0.5">Treasury</div>
                <div className="font-semibold text-[15px] tabular-nums">
                  ${stats.treasuryRevenue.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-0.5">Team</div>
                <div className="font-semibold text-[15px] tabular-nums">
                  ${stats.teamRevenue.toFixed(2)}
                </div>
              </div>
            </div>
          </div>

          {/* About Section */}
          <div className="mb-6">
            <div className="font-semibold text-[18px] mb-3">About</div>

            {/* Deployed by row */}
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground mb-2">
              <span className="text-zinc-400">{config.rigType}</span>
              <span className="text-muted-foreground/60">·</span>
              <span>Deployed by</span>
              <img
                src={MOCK_LAUNCHER.avatar}
                alt={MOCK_LAUNCHER.name}
                className="w-5 h-5 rounded-full object-cover"
              />
              <span className="text-foreground font-medium">{MOCK_LAUNCHER.name}</span>
              <span className="text-muted-foreground/60">·</span>
              <span className="text-muted-foreground/60">{MOCK_LAUNCHER.launchDate}</span>
            </div>

            {/* Description */}
            <p className="text-[13px] text-muted-foreground leading-relaxed mb-2">
              {token.description}
            </p>

            {/* Link buttons */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => navigator.clipboard.writeText(MOCK_LINKS.tokenAddress)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary text-[12px] text-muted-foreground hover:bg-secondary/80 transition-colors"
              >
                {token.symbol}
                <Copy className="w-3 h-3" />
              </button>
              <button
                onClick={() => navigator.clipboard.writeText(MOCK_LINKS.lpAddress)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary text-[12px] text-muted-foreground hover:bg-secondary/80 transition-colors"
              >
                {token.symbol}-DONUT LP
                <Copy className="w-3 h-3" />
              </button>
            </div>

            {/* Parameters - varies by rig type */}
            <div className="grid grid-cols-2 gap-y-3 gap-x-8">
              {config.rigType === "Mine" && (
                <>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Slots</div>
                    <div className="font-medium text-[13px]">{config.capacity}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Initial rate</div>
                    <div className="font-medium text-[13px]">{config.initialUps}/s</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Floor rate</div>
                    <div className="font-medium text-[13px]">{config.tailUps}/s</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Halving at</div>
                    <div className="font-medium text-[13px]">{formatNumber(config.halvingAmount)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Epoch</div>
                    <div className="font-medium text-[13px]">{config.epochPeriod / 3600}h</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Price multiplier</div>
                    <div className="font-medium text-[13px]">{config.priceMultiplier}x</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Min price</div>
                    <div className="font-medium text-[13px]">${config.minInitPrice}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Multiplier duration</div>
                    <div className="font-medium text-[13px]">{config.upsMultiplierDuration / 3600}h</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Treasury</div>
                    <div className="font-medium text-[13px] font-mono"><AddressLink address={config.treasury} /></div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Team</div>
                    <div className="font-medium text-[13px] font-mono"><AddressLink address={config.team} /></div>
                  </div>
                  {config.randomnessEnabled && config.upsMultipliers.length > 0 && (
                    <div className="col-span-2">
                      <div className="text-muted-foreground text-[12px] mb-1.5">Multipliers</div>
                      <div className="flex flex-wrap gap-2">
                        {(() => {
                          // Count occurrences of each multiplier
                          const counts = config.upsMultipliers.reduce((acc, m) => {
                            acc[m] = (acc[m] || 0) + 1;
                            return acc;
                          }, {} as Record<number, number>);
                          const total = config.upsMultipliers.length;
                          // Sort by multiplier value
                          return Object.entries(counts)
                            .sort(([a], [b]) => Number(a) - Number(b))
                            .map(([mult, count]) => {
                              const odds = ((count / total) * 100).toFixed(0);
                              return (
                                <div key={mult} className="px-2.5 py-1 rounded-lg bg-secondary text-[12px]">
                                  <span className="font-medium">{mult}x</span>
                                  <span className="text-muted-foreground ml-1.5">{odds}%</span>
                                </div>
                              );
                            });
                        })()}
                      </div>
                    </div>
                  )}
                </>
              )}
              {config.rigType === "Spin" && (
                <>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Initial rate</div>
                    <div className="font-medium text-[13px]">{config.initialUps}/s</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Floor rate</div>
                    <div className="font-medium text-[13px]">{config.tailUps}/s</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Halving</div>
                    <div className="font-medium text-[13px]">{config.halvingPeriod / 86400}d</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Epoch</div>
                    <div className="font-medium text-[13px]">{config.epochPeriod / 60}m</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Price multiplier</div>
                    <div className="font-medium text-[13px]">{config.priceMultiplier}x</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Min price</div>
                    <div className="font-medium text-[13px]">${config.minInitPrice}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Treasury</div>
                    <div className="font-medium text-[13px] font-mono"><AddressLink address={config.treasury} /></div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Team</div>
                    <div className="font-medium text-[13px] font-mono"><AddressLink address={config.team} /></div>
                  </div>
                  {config.odds.length > 0 && (
                    <div className="col-span-2">
                      <div className="text-muted-foreground text-[12px] mb-1.5">Win Odds</div>
                      <div className="flex flex-wrap gap-2">
                        {(() => {
                          // Count occurrences of each odds value
                          const counts = config.odds.reduce((acc, o) => {
                            acc[o] = (acc[o] || 0) + 1;
                            return acc;
                          }, {} as Record<number, number>);
                          const total = config.odds.length;
                          // Sort by odds value (payout %)
                          return Object.entries(counts)
                            .sort(([a], [b]) => Number(a) - Number(b))
                            .map(([oddsBps, count]) => {
                              const payout = (Number(oddsBps) / 100).toFixed(1);
                              const chance = ((count / total) * 100).toFixed(0);
                              return (
                                <div key={oddsBps} className="px-2.5 py-1 rounded-lg bg-secondary text-[12px]">
                                  <span className="font-medium">{payout}%</span>
                                  <span className="text-muted-foreground ml-1.5">{chance}%</span>
                                </div>
                              );
                            });
                        })()}
                      </div>
                    </div>
                  )}
                </>
              )}
              {config.rigType === "Fund" && (
                <>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Initial emission</div>
                    <div className="font-medium text-[13px]">{formatNumber(config.initialEmission)}/day</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Min emission</div>
                    <div className="font-medium text-[13px]">{formatNumber(config.minEmission)}/day</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Halving</div>
                    <div className="font-medium text-[13px]">{config.halvingPeriod / 86400}d</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Recipient</div>
                    <div className="font-medium text-[13px] font-mono"><AddressLink address={config.recipient} /></div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Treasury</div>
                    <div className="font-medium text-[13px] font-mono"><AddressLink address={config.treasury} /></div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Team</div>
                    <div className="font-medium text-[13px] font-mono"><AddressLink address={config.team} /></div>
                  </div>
                </>
              )}
            </div>
          </div>

        </div>

        {/* Darkened overlay when menu is open */}
        {showActionMenu && (
          <div
            className="fixed inset-0 z-40 flex justify-center"
            style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 60px)" }}
            onClick={() => setShowActionMenu(false)}
          >
            <div className="w-full max-w-[520px] h-full bg-black/50" />
          </div>
        )}

        {/* Bottom Action Bar */}
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-zinc-800 flex justify-center" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 60px)" }}>
          <div className="flex items-center justify-between w-full max-w-[520px] px-4 py-3 bg-background">
            <div>
              <div className="text-muted-foreground text-[12px]">Market Cap</div>
              <div className="font-semibold text-[17px] tabular-nums">
                {formatMarketCap(stats.marketCap)}
              </div>
            </div>
            <div className="relative">
              {/* Action Menu Popup - appears above button */}
              {showActionMenu && (
                <div className="absolute bottom-full right-0 mb-2 flex flex-col gap-1.5">
                  <button
                    onClick={() => {
                      setShowActionMenu(false);
                      setTradeMode("buy");
                      setShowTradeModal(true);
                    }}
                    className="w-32 py-2.5 rounded-xl bg-white hover:bg-zinc-200 text-black font-semibold text-[14px] transition-colors"
                  >
                    Buy
                  </button>
                  <button
                    onClick={() => {
                      setShowActionMenu(false);
                      setTradeMode("sell");
                      setShowTradeModal(true);
                    }}
                    className="w-32 py-2.5 rounded-xl bg-white hover:bg-zinc-200 text-black font-semibold text-[14px] transition-colors"
                  >
                    Sell
                  </button>
                  <button
                    onClick={() => {
                      setShowActionMenu(false);
                      showPrimaryModal();
                    }}
                    className="w-32 py-2.5 rounded-xl bg-white hover:bg-zinc-200 text-black font-semibold text-[14px] transition-colors"
                  >
                    {primaryAction}
                  </button>
                  <button
                    onClick={() => {
                      setShowActionMenu(false);
                      setShowAuctionModal(true);
                    }}
                    className="w-32 py-2.5 rounded-xl bg-white hover:bg-zinc-200 text-black font-semibold text-[14px] transition-colors"
                  >
                    Auction
                  </button>
                  <button
                    onClick={() => {
                      setShowActionMenu(false);
                      setShowLiquidityModal(true);
                    }}
                    className="w-32 py-2.5 rounded-xl bg-white hover:bg-zinc-200 text-black font-semibold text-[14px] transition-colors"
                  >
                    Liquidity
                  </button>
                  {isOwner && (
                    <button
                      onClick={() => {
                        setShowActionMenu(false);
                        setShowAdminModal(true);
                      }}
                      className="w-32 py-2.5 rounded-xl bg-white hover:bg-zinc-200 text-black font-semibold text-[14px] transition-colors"
                    >
                      Admin
                    </button>
                  )}
                </div>
              )}
              <button
                onClick={() => setShowActionMenu(!showActionMenu)}
                className={`w-32 h-10 text-[14px] font-semibold rounded-xl transition-all ${
                  showActionMenu
                    ? "bg-black border-2 border-white text-white"
                    : "bg-white text-black"
                }`}
              >
                {showActionMenu ? "✕" : "Actions"}
              </button>
            </div>
          </div>
        </div>
      </div>
      <NavBar />

      {/* Mine Modal */}
      <MineModal
        isOpen={showMineModal}
        onClose={() => setShowMineModal(false)}
        tokenSymbol={token.symbol}
        tokenName={token.name}
        userBalance={45.73}
      />

      {/* Spin Modal */}
      <SpinModal
        isOpen={showSpinModal}
        onClose={() => setShowSpinModal(false)}
        tokenSymbol={token.symbol}
        tokenName={token.name}
        userBalance={45.73}
      />

      {/* Fund Modal */}
      <FundModal
        isOpen={showFundModal}
        onClose={() => setShowFundModal(false)}
        tokenSymbol={token.symbol}
        tokenName={token.name}
        userBalance={45.73}
      />

      {/* Trade Modal (Buy/Sell) */}
      <TradeModal
        isOpen={showTradeModal}
        onClose={() => setShowTradeModal(false)}
        mode={tradeMode}
        tokenSymbol={token.symbol}
        tokenName={token.name}
        marketPrice={token.price}
        userBalance={tradeMode === "buy" ? 45.73 : position.balance}
        priceImpact={0.5}
      />

      {/* Auction Modal */}
      <AuctionModal
        isOpen={showAuctionModal}
        onClose={() => setShowAuctionModal(false)}
        tokenSymbol={token.symbol}
        tokenName={token.name}
      />

      {/* Liquidity Modal */}
      <LiquidityModal
        isOpen={showLiquidityModal}
        onClose={() => setShowLiquidityModal(false)}
        tokenSymbol={token.symbol}
        tokenName={token.name}
        tokenBalance={position.balance}
        donutBalance={1186.38}
        tokenPrice={token.price}
        donutPrice={0.001}
      />

      {/* Admin Modal */}
      <AdminModal
        isOpen={showAdminModal}
        onClose={() => setShowAdminModal(false)}
        rigType={rigType}
        tokenSymbol={token.symbol}
        tokenName={token.name}
        currentConfig={{
          treasury: config.treasury,
          team: config.team,
          uri: "", // Not in mock data yet
          ...(config.rigType === "Mine" && {
            capacity: config.capacity,
            randomnessEnabled: config.randomnessEnabled,
            upsMultipliers: config.upsMultipliers,
            upsMultiplierDuration: config.upsMultiplierDuration,
          }),
          ...(config.rigType === "Spin" && {
            odds: config.odds,
          }),
          ...(config.rigType === "Fund" && {
            recipient: config.recipient,
          }),
        }}
      />

    </main>
  );
}
