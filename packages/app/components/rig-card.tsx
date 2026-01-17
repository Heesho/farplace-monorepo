"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatUnits, formatEther } from "viem";
import type { RigListItem } from "@/hooks/useAllRigs";
import { cn } from "@/lib/utils";
import { ipfsToHttp } from "@/lib/constants";
import { QUOTE_TOKEN_DECIMALS } from "@/lib/contracts";

// Format quote token (USDC - 6 decimals)
const formatQuote = (value: bigint, maximumFractionDigits = 2) => {
  if (value === 0n) return "0";
  const asNumber = Number(formatUnits(value, QUOTE_TOKEN_DECIMALS));
  if (!Number.isFinite(asNumber)) {
    return formatUnits(value, QUOTE_TOKEN_DECIMALS);
  }
  return asNumber.toLocaleString(undefined, {
    maximumFractionDigits,
  });
};

type RigCardProps = {
  rig: RigListItem;
  donutUsdPrice?: number;
  isTopBump?: boolean;
  isNewBump?: boolean;
};

const formatUsd = (value: number) => {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  if (value < 0.01) return `<$0.01`;
  return `$${value.toFixed(2)}`;
};

export function RigCard({ rig, donutUsdPrice = 0.01, isTopBump = false, isNewBump = false }: RigCardProps) {
  // Calculate market cap: totalMinted * unitPrice (in DONUT) * donutUsdPrice
  const marketCapUsd = rig.unitPrice > 0n
    ? Number(formatEther(rig.totalMinted)) * Number(formatEther(rig.unitPrice)) * donutUsdPrice
    : 0;
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
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[13px] text-muted-foreground truncate">{rig.tokenName}</span>
            {rig.capacity > 1n && (
              <span className="text-[11px] text-zinc-500 bg-zinc-800 rounded-full px-1.5 py-0.5">
                {Number(rig.capacity)} slots
              </span>
            )}
          </div>
        </div>

        {/* Price & Market Cap */}
        <div className="flex-shrink-0 text-right">
          <div className="text-[15px] font-medium tabular-nums">
            ${formatQuote(rig.price)}
          </div>
          <div className="text-[13px] text-muted-foreground mt-0.5">
            {formatUsd(marketCapUsd)}
          </div>
        </div>
      </div>
    </Link>
  );
}
