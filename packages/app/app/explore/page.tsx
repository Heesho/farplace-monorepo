"use client";

import { useState } from "react";
import Link from "next/link";
import { Search, Zap, Clock, Star, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { NavBar } from "@/components/nav-bar";
import { useExploreRigs, type RigListItem, type SortOption } from "@/hooks/useAllRigs";
import { useBatchMetadata } from "@/hooks/useMetadata";
import { useSparklineData } from "@/hooks/useSparklineData";
import { useFarcaster } from "@/hooks/useFarcaster";

function formatMarketCap(mcap: number): string {
  if (mcap >= 1_000_000) return `$${(mcap / 1_000_000).toFixed(2)}M`;
  if (mcap >= 1_000) return `$${(mcap / 1_000).toFixed(1)}K`;
  if (mcap >= 1) return `$${mcap.toFixed(2)}`;
  return `$${mcap.toFixed(4)}`;
}

/** Gradient color for the letter avatar fallback, based on rig type */
function rigTypeGradient(rigType: string): string {
  switch (rigType) {
    case "spin":
      return "from-purple-500 to-purple-700";
    case "fund":
      return "from-emerald-500 to-emerald-700";
    case "mine":
    default:
      return "from-blue-500 to-blue-700";
  }
}


/** Mini sparkline chart */
function Sparkline({ data, isPositive }: { data: number[]; isPositive: boolean }) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min;
  const pad = 4; // padding so strokes aren't clipped at edges

  const divisor = data.length > 1 ? data.length - 1 : 1;
  const points = data
    .map((value, i) => {
      const x = pad + (i / divisor) * (100 - pad * 2);
      const y = range === 0 ? 50 : pad + (1 - (value - min) / range) * (100 - pad * 2);
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
        stroke="#a1a1aa"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

function TokenLogo({
  rigUri,
  name,
  rigType,
  getLogoUrl,
}: {
  rigUri: string;
  name: string;
  rigType: string;
  getLogoUrl: (rigUri: string) => string | null;
}) {
  const logoUrl = getLogoUrl(rigUri);
  const [imgError, setImgError] = useState(false);

  if (logoUrl && !imgError) {
    return (
      <img
        src={logoUrl}
        alt={name}
        className="w-10 h-10 rounded-full object-cover"
        onError={() => setImgError(true)}
      />
    );
  }

  // Letter avatar fallback
  const gradient = rigTypeGradient(rigType);
  return (
    <div
      className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold bg-gradient-to-br ${gradient} text-white shadow-lg`}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

function SkeletonRow() {
  return (
    <div
      className="grid grid-cols-[1.2fr_1fr_0.8fr] items-center gap-2 py-4"
      style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-secondary animate-pulse" />
        <div className="space-y-2">
          <div className="w-16 h-4 rounded bg-secondary animate-pulse" />
          <div className="w-24 h-3 rounded bg-secondary animate-pulse" />
        </div>
      </div>
      <div className="flex justify-center">
        <div className="w-16 h-8 rounded bg-secondary animate-pulse" />
      </div>
      <div className="text-right space-y-2">
        <div className="w-14 h-4 rounded bg-secondary animate-pulse ml-auto" />
        <div className="w-10 h-3 rounded bg-secondary animate-pulse ml-auto" />
      </div>
    </div>
  );
}

export default function ExplorePage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("bump");
  const { address: account } = useFarcaster();

  const { rigs, isLoading } = useExploreRigs(sortBy, searchQuery, account);

  // Batch fetch metadata for logos
  const rigUris = rigs.map((r) => r.rigUri).filter(Boolean);
  const { getLogoUrl } = useBatchMetadata(rigUris);

  // Batch fetch sparkline data for all units
  const unitAddresses = rigs.map((r) => r.unitAddress).filter(Boolean);
  const { getSparkline, getChange24h } = useSparklineData(unitAddresses);

  const isSearching = searchQuery.length > 0;
  const showEmpty = !isLoading && rigs.length === 0;

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
          <div className="mb-4">
            <h1 className="text-2xl font-semibold tracking-tight">Explore</h1>
          </div>

          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-muted-foreground" />
            <input
              type="text"
              placeholder="Search coins..."
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
              { key: "new" as const, label: "New", icon: Clock },
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

        {/* Token List */}
        <div className="flex-1 overflow-y-auto scrollbar-hide px-4 pt-2">
          {/* Loading state */}
          {isLoading && (
            <div>
              {Array.from({ length: 8 }).map((_, i) => (
                <SkeletonRow key={i} />
              ))}
            </div>
          )}

          {/* Loaded - render rig rows */}
          {!isLoading && rigs.length > 0 && (
            <div>
              <AnimatePresence initial={false}>
                {rigs.map((rig, index) => (
                  <motion.div
                    key={rig.address}
                    layout
                    transition={{ type: "spring", stiffness: 500, damping: 40 }}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <Link
                      href={`/rig/${rig.address}`}
                      className="grid grid-cols-[1.2fr_1fr_0.8fr] items-center gap-2 py-4 transition-colors duration-200 hover:bg-white/[0.02]"
                      style={{
                        borderBottom:
                          index < rigs.length - 1
                            ? "1px solid rgba(255,255,255,0.06)"
                            : "none",
                      }}
                    >
                      {/* Left side - Logo, Symbol, Name */}
                      <div className="flex items-center gap-3">
                        <TokenLogo
                          rigUri={rig.rigUri}
                          name={rig.tokenName}
                          rigType={rig.rigType}
                          getLogoUrl={getLogoUrl}
                        />
                        <div>
                          <div className="font-semibold text-[15px]">
                            {rig.tokenSymbol.length > 6
                              ? `${rig.tokenSymbol.slice(0, 6)}...`
                              : rig.tokenSymbol}
                          </div>
                          <div className="text-[13px] text-muted-foreground">
                            {rig.tokenName.length > 12
                              ? `${rig.tokenName.slice(0, 12)}...`
                              : rig.tokenName}
                          </div>
                        </div>
                      </div>

                      {/* Middle - Sparkline */}
                      <div className="flex justify-center">
                        {(() => {
                          const change = getChange24h(rig.unitAddress, rig.priceUsd);
                          return (
                            <Sparkline
                              data={getSparkline(rig.unitAddress, rig.priceUsd)}
                              isPositive={change >= 0}
                            />
                          );
                        })()}
                      </div>

                      {/* Right side - Market cap and 24h change */}
                      <div className="text-right">
                        <div className="font-medium text-[15px] tabular-nums">
                          {rig.marketCapUsd > 0
                            ? formatMarketCap(rig.marketCapUsd)
                            : "--"}
                        </div>
                        {(() => {
                          const change = getChange24h(rig.unitAddress, rig.priceUsd);
                          return (
                            <div className="text-[13px] tabular-nums text-zinc-400">
                              {rig.marketCapUsd > 0
                                ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`
                                : "--"}
                            </div>
                          );
                        })()}
                      </div>
                    </Link>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}

          {/* Empty states */}
          {showEmpty && isSearching && (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Search className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-[15px] font-medium">No coins found</p>
              <p className="text-[13px] mt-1 opacity-70">Try a different search term</p>
            </div>
          )}

          {showEmpty && !isSearching && (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Zap className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-[15px] font-medium">No coins launched yet</p>
              <p className="text-[13px] mt-1 opacity-70">Be the first to launch a coin</p>
            </div>
          )}
        </div>
      </div>
      <NavBar />
    </main>
  );
}
