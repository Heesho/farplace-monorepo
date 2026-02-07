import { useQuery } from "@tanstack/react-query";
import { getSpins, type SubgraphSpin } from "@/lib/subgraph-launchpad";

export type SpinEvent = {
  spinner: string;
  price: bigint;       // USDC 6 decimals
  uri: string;
  won: boolean;
  winAmount: bigint;    // Unit 18 decimals
  oddsBps: bigint;
  timestamp: bigint;
  txHash: string;
};

export function useSpinHistory(
  rigAddress: string | undefined,
  limit: number = 20,
) {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["spinHistory", rigAddress, limit],
    queryFn: async () => {
      const raw = await getSpins(rigAddress!, limit);
      return raw.map((s: SubgraphSpin): SpinEvent => ({
        spinner: s.spinner.id,
        price: BigInt(Math.floor(parseFloat(s.price) * 1e6)),
        uri: s.uri || "",
        won: s.won,
        winAmount: BigInt(Math.floor(parseFloat(s.winAmount) * 1e18)),
        oddsBps: BigInt(s.oddsBps),
        timestamp: BigInt(s.timestamp),
        txHash: s.txHash,
      }));
    },
    enabled: !!rigAddress,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  return { spins: data ?? [], isLoading, refetch };
}
