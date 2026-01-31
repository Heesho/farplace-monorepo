import { useQuery } from "@tanstack/react-query";
import { getRigLeaderboard } from "@/lib/subgraph-launchpad";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LeaderboardEntry = {
  miner: string;
  mined: bigint;
  earned: bigint;
};

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
    queryFn: () => getRigLeaderboard(rigAddress!, limit),
    enabled: !!rigAddress,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  // Convert SubgraphRigAccount[] to LeaderboardEntry[]
  const entries = raw?.map((r) => ({
    miner: r.account.id,
    mined: BigInt(Math.floor(parseFloat(r.mined) * 1e18)),
    earned: BigInt(Math.floor(parseFloat(r.earned) * 1e6)),
  }));

  // Compute user rank from the leaderboard data
  const userRank =
    account && entries
      ? (() => {
          const idx = entries.findIndex(
            (e) => e.miner.toLowerCase() === account.toLowerCase()
          );
          return idx >= 0 ? idx + 1 : undefined;
        })()
      : undefined;

  return {
    entries,
    userRank,
    isLoading,
  };
}
