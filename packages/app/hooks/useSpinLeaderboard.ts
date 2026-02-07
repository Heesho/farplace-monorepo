import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatEther, formatUnits } from "viem";
import { getSpins, type SubgraphSpin } from "@/lib/subgraph-launchpad";
import type { LeaderboardEntry } from "@/hooks/useRigLeaderboard";

function aggregateSpinners(
  spins: SubgraphSpin[],
  account: string | undefined,
  limit: number
): LeaderboardEntry[] {
  const spinnerMap = new Map<
    string,
    { minted: number; spent: number }
  >();

  for (const s of spins) {
    const spinnerId = s.spinner.id.toLowerCase();
    const prev = spinnerMap.get(spinnerId) ?? { minted: 0, spent: 0 };
    prev.minted += parseFloat(s.winAmount);
    prev.spent += parseFloat(s.price);
    spinnerMap.set(spinnerId, prev);
  }

  const sorted = [...spinnerMap.entries()]
    .sort((a, b) => b[1].minted - a[1].minted)
    .slice(0, limit);

  return sorted.map(([addr, stats], index) => {
    const mined = BigInt(Math.floor(stats.minted * 1e18));
    const spent = BigInt(Math.floor(stats.spent * 1e6));
    const minedNum = Number(formatEther(mined));
    const spentNum = Number(formatUnits(spent, 6));
    return {
      miner: addr,
      mined,
      earned: 0n,
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
      earnedFormatted: "$0.00",
      isCurrentUser: account
        ? addr.toLowerCase() === account.toLowerCase()
        : false,
      isFriend: false,
      profile: null,
    };
  });
}

export function useSpinLeaderboard(
  rigAddress: string | undefined,
  account: string | undefined,
  limit: number = 10,
) {
  const { data: raw, isLoading } = useQuery({
    queryKey: ["spinLeaderboard", rigAddress, limit],
    queryFn: () => getSpins(rigAddress!, 1000),
    enabled: !!rigAddress,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const entries = useMemo(() => raw ? aggregateSpinners(raw, account, limit) : undefined, [raw, account, limit]);

  const userRank = useMemo(() =>
    account && entries
      ? (() => {
          const idx = entries.findIndex(
            (e) => e.miner.toLowerCase() === account.toLowerCase()
          );
          return idx >= 0 ? idx + 1 : undefined;
        })()
      : undefined,
    [account, entries]
  );

  return { entries, userRank, isLoading };
}
