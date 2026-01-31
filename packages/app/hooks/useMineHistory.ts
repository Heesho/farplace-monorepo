import { useQuery } from "@tanstack/react-query";
import { getMines } from "@/lib/subgraph-launchpad";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MineEvent = {
  miner: string;
  price: bigint;
  minted: bigint;
  timestamp: bigint;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMineHistory(
  rigAddress: string | undefined,
  limit: number = 10,
): {
  mines: MineEvent[] | undefined;
  isLoading: boolean;
} {
  const { data: raw, isLoading } = useQuery({
    queryKey: ["mineHistory", rigAddress, limit],
    queryFn: () => getMines(rigAddress!, limit),
    enabled: !!rigAddress,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  // Convert SubgraphMineEvent to our MineEvent interface
  const mines = raw?.map((m) => ({
    miner: m.miner.id,
    price: BigInt(Math.floor(parseFloat(m.price) * 1e6)), // USDC 6 decimals
    minted: BigInt(Math.floor(parseFloat(m.mined) * 1e18)), // Unit 18 decimals
    timestamp: BigInt(m.timestamp),
  }));

  return {
    mines,
    isLoading,
  };
}
