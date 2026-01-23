"use client";

import { useState, useRef, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Share2, Copy, Check } from "lucide-react";
import { NavBar } from "@/components/nav-bar";
import { MineModal } from "@/components/mine-modal";
import { TradeModal } from "@/components/trade-modal";
import { AuctionModal } from "@/components/auction-modal";
import { LiquidityModal } from "@/components/liquidity-modal";
import { SpinModal } from "@/components/spin-modal";
// import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
// import { useFriendActivity, getFriendActivityMessage } from "@/hooks/useFriendActivity";

type Timeframe = "1H" | "1D" | "1W" | "1M" | "ALL";

// Mock token data (will be replaced with real data later)
const MOCK_TOKEN = {
  name: "Donut",
  symbol: "DONUT",
  price: 0.00234,
  change24h: 12.5,
  description: "The original donut token. Mine it, earn it, love it.",
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

// Mock user position
const MOCK_USER_POSITION = {
  balance: 154888,
  balanceUsd: 1.89,
  totalMined: 183464,
  totalMinedUsd: 2.24,
  spent: 564.68,
  earned: 267.52,
};

// Mock global stats
const MOCK_GLOBAL_STATS = {
  marketCap: 123.00,
  totalSupply: 9993464,
  liquidity: 122.69,
  volume24h: 2.12,
  treasuryRevenue: 45.60,
  teamRevenue: 12.16,
  totalMinted: 2450000,
  miningSlots: 4,
  emissionRate: 4.0, // current UPS
};

// Mock launcher
const MOCK_LAUNCHER = {
  name: "Heeshilio Frost",
  avatar: "https://api.dicebear.com/7.x/shapes/svg?seed=heesho",
  launchDate: "2d ago",
};

// Mock rig configs for different rig types
const MINE_RIG_CONFIG = {
  rigType: "Mine Rig",
  initialUps: 4.0,
  tailUps: 0.5,
  halvingAmount: 1000000,
  capacity: 9,
  epochPeriod: 3600,
  priceMultiplier: 2.0,
  minInitPrice: 0.01,
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

function TokenLogo({
  name,
  size = "md",
}: {
  name: string;
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
      className={`${sizeClasses[size]} rounded-full flex items-center justify-center font-semibold bg-gradient-to-br from-amber-500 to-orange-600 text-white`}
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

export default function RigDetailPage() {
  useParams(); // Keep for Next.js routing
  const MOCK_RIG_CONFIG = MINE_RIG_CONFIG;

  const [timeframe, setTimeframe] = useState<Timeframe>("1D");
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [showHeaderPrice, setShowHeaderPrice] = useState(false);
  const [showMineModal, setShowMineModal] = useState(false);
  const [showTradeModal, setShowTradeModal] = useState(false);
  const [tradeMode, setTradeMode] = useState<"buy" | "sell">("buy");
  const [showAuctionModal, setShowAuctionModal] = useState(false);
  const [showLiquidityModal, setShowLiquidityModal] = useState(false);
  const [showSpinModal, setShowSpinModal] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const tokenInfoRef = useRef<HTMLDivElement>(null);


  const isPositive = MOCK_TOKEN.change24h >= 0;
  const hasPosition = MOCK_USER_POSITION.balance > 0;

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
            <div className="text-[15px] font-semibold">{formatPrice(MOCK_TOKEN.price)}</div>
            <div className="text-[11px] text-muted-foreground">{MOCK_TOKEN.symbol}</div>
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
              <TokenLogo name={MOCK_TOKEN.name} size="lg" />
              <div>
                <div className="text-[13px] text-muted-foreground">{MOCK_TOKEN.symbol}</div>
                <div className="text-[15px] font-medium">{MOCK_TOKEN.name}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="price-large">{formatPrice(MOCK_TOKEN.price)}</div>
              <div
                className={`text-[13px] font-medium ${
                  isPositive ? "text-zinc-300" : "text-zinc-500"
                }`}
              >
                {isPositive ? "+" : ""}
                {MOCK_TOKEN.change24h.toFixed(2)}%
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
                    <TokenLogo name={MOCK_TOKEN.name} size="sm" />
                    <span>{formatNumber(MOCK_USER_POSITION.balance)}</span>
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[12px] mb-1">Value</div>
                  <div className="font-semibold text-[15px] tabular-nums text-white">
                    ${MOCK_USER_POSITION.balanceUsd.toFixed(2)}
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
                  ${MOCK_GLOBAL_STATS.marketCap.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-0.5">Total supply</div>
                <div className="font-semibold text-[15px] tabular-nums">
                  {formatNumber(MOCK_GLOBAL_STATS.totalSupply)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-0.5">Liquidity</div>
                <div className="font-semibold text-[15px] tabular-nums">
                  ${MOCK_GLOBAL_STATS.liquidity.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-0.5">24h volume</div>
                <div className="font-semibold text-[15px] tabular-nums">
                  ${MOCK_GLOBAL_STATS.volume24h.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-0.5">Treasury</div>
                <div className="font-semibold text-[15px] tabular-nums">
                  ${MOCK_GLOBAL_STATS.treasuryRevenue.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-0.5">Team</div>
                <div className="font-semibold text-[15px] tabular-nums">
                  ${MOCK_GLOBAL_STATS.teamRevenue.toFixed(2)}
                </div>
              </div>
            </div>
          </div>

          {/* About Section */}
          <div className="mb-6">
            <div className="font-semibold text-[18px] mb-3">About</div>

            {/* Deployed by row with rig type badge on right */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <span>Deployed by</span>
                <img
                  src={MOCK_LAUNCHER.avatar}
                  alt={MOCK_LAUNCHER.name}
                  className="w-5 h-5 rounded-full object-cover"
                />
                <span className="text-foreground font-medium">{MOCK_LAUNCHER.name}</span>
                <span className="text-muted-foreground/60">{MOCK_LAUNCHER.launchDate}</span>
              </div>
              <span className="text-[12px] font-medium text-zinc-300 bg-zinc-700 px-2 py-1 rounded">
                {MOCK_RIG_CONFIG.rigType}
              </span>
            </div>

            {/* Description */}
            <p className="text-[13px] text-muted-foreground leading-relaxed mb-2">
              {MOCK_TOKEN.description}
            </p>

            {/* Link buttons */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => navigator.clipboard.writeText(MOCK_LINKS.tokenAddress)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary text-[12px] text-muted-foreground hover:bg-secondary/80 transition-colors"
              >
                {MOCK_TOKEN.symbol}
                <Copy className="w-3 h-3" />
              </button>
              <button
                onClick={() => navigator.clipboard.writeText(MOCK_LINKS.lpAddress)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary text-[12px] text-muted-foreground hover:bg-secondary/80 transition-colors"
              >
                {MOCK_TOKEN.symbol}-DONUT LP
                <Copy className="w-3 h-3" />
              </button>
            </div>

            {/* Launch parameters */}
            <div className="grid grid-cols-2 gap-y-3 gap-x-8">
              <div>
                <div className="text-muted-foreground text-[12px] mb-0.5">Slots</div>
                <div className="font-medium text-[13px]">{MOCK_RIG_CONFIG.capacity}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-0.5">Initial rate</div>
                <div className="font-medium text-[13px]">{MOCK_RIG_CONFIG.initialUps}/s</div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-0.5">Floor rate</div>
                <div className="font-medium text-[13px]">{MOCK_RIG_CONFIG.tailUps}/s</div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-0.5">Halving at</div>
                <div className="font-medium text-[13px]">{formatNumber(MOCK_RIG_CONFIG.halvingAmount)}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-0.5">Epoch</div>
                <div className="font-medium text-[13px]">{MOCK_RIG_CONFIG.epochPeriod / 3600}h</div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-0.5">Price multiplier</div>
                <div className="font-medium text-[13px]">{MOCK_RIG_CONFIG.priceMultiplier}x</div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-0.5">Min price</div>
                <div className="font-medium text-[13px]">${MOCK_RIG_CONFIG.minInitPrice}</div>
              </div>
            </div>
          </div>

        </div>

        {/* Darkened overlay when menu is open */}
        {showActionMenu && (
          <div
            className="fixed inset-0 bg-black/70 z-40"
            style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 60px)" }}
            onClick={() => setShowActionMenu(false)}
          />
        )}

        {/* Bottom Action Bar */}
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-background flex justify-center" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 60px)" }}>
          <div className="flex items-center justify-between w-full max-w-[520px] px-4 py-3">
            <div>
              <div className="text-muted-foreground text-[12px]">Market Cap</div>
              <div className="font-semibold text-[17px] tabular-nums">
                ${MOCK_GLOBAL_STATS.marketCap.toFixed(2)}
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
                      setShowMineModal(true);
                    }}
                    className="w-32 py-2.5 rounded-xl bg-white hover:bg-zinc-200 text-black font-semibold text-[14px] transition-colors"
                  >
                    Mine
                  </button>
                  <button
                    onClick={() => {
                      setShowActionMenu(false);
                      setShowSpinModal(true);
                    }}
                    className="w-32 py-2.5 rounded-xl bg-white hover:bg-zinc-200 text-black font-semibold text-[14px] transition-colors"
                  >
                    Spin
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
        tokenSymbol={MOCK_TOKEN.symbol}
        userBalance={12.45}
      />

      {/* Trade Modal (Buy/Sell) */}
      <TradeModal
        isOpen={showTradeModal}
        onClose={() => setShowTradeModal(false)}
        mode={tradeMode}
        tokenSymbol={MOCK_TOKEN.symbol}
        tokenName={MOCK_TOKEN.name}
        marketPrice={MOCK_TOKEN.price}
        userBalance={tradeMode === "buy" ? 45.73 : MOCK_USER_POSITION.balance}
        priceImpact={0.5}
      />

      {/* Auction Modal */}
      <AuctionModal
        isOpen={showAuctionModal}
        onClose={() => setShowAuctionModal(false)}
        tokenSymbol={MOCK_TOKEN.symbol}
        tokenName={MOCK_TOKEN.name}
      />

      {/* Liquidity Modal */}
      <LiquidityModal
        isOpen={showLiquidityModal}
        onClose={() => setShowLiquidityModal(false)}
        tokenSymbol={MOCK_TOKEN.symbol}
        tokenName={MOCK_TOKEN.name}
        tokenBalance={MOCK_USER_POSITION.balance}
        donutBalance={1186.38}
        tokenPrice={MOCK_TOKEN.price}
        donutPrice={0.001}
      />

      {/* Spin Modal (for SlotRig) */}
      <SpinModal
        isOpen={showSpinModal}
        onClose={() => setShowSpinModal(false)}
        tokenSymbol={MOCK_TOKEN.symbol}
        tokenName={MOCK_TOKEN.name}
        userBalance={45.73}
      />
    </main>
  );
}
