"use client";

import { memo } from "react";
import { formatUnits } from "viem";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useProfile } from "@/hooks/useBatchProfiles";
import { viewProfile } from "@/hooks/useFarcaster";

type MineHistoryItemProps = {
  mine: {
    id: string;
    miner: string;
    uri: string;
    price: bigint;
    spent: bigint;
    earned?: bigint;
    mined?: bigint;
    multiplier?: number;
    timestamp: number;
    slotIndex?: number;
  };
  timeAgo: (ts: number) => string;
  tokenSymbol?: string;
};

function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toFixed(0);
}

/**
 * Memoized mine history item with cached profile lookup
 */
export const MineHistoryItem = memo(function MineHistoryItem({
  mine,
  timeAgo,
  tokenSymbol = "TOKEN",
}: MineHistoryItemProps) {
  // Use cached profile lookup
  const { displayName, avatarUrl, fid } = useProfile(mine.miner);

  const handleProfileClick = () => {
    if (fid) viewProfile(fid);
  };

  const spent = Number(formatUnits(mine.spent, 6));
  const earned = Number(formatUnits(mine.earned ?? 0n, 6));
  const mined = Number(formatUnits(mine.mined ?? 0n, 18));

  return (
    <div className="flex items-center gap-3 py-3">
      <button
        onClick={handleProfileClick}
        disabled={!fid}
        className={fid ? "cursor-pointer" : "cursor-default"}
      >
        <Avatar className="h-8 w-8 flex-shrink-0">
          <AvatarImage src={avatarUrl} alt={displayName} />
          <AvatarFallback className="bg-zinc-800 text-white text-xs">
            {mine.miner.slice(2, 4).toUpperCase()}
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
          <span className="text-xs text-zinc-500">{timeAgo(mine.timestamp)}</span>
          {mine.multiplier && mine.multiplier > 1 && (
            <span className="text-[10px] font-semibold text-zinc-300 bg-zinc-700 px-1.5 py-0.5 rounded">
              {mine.multiplier}x
            </span>
          )}
        </div>
        {mine.uri && (
          <div className="text-xs text-zinc-400 mt-0.5 truncate">{mine.uri}</div>
        )}
      </div>

      <div className="flex items-center gap-4 flex-shrink-0 text-right">
        <div>
          <div className="text-[12px] text-muted-foreground">Spent</div>
          <div className="text-[13px] font-medium">${spent.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-[12px] text-muted-foreground">Earned</div>
          <div className="text-[13px] font-medium">${earned.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-[12px] text-muted-foreground">Mined</div>
          <div className="text-[13px] font-medium">{formatNumber(mined)}</div>
        </div>
      </div>
    </div>
  );
});
