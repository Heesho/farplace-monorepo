import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatEther, formatUnits } from "viem";
import { getMines, type SubgraphMineEvent } from "@/lib/subgraph-launchpad";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LeaderboardEntry = {
  miner: string;
  mined: bigint;
  earned: bigint;
  // Extended fields used by the Leaderboard component
  rank: number;
  address: string;
  minedFormatted: string;
  spent: bigint;
  spentFormatted: string;
  earnedFormatted: string;
  isCurrentUser: boolean;
  isFriend: boolean;
  profile: {
    displayName?: string;
    username?: string;
    pfpUrl?: string;
  } | null;
};

// ---------------------------------------------------------------------------
// Aggregate mine events by miner to build a leaderboard
// ---------------------------------------------------------------------------

function aggregateMiners(
  events: SubgraphMineEvent[],
  account: string | undefined,
  limit: number
): LeaderboardEntry[] {
  const minerMap = new Map<
    string,
    { minted: number; earned: number; spent: number }
  >();

  for (const e of events) {
    const minerId = e.miner.id.toLowerCase();
    const prev = minerMap.get(minerId) ?? { minted: 0, earned: 0, spent: 0 };
    prev.minted += parseFloat(e.minted);
    prev.earned += parseFloat(e.earned);
    prev.spent += parseFloat(e.price);
    minerMap.set(minerId, prev);
  }

  // Sort by total minted descending
  const sorted = [...minerMap.entries()]
    .sort((a, b) => b[1].minted - a[1].minted)
    .slice(0, limit);

  return sorted.map(([addr, stats], index) => {
    const mined = BigInt(Math.floor(stats.minted * 1e18));
    const earned = BigInt(Math.floor(stats.earned * 1e6));
    const spent = BigInt(Math.floor(stats.spent * 1e6));
    const minedNum = Number(formatEther(mined));
    const earnedNum = Number(formatUnits(earned, 6));
    const spentNum = Number(formatUnits(spent, 6));
    return {
      miner: addr,
      mined,
      earned,
      rank: index + 1,
      address: addr,
      minedFormatted:
        minedNum >= 1_000_000
          ? `${(minedNum / 1_000_000).toFixed(2)}M`
          : minedNum >= 1_000
          ? `${(minedNum / 1_000).toFixed(1)}K`
          : minedNum.toFixed(0),
      spent,
      spentFormatted: `$${spentNum.toFixed(2)}`,
      earnedFormatted: `$${earnedNum.toFixed(2)}`,
      isCurrentUser: account
        ? addr.toLowerCase() === account.toLowerCase()
        : false,
      isFriend: false,
      profile: null,
    };
  });
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useRigLeaderboard(
  rigAddress: string | undefined,
  account: string | undefined,
  limit: number = 10,
): {
  entries: LeaderboardEntry[] | undefined;
  userRank: number | undefined;
  isLoading: boolean;
} {
  const {
    data: raw,
    isLoading,
  } = useQuery({
    queryKey: ["rigLeaderboard", rigAddress, limit],
    queryFn: () => getMines(rigAddress!, 1000), // fetch up to 1000 events to aggregate
    enabled: !!rigAddress,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const entries = useMemo(() => raw ? aggregateMiners(raw, account, limit) : undefined, [raw, account, limit]);

  // Compute user rank from the leaderboard data
  const userRank = useMemo(() =>
    account && entries
      ? (() => {
          const idx = entries.findIndex(
            (e: LeaderboardEntry) => e.miner.toLowerCase() === account.toLowerCase()
          );
          return idx >= 0 ? idx + 1 : undefined;
        })()
      : undefined,
    [account, entries]
  );

  return {
    entries,
    userRank,
    isLoading,
  };
}
