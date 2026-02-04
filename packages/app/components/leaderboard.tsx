"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Crown, Medal, Users, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { LeaderboardEntry } from "@/hooks/useRigLeaderboard";
import { composeCast } from "@/hooks/useFarcaster";

type LeaderboardProps = {
  entries: LeaderboardEntry[];
  userRank: number | null;
  tokenSymbol: string;
  tokenName: string;
  rigUrl: string;
  isLoading?: boolean;
};

function getRankIcon(rank: number) {
  if (rank === 1) return <Crown className="w-4 h-4 text-zinc-100" />;
  if (rank === 2) return <Medal className="w-4 h-4 text-zinc-300" />;
  if (rank === 3) return <Medal className="w-4 h-4 text-zinc-400" />;
  return <span className="w-4 text-center text-xs text-zinc-500">#{rank}</span>;
}

function LeaderboardRow({ entry, tokenSymbol }: { entry: LeaderboardEntry; tokenSymbol: string }) {
  const displayName = entry.profile?.displayName
    ?? entry.profile?.username
    ?? `${entry.address.slice(0, 6)}...${entry.address.slice(-4)}`;

  const avatarUrl = entry.profile?.pfpUrl
    ?? `https://api.dicebear.com/7.x/shapes/svg?seed=${entry.address.toLowerCase()}`;

  return (
    <div
      className="flex items-center gap-3 py-3"
      style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
    >
      {/* Rank */}
      <div className="w-6 flex justify-center flex-shrink-0">
        {getRankIcon(entry.rank)}
      </div>

      {/* Avatar */}
      <Avatar className="h-7 w-7 flex-shrink-0">
        <AvatarImage src={avatarUrl} alt={displayName} />
        <AvatarFallback className="bg-zinc-800 text-white text-[10px]">
          {entry.address.slice(2, 4).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      {/* Name + badges */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={cn(
            "text-sm truncate",
            entry.isCurrentUser && "font-semibold text-white",
            entry.isFriend && !entry.isCurrentUser && "text-zinc-300"
          )}>
            {displayName}
          </span>
          {entry.isCurrentUser && (
            <span className="text-[10px] bg-zinc-700 text-zinc-300 px-1.5 py-0.5 rounded-full">You</span>
          )}
          {entry.isFriend && !entry.isCurrentUser && (
            <Users className="w-3 h-3 text-zinc-400" />
          )}
        </div>
      </div>

      {/* Mined amount */}
      <div className="text-right flex-shrink-0">
        <div className="text-sm font-medium">{entry.minedFormatted}</div>
        <div className="text-[10px] text-zinc-500">{tokenSymbol}</div>
      </div>
    </div>
  );
}

export function Leaderboard({
  entries,
  userRank,
  tokenSymbol,
  tokenName,
  rigUrl,
  isLoading,
}: LeaderboardProps) {
  const handleShareChallenge = async () => {
    if (!userRank) return;

    const text = `I'm ranked #${userRank} on the ${tokenName} ($${tokenSymbol}) mining leaderboard! Think you can beat me? ⛏️`;

    await composeCast({
      text,
      embeds: [rigUrl],
    });
  };

  if (isLoading) {
    return (
      <div className="mt-6">
        <h2 className="text-[18px] font-semibold mb-3">Leaderboard</h2>
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-12 bg-zinc-900/30 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="mt-6">
        <h2 className="text-[18px] font-semibold mb-3">Leaderboard</h2>
        <div className="text-center py-4 text-muted-foreground text-[13px]">
          No miners yet
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[18px] font-semibold">Leaderboard</h2>
        {userRank && (
          <button
            onClick={handleShareChallenge}
            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-300 transition-colors"
          >
            <Share2 className="w-3.5 h-3.5" />
            Challenge friends
          </button>
        )}
      </div>

      {/* User rank summary if not in top entries */}
      {userRank && userRank > entries.length && (
        <div className="mb-3 p-2.5 rounded-lg bg-zinc-800 border border-zinc-700">
          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-400">Your rank</span>
            <span className="text-sm font-semibold text-white">#{userRank}</span>
          </div>
        </div>
      )}

      <div>
        {entries.map((entry) => (
          <LeaderboardRow key={entry.address} entry={entry} tokenSymbol={tokenSymbol} />
        ))}
      </div>
    </div>
  );
}
