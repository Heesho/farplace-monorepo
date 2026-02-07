"use client";

import { memo } from "react";
import { formatUnits } from "viem";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useProfile } from "@/hooks/useBatchProfiles";
import { viewProfile } from "@/hooks/useFarcaster";

type DonationHistoryItemProps = {
  donation: {
    id: string;
    donor: string;
    uri?: string;
    amount: bigint;
    estimatedTokens: bigint;
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

export const DonationHistoryItem = memo(function DonationHistoryItem({
  donation,
  timeAgo,
  tokenSymbol = "TOKEN",
}: DonationHistoryItemProps) {
  const { displayName, avatarUrl, fid } = useProfile(donation.donor);

  const handleProfileClick = () => {
    if (fid) viewProfile(fid);
  };

  const amount = Number(formatUnits(donation.amount, 6));
  const tokens = Number(formatUnits(donation.estimatedTokens, 18));

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
            {donation.donor.slice(2, 4).toUpperCase()}
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
          <span className="text-xs text-zinc-500">{timeAgo(donation.timestamp)}</span>
        </div>
        {donation.uri && (
          <div className="text-xs text-zinc-400 mt-0.5 truncate">{donation.uri}</div>
        )}
      </div>

      <div className="flex items-center gap-4 flex-shrink-0 text-right">
        <div>
          <div className="text-[12px] text-muted-foreground">Funded</div>
          <div className="text-[13px] font-medium">${amount.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-[12px] text-muted-foreground">Est.</div>
          <div className="text-[13px] font-medium text-zinc-400">~{formatNumber(tokens)}</div>
        </div>
      </div>
    </div>
  );
});
