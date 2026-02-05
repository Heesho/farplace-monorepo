"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { RigListItem } from "@/hooks/useAllRigs";
import { cn } from "@/lib/utils";
import { ipfsToHttp } from "@/lib/constants";
import { getUnitHourData } from "@/lib/subgraph-launchpad";

type RigCardProps = {
  rig: RigListItem;
  isTopBump?: boolean;
  isNewBump?: boolean;
};

const formatUsd = (value: number | undefined | null) => {
  if (value == null || value === 0) return "$0.00";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  if (value < 0.0001) return `<$0.0001`;
  if (value < 0.01) return `$${value.toFixed(6)}`;
  return `$${value.toFixed(2)}`;
};

// Mini sparkline chart component
function MiniSparkline({ unitAddress, currentPrice }: { unitAddress: string; currentPrice: number }) {
  const { data: candles } = useQuery({
    queryKey: ["miniSparkline", unitAddress],
    queryFn: async () => {
      const now = Math.floor(Date.now() / 1000);
      const since = now - 86400; // Last 24h
      return getUnitHourData(unitAddress.toLowerCase(), since);
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  // Generate points for the sparkline
  const points = (() => {
    const width = 60;
    const height = 24;
    const padding = 2;

    // If no data, create flat line at current price
    if (!candles || candles.length === 0) {
      const y = height / 2;
      return `${padding},${y} ${width - padding},${y}`;
    }

    const prices = candles.map((c) => parseFloat(c.close));
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceRange = maxPrice - minPrice || 1;

    return prices
      .map((price, i) => {
        const x = padding + (i / (prices.length - 1)) * (width - padding * 2);
        const y = height - padding - ((price - minPrice) / priceRange) * (height - padding * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  })();

  // Determine color based on price change
  const isUp = candles && candles.length > 1
    ? parseFloat(candles[candles.length - 1].close) >= parseFloat(candles[0].close)
    : true;

  return (
    <svg width="60" height="24" className="overflow-visible">
      <polyline
        points={points}
        fill="none"
        stroke={isUp ? "#22c55e" : "#ef4444"}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function RigCard({ rig, isTopBump = false, isNewBump = false }: RigCardProps) {
  // Market cap comes directly from subgraph as USD
  const marketCapUsd = rig.marketCapUsd;
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  // Fetch metadata to get image URL
  useEffect(() => {
    if (!rig.rigUri) return;

    const metadataUrl = ipfsToHttp(rig.rigUri);
    if (!metadataUrl) return;

    fetch(metadataUrl)
      .then((res) => res.json())
      .then((metadata) => {
        if (metadata.image) {
          setLogoUrl(ipfsToHttp(metadata.image));
        }
      })
      .catch(() => {
        // Silently fail - will show fallback
      });
  }, [rig.rigUri]);

  return (
    <Link href={`/rig/${rig.address}`} className="block">
      <div
        className={cn(
          "flex items-center gap-3 py-4 transition-colors hover:bg-white/[0.02]",
          isNewBump && "animate-bump-enter",
          isTopBump && !isNewBump && "animate-bump-glow"
        )}
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
      >
        {/* Token Logo */}
        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center overflow-hidden">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={rig.tokenSymbol}
              className="w-10 h-10 object-cover"
            />
          ) : (
            <span className="text-zinc-400 font-semibold text-sm">
              {rig.tokenSymbol.slice(0, 2)}
            </span>
          )}
        </div>

        {/* Token Name & Symbol */}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[15px] truncate">
            {rig.tokenSymbol}
          </div>
          <div className="text-[13px] text-muted-foreground truncate mt-0.5">
            {rig.tokenName}
          </div>
        </div>

        {/* Mini Sparkline Chart */}
        <div className="flex-shrink-0 px-2">
          <MiniSparkline unitAddress={rig.unitAddress} currentPrice={rig.priceUsd} />
        </div>

        {/* Market Cap & 24h Change */}
        <div className="flex-shrink-0 text-right min-w-[70px]">
          <div className="text-[15px] font-medium tabular-nums">
            {formatUsd(marketCapUsd)}
          </div>
          <div className={cn(
            "text-[13px] tabular-nums mt-0.5",
            (rig.change24h ?? 0) >= 0 ? "text-green-500" : "text-red-500"
          )}>
            {(rig.change24h ?? 0) >= 0 ? "+" : ""}{Math.round(rig.change24h ?? 0)}%
          </div>
        </div>
      </div>
    </Link>
  );
}
