import { useQuery } from "@tanstack/react-query";
import { getDonations, type SubgraphDonation } from "@/lib/subgraph-launchpad";

export type DonationEvent = {
  donor: string;
  day: bigint;
  amount: bigint;           // USDC 6 decimals
  recipientAmount: bigint;  // USDC 6 decimals
  timestamp: bigint;
  txHash: string;
};

export function useFundHistory(
  rigAddress: string | undefined,
  limit: number = 20,
) {
  const { data, isLoading } = useQuery({
    queryKey: ["fundHistory", rigAddress, limit],
    queryFn: async () => {
      const raw = await getDonations(rigAddress!, limit);
      return raw.map((d: SubgraphDonation): DonationEvent => ({
        donor: d.donor.id,
        day: BigInt(d.day),
        amount: BigInt(Math.floor(parseFloat(d.amount) * 1e6)),
        recipientAmount: BigInt(Math.floor(parseFloat(d.recipientAmount) * 1e6)),
        timestamp: BigInt(d.timestamp),
        txHash: d.txHash,
      }));
    },
    enabled: !!rigAddress,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  return { donations: data ?? [], isLoading };
}
