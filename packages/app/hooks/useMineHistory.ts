import { useQuery } from "@tanstack/react-query";
import { getMines } from "@/lib/subgraph-launchpad";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MineEvent = {
  miner: string;
  price: bigint;
  earned: bigint;
  minted: bigint;
  timestamp: bigint;
  uri: string;
  multiplier: number;
  slotIndex: number;
  epochId: bigint;
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
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  // Convert SubgraphMineEvent to our MineEvent interface
  const mines = raw?.map((m) => ({
    miner: m.miner.id,
    price: BigInt(Math.floor(parseFloat(m.price) * 1e6)), // USDC 6 decimals
    earned: BigInt(Math.floor(parseFloat(m.earned) * 1e6)), // USDC 6 decimals
    minted: BigInt(Math.floor(parseFloat(m.minted) * 1e18)), // Unit 18 decimals
    timestamp: BigInt(m.timestamp),
    uri: m.uri || "",
    multiplier: 1, // Not stored in subgraph, default to 1
    slotIndex: parseInt(m.slotIndex),
    epochId: BigInt(m.epochId),
  }));

  return {
    mines,
    isLoading,
  };
}
