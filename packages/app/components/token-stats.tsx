"use client";

import { memo } from "react";

type TokenStatsProps = {
  marketCap: number;
  totalSupply: number;
  liquidity: number;
  volume24h: number;
};

const formatUsd = (value: number, compact = false) => {
  if (compact) {
    if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
    if (value >= 1000) return `$${(value / 1000).toFixed(2)}K`;
  }
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export const TokenStats = memo(function TokenStats({
  marketCap,
  totalSupply,
  liquidity,
  volume24h,
}: TokenStatsProps) {
  return (
    <div className="px-2 mt-6">
      <h2 className="text-[18px] font-semibold mb-3">Stats</h2>
      <div className="grid grid-cols-2 gap-x-8 gap-y-3">
        <div>
          <div className="text-[12px] text-muted-foreground">Market cap</div>
          <div className="text-[13px] font-medium">{formatUsd(marketCap, true)}</div>
        </div>
        <div>
          <div className="text-[12px] text-muted-foreground">Total supply</div>
          <div className="text-[13px] font-medium">
            {totalSupply.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
        </div>
        <div>
          <div className="text-[12px] text-muted-foreground">Liquidity</div>
          <div className="text-[13px] font-medium">
            {liquidity > 0 ? formatUsd(liquidity, true) : "—"}
          </div>
        </div>
        <div>
          <div className="text-[12px] text-muted-foreground">24h volume</div>
          <div className="text-[13px] font-medium">
            {volume24h > 0 ? formatUsd(volume24h, true) : "—"}
          </div>
        </div>
      </div>
    </div>
  );
});
