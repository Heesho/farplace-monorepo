"use client";

import { useState, useRef, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Share2, Copy } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { formatEther, formatUnits } from "viem";
import { NavBar } from "@/components/nav-bar";
import { MineModal } from "@/components/mine-modal";
import { SpinModal } from "@/components/spin-modal";
import { FundModal } from "@/components/fund-modal";
import { TradeModal } from "@/components/trade-modal";
import { AuctionModal } from "@/components/auction-modal";
import { LiquidityModal } from "@/components/liquidity-modal";
import { AdminModal } from "@/components/admin-modal";
import { useRigState, useRigInfo } from "@/hooks/useRigState";
import { usePrices } from "@/hooks/usePrices";
import { useTokenMetadata } from "@/hooks/useMetadata";
import { useFarcaster } from "@/hooks/useFarcaster";
import { useDexScreener } from "@/hooks/useDexScreener";
import { usePriceHistory } from "@/hooks/usePriceHistory";
import {
  getCoreAddress,
  getMulticallAddress,
  QUOTE_TOKEN_DECIMALS,
  type RigType,
} from "@/lib/contracts";
import { getRig } from "@/lib/subgraph-launchpad";

type Timeframe = "1H" | "1D" | "1W" | "1M" | "ALL";

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
  return `$${mcap.toFixed(2)}`;
}

function TokenLogo({
  name,
  logoUrl,
  size = "md",
}: {
  name: string;
  logoUrl?: string | null;
  size?: "xs" | "sm" | "md" | "lg";
}) {
  const sizeClasses = {
    xs: "w-4 h-4 text-[8px]",
    sm: "w-5 h-5 text-[9px]",
    md: "w-10 h-10 text-sm",
    lg: "w-12 h-12 text-base",
  };

  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={name}
        className={`${sizeClasses[size]} rounded-full object-cover`}
      />
    );
  }

  return (
    <div
      className={`${sizeClasses[size]} rounded-full flex items-center justify-center font-semibold bg-gradient-to-br from-zinc-500 to-zinc-700 text-white`}
    >
      {name.charAt(0)}
    </div>
  );
}

// Simple chart component - placeholder data for now (Task 8 will wire real data)
type ChartDataPoint = { time: string; price: number };

function SimpleChart({
  data,
  isPositive,
}: {
  data: ChartDataPoint[];
  isPositive: boolean;
}) {
  if (data.length < 2) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
        {data.length === 0 ? "No chart data" : `$${data[0].price.toFixed(4)}`}
      </div>
    );
  }

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

// Loading skeleton for the page
function LoadingSkeleton() {
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
          <div className="text-center opacity-0">
            <div className="text-[15px] font-semibold">--</div>
          </div>
          <div className="p-2 -mr-2" />
        </div>

        {/* Content skeleton */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-4">
          {/* Token info skeleton */}
          <div className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-secondary animate-pulse" />
              <div>
                <div className="w-16 h-4 bg-secondary rounded animate-pulse mb-1" />
                <div className="w-24 h-5 bg-secondary rounded animate-pulse" />
              </div>
            </div>
            <div className="text-right">
              <div className="w-20 h-6 bg-secondary rounded animate-pulse mb-1" />
              <div className="w-14 h-4 bg-secondary rounded animate-pulse" />
            </div>
          </div>

          {/* Chart skeleton */}
          <div className="h-44 mb-2 -mx-4 bg-secondary/30 animate-pulse rounded" />

          {/* Timeframe selector skeleton */}
          <div className="flex justify-between mb-5 px-2">
            {["1H", "1D", "1W", "1M", "ALL"].map((tf) => (
              <div key={tf} className="px-3.5 py-1.5 rounded-lg bg-secondary/50 text-[13px] text-muted-foreground">
                {tf}
              </div>
            ))}
          </div>

          {/* Stats skeleton */}
          <div className="mb-6">
            <div className="w-16 h-6 bg-secondary rounded animate-pulse mb-3" />
            <div className="grid grid-cols-2 gap-y-4 gap-x-8">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i}>
                  <div className="w-20 h-3 bg-secondary rounded animate-pulse mb-1" />
                  <div className="w-16 h-5 bg-secondary rounded animate-pulse" />
                </div>
              ))}
            </div>
          </div>

          {/* About skeleton */}
          <div className="mb-6">
            <div className="w-16 h-6 bg-secondary rounded animate-pulse mb-3" />
            <div className="w-full h-4 bg-secondary rounded animate-pulse mb-2" />
            <div className="w-3/4 h-4 bg-secondary rounded animate-pulse mb-2" />
          </div>
        </div>
      </div>
    </main>
  );
}

export default function RigDetailPage() {
  const params = useParams();
  const address = (params?.address as string)?.toLowerCase() || "";
  const rigAddress = address as `0x${string}`;

  // Farcaster context for connected wallet
  const { address: account } = useFarcaster();

  // Fetch rig data from subgraph
  const { data: subgraphRig, isLoading: isSubgraphLoading } = useQuery({
    queryKey: ["rig", address],
    queryFn: () => getRig(address),
    enabled: !!address,
    staleTime: 30_000,
  });

  // Derive rig type from subgraph data
  const rigType = (subgraphRig?.rigType as RigType) ?? undefined;

  // Get core and multicall addresses based on rig type
  const coreAddress = rigType ? getCoreAddress(rigType) : undefined;
  const multicallAddress = rigType ? getMulticallAddress(rigType) : undefined;

  // Fetch on-chain rig state (slot 0) via multicall
  const { rigState, isLoading: isRigStateLoading } = useRigState(
    rigAddress,
    account,
    0n,
    multicallAddress
  );

  // Fetch rig info (unit/auction/LP addresses, token name/symbol, launcher)
  const { rigInfo, isLoading: isRigInfoLoading } = useRigInfo(
    rigAddress,
    coreAddress
  );

  // Fetch USD prices
  const { donutUsdPrice } = usePrices();

  // Fetch token metadata from IPFS
  const { metadata, logoUrl } = useTokenMetadata(rigState?.rigUri);

  // Fetch DexScreener data for liquidity/volume/price change
  const { pairData } = useDexScreener(
    rigAddress,
    rigInfo?.unitAddress,
    coreAddress
  );

  // Derived values
  const tokenName = rigInfo?.tokenName || subgraphRig?.tokenName || "Loading...";
  const tokenSymbol = rigInfo?.tokenSymbol || subgraphRig?.tokenSymbol || "--";

  // Price in USD = unitPrice (DONUT, 18 dec) x donutUsdPrice
  const priceUsd = rigState?.unitPrice
    ? Number(formatEther(rigState.unitPrice)) * donutUsdPrice
    : 0;

  // Market cap = totalMinted * unitPrice * donutUsdPrice
  // subgraphRig.minted is in raw units (no decimals - stored as string of the raw value)
  const totalMintedRaw = subgraphRig?.minted ? BigInt(subgraphRig.minted) : 0n;
  const marketCapUsd =
    rigState?.unitPrice && totalMintedRaw > 0n
      ? Number(formatEther(totalMintedRaw)) *
        Number(formatEther(rigState.unitPrice)) *
        donutUsdPrice
      : 0;

  // Total supply from subgraph
  const totalSupply = totalMintedRaw > 0n ? Number(formatEther(totalMintedRaw)) : 0;

  // 24h change from DexScreener
  const change24h = pairData?.priceChange?.h24 ?? null;
  const isPositive = change24h !== null ? change24h >= 0 : true;

  // User position
  const userUnitBalance = rigState?.accountUnitBalance
    ? Number(formatEther(rigState.accountUnitBalance))
    : 0;
  const positionBalanceUsd = userUnitBalance * priceUsd;
  const hasPosition = userUnitBalance > 0;

  // User quote balance (USDC, 6 decimals)
  const userQuoteBalance = rigState?.accountQuoteBalance
    ? Number(formatUnits(rigState.accountQuoteBalance, QUOTE_TOKEN_DECIMALS))
    : 0;

  // User donut balance
  const userDonutBalance = rigState?.accountDonutBalance
    ? Number(formatEther(rigState.accountDonutBalance))
    : 0;

  // Stats from DexScreener + subgraph
  const liquidityUsd = pairData?.liquidity?.usd ?? 0;
  const volume24h = pairData?.volume?.h24 ?? 0;

  // Revenue from subgraph (raw values in quote token decimals)
  const treasuryRevenue = subgraphRig?.revenue
    ? Number(formatUnits(BigInt(subgraphRig.revenue), QUOTE_TOKEN_DECIMALS))
    : 0;
  const teamRevenue = subgraphRig?.teamRevenue
    ? Number(formatUnits(BigInt(subgraphRig.teamRevenue), QUOTE_TOKEN_DECIMALS))
    : 0;

  // Capacity from on-chain
  const capacity = rigState?.capacity ? Number(rigState.capacity) : 0;

  // Rig type display label
  const rigTypeLabel = rigType
    ? rigType.charAt(0).toUpperCase() + rigType.slice(1)
    : "--";

  // Launcher address from useRigInfo
  const launcherAddress = rigInfo?.launcher || null;

  // Ownership check: compare connected wallet to launcher address
  const isOwner = !!(
    account &&
    launcherAddress &&
    account.toLowerCase() === launcherAddress.toLowerCase()
  );

  // Chart data from subgraph price history
  const [timeframe, setTimeframe] = useState<Timeframe>("1D");
  const { data: chartData } = usePriceHistory(rigAddress, timeframe);

  // Created date from subgraph
  const createdAt = subgraphRig?.createdAt
    ? new Date(Number(subgraphRig.createdAt) * 1000)
    : null;
  const launchDateStr = createdAt ? getRelativeTime(createdAt) : "--";

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

  // Show loading skeleton while critical data loads
  const isLoading = isSubgraphLoading || (!!rigType && isRigStateLoading && isRigInfoLoading);

  if (isLoading && !subgraphRig) {
    return <LoadingSkeleton />;
  }

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
            <div className="text-[15px] font-semibold">{priceUsd > 0 ? formatPrice(priceUsd) : "--"}</div>
            <div className="text-[11px] text-muted-foreground">{tokenSymbol}</div>
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
              <TokenLogo name={tokenName} logoUrl={logoUrl} size="lg" />
              <div>
                <div className="text-[13px] text-muted-foreground">{tokenSymbol}</div>
                <div className="text-[15px] font-medium">{tokenName}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="price-large">{priceUsd > 0 ? formatPrice(priceUsd) : "--"}</div>
              <div
                className={`text-[13px] font-medium ${
                  isPositive ? "text-zinc-300" : "text-zinc-500"
                }`}
              >
                {change24h !== null
                  ? `${change24h >= 0 ? "+" : ""}${change24h.toFixed(2)}%`
                  : "--"}
              </div>
            </div>
          </div>

          {/* Chart */}
          <div className="h-44 mb-2 -mx-4">
            <SimpleChart data={chartData} isPositive={isPositive} />
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
                    <TokenLogo name={tokenName} logoUrl={logoUrl} size="sm" />
                    <span>{formatNumber(userUnitBalance)}</span>
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[12px] mb-1">Value</div>
                  <div className="font-semibold text-[15px] tabular-nums text-white">
                    {positionBalanceUsd > 0 ? `$${positionBalanceUsd.toFixed(2)}` : "--"}
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
                  {marketCapUsd > 0 ? formatMarketCap(marketCapUsd) : "--"}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-0.5">Total supply</div>
                <div className="font-semibold text-[15px] tabular-nums">
                  {totalSupply > 0 ? formatNumber(totalSupply) : "--"}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-0.5">Liquidity</div>
                <div className="font-semibold text-[15px] tabular-nums">
                  {liquidityUsd > 0 ? `$${formatNumber(liquidityUsd)}` : "--"}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-0.5">24h volume</div>
                <div className="font-semibold text-[15px] tabular-nums">
                  {volume24h > 0 ? `$${formatNumber(volume24h)}` : "--"}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-0.5">Treasury</div>
                <div className="font-semibold text-[15px] tabular-nums">
                  {treasuryRevenue > 0 ? `$${treasuryRevenue.toFixed(2)}` : "--"}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-0.5">Team</div>
                <div className="font-semibold text-[15px] tabular-nums">
                  {teamRevenue > 0 ? `$${teamRevenue.toFixed(2)}` : "--"}
                </div>
              </div>
            </div>
          </div>

          {/* About Section */}
          <div className="mb-6">
            <div className="font-semibold text-[18px] mb-3">About</div>

            {/* Deployed by row */}
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground mb-2">
              <span className="text-zinc-400">{rigTypeLabel}</span>
              <span className="text-muted-foreground/60">·</span>
              <span>Deployed by</span>
              {launcherAddress ? (
                <span className="text-foreground font-medium font-mono">
                  <AddressLink address={launcherAddress} />
                </span>
              ) : (
                <span className="text-foreground font-medium">--</span>
              )}
              <span className="text-muted-foreground/60">·</span>
              <span className="text-muted-foreground/60">{launchDateStr}</span>
            </div>

            {/* Description from metadata */}
            {metadata?.description && (
              <p className="text-[13px] text-muted-foreground leading-relaxed mb-2">
                {metadata.description}
              </p>
            )}
            {!metadata?.description && rigType && (
              <p className="text-[13px] text-muted-foreground leading-relaxed mb-2">
                {rigType === "mine" && "A mining rig token. Compete for mining seats to earn token emissions over time."}
                {rigType === "spin" && "A slot machine rig token. Spin to win from the prize pool with randomized odds."}
                {rigType === "fund" && "A funding rig token. Fund daily to earn token emissions proportional to your contribution."}
              </p>
            )}

            {/* Link buttons - copy real addresses */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => {
                  if (rigInfo?.unitAddress) navigator.clipboard.writeText(rigInfo.unitAddress);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary text-[12px] text-muted-foreground hover:bg-secondary/80 transition-colors"
              >
                {tokenSymbol}
                <Copy className="w-3 h-3" />
              </button>
              <button
                onClick={() => {
                  if (rigInfo?.lpAddress) navigator.clipboard.writeText(rigInfo.lpAddress);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary text-[12px] text-muted-foreground hover:bg-secondary/80 transition-colors"
              >
                {tokenSymbol}-DONUT LP
                <Copy className="w-3 h-3" />
              </button>
            </div>

            {/* Parameters - shows capacity + placeholders for detailed config */}
            <div className="grid grid-cols-2 gap-y-3 gap-x-8">
              {rigType === "mine" && (
                <>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Slots</div>
                    <div className="font-medium text-[13px]">{capacity > 0 ? capacity : "--"}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Initial rate</div>
                    <div className="font-medium text-[13px]">--</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Floor rate</div>
                    <div className="font-medium text-[13px]">--</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Halving at</div>
                    <div className="font-medium text-[13px]">--</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Epoch</div>
                    <div className="font-medium text-[13px]">--</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Price multiplier</div>
                    <div className="font-medium text-[13px]">--</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Min price</div>
                    <div className="font-medium text-[13px]">--</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Multiplier duration</div>
                    <div className="font-medium text-[13px]">--</div>
                  </div>
                </>
              )}
              {rigType === "spin" && (
                <>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Initial rate</div>
                    <div className="font-medium text-[13px]">--</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Floor rate</div>
                    <div className="font-medium text-[13px]">--</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Halving</div>
                    <div className="font-medium text-[13px]">--</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Epoch</div>
                    <div className="font-medium text-[13px]">--</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Price multiplier</div>
                    <div className="font-medium text-[13px]">--</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Min price</div>
                    <div className="font-medium text-[13px]">--</div>
                  </div>
                </>
              )}
              {rigType === "fund" && (
                <>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Initial emission</div>
                    <div className="font-medium text-[13px]">--</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Min emission</div>
                    <div className="font-medium text-[13px]">--</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-0.5">Halving</div>
                    <div className="font-medium text-[13px]">--</div>
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
                {marketCapUsd > 0 ? formatMarketCap(marketCapUsd) : "--"}
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
                {showActionMenu ? "\u2715" : "Actions"}
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
        rigAddress={rigAddress}
        tokenSymbol={tokenSymbol}
        tokenName={tokenName}
        multicallAddress={multicallAddress}
      />

      {/* Spin Modal */}
      <SpinModal
        isOpen={showSpinModal}
        onClose={() => setShowSpinModal(false)}
        tokenSymbol={tokenSymbol}
        tokenName={tokenName}
        userBalance={userQuoteBalance}
      />

      {/* Fund Modal */}
      <FundModal
        isOpen={showFundModal}
        onClose={() => setShowFundModal(false)}
        tokenSymbol={tokenSymbol}
        tokenName={tokenName}
        userBalance={userQuoteBalance}
      />

      {/* Trade Modal (Buy/Sell) */}
      <TradeModal
        isOpen={showTradeModal}
        onClose={() => setShowTradeModal(false)}
        mode={tradeMode}
        tokenSymbol={tokenSymbol}
        tokenName={tokenName}
        unitAddress={(rigInfo?.unitAddress ?? "0x0") as `0x${string}`}
        marketPrice={priceUsd}
        userQuoteBalance={rigState?.accountQuoteBalance ?? 0n}
        userUnitBalance={rigState?.accountUnitBalance ?? 0n}
      />

      {/* Auction Modal */}
      <AuctionModal
        isOpen={showAuctionModal}
        onClose={() => setShowAuctionModal(false)}
        rigAddress={rigAddress}
        tokenSymbol={tokenSymbol}
        tokenName={tokenName}
        multicallAddress={multicallAddress}
      />

      {/* Liquidity Modal */}
      <LiquidityModal
        isOpen={showLiquidityModal}
        onClose={() => setShowLiquidityModal(false)}
        tokenSymbol={tokenSymbol}
        tokenName={tokenName}
        tokenBalance={userUnitBalance}
        donutBalance={userDonutBalance}
        tokenPrice={priceUsd}
        donutPrice={donutUsdPrice}
      />

      {/* Admin Modal */}
      <AdminModal
        isOpen={showAdminModal}
        onClose={() => setShowAdminModal(false)}
        rigType={rigType ?? "mine"}
        tokenSymbol={tokenSymbol}
        tokenName={tokenName}
        currentConfig={{
          treasury: launcherAddress ?? "",
          team: null,
          uri: rigState?.rigUri ?? "",
          ...(rigType === "mine" && {
            capacity,
            multipliersEnabled: false,
          }),
          ...(rigType === "fund" && {
            recipient: null,
          }),
        }}
      />

    </main>
  );
}

/** Returns a relative time string like "2d ago", "3h ago", etc. */
function getRelativeTime(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffDay > 0) return `${diffDay}d ago`;
  if (diffHour > 0) return `${diffHour}h ago`;
  if (diffMin > 0) return `${diffMin}m ago`;
  return "just now";
}
