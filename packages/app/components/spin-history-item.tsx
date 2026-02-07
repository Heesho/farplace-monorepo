"use client";

import { memo } from "react";
import { formatUnits } from "viem";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useProfile } from "@/hooks/useBatchProfiles";
import { viewProfile } from "@/hooks/useFarcaster";

type SpinHistoryItemProps = {
  spin: {
    id: string;
    spinner: string;
    uri?: string;
    price: bigint;
    payoutPercent: number;
    won: bigint;
    timestamp: number;
  };
  timeAgo: (ts: number) => string;
  tokenSymbol?: string;
};

function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toFixed(0);
}

export const SpinHistoryItem = memo(function SpinHistoryItem({
  spin,
  timeAgo,
  tokenSymbol = "TOKEN",
}: SpinHistoryItemProps) {
  const { displayName, avatarUrl, fid } = useProfile(spin.spinner);

  const handleProfileClick = () => {
    if (fid) viewProfile(fid);
  };

  const price = Number(formatUnits(spin.price, 6));
  const won = Number(formatUnits(spin.won, 18));

  return (
    <div
      className="flex items-center gap-3 py-3"
    >
      <button
        onClick={handleProfileClick}
        disabled={!fid}
        className={fid ? "cursor-pointer" : "cursor-default"}
      >
        <Avatar className="h-8 w-8 flex-shrink-0">
          <AvatarImage src={avatarUrl} alt={displayName} />
          <AvatarFallback className="bg-zinc-800 text-white text-xs">
            {spin.spinner.slice(2, 4).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <button
            onClick={handleProfileClick}
            disabled={!fid}
            className={`text-sm font-medium truncate ${fid ? "hover:text-zinc-300 cursor-pointer" : "cursor-default"}`}
          >
            {displayName}
          </button>
          <span className="text-xs text-zinc-500">{timeAgo(spin.timestamp)}</span>
        </div>
        {spin.uri && (
          <div className="text-xs text-zinc-400 mt-0.5 truncate">{spin.uri}</div>
        )}
      </div>

      <div className="flex items-center gap-4 flex-shrink-0 text-right">
        <div>
          <div className="text-[12px] text-muted-foreground">Spent</div>
          <div className="text-[13px] font-medium">${price.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-[12px] text-muted-foreground">Result</div>
          <div className="text-[13px] font-medium">{spin.payoutPercent}%</div>
        </div>
        <div>
          <div className="text-[12px] text-muted-foreground">Mined</div>
          <div className="text-[13px] font-medium">{formatNumber(won)}</div>
        </div>
      </div>
    </div>
  );
});
