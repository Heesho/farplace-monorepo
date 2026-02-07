import { useReadContract } from "wagmi";
import { CONTRACT_ADDRESSES, UNIV2_ROUTER_ABI } from "@/lib/contracts";

// ---------------------------------------------------------------------------
// Hook — reads getAmountsOut from the Uniswap V2 Router directly
// ---------------------------------------------------------------------------

export function useSwapQuote({
  sellToken,
  buyToken,
  sellAmountWei,
  enabled = true,
}: {
  sellToken: `0x${string}`;
  buyToken: `0x${string}`;
  sellAmountWei: bigint;
  enabled?: boolean;
}) {
  const {
    data: amounts,
    isLoading,
    error,
  } = useReadContract({
    address: CONTRACT_ADDRESSES.uniV2Router as `0x${string}`,
    abi: UNIV2_ROUTER_ABI,
    functionName: "getAmountsOut",
    args: [sellAmountWei, [sellToken, buyToken]],
    query: {
      enabled: enabled && sellAmountWei > 0n,
      refetchInterval: 10_000,
      staleTime: 5_000,
    },
  });

  const buyAmountWei = amounts ? amounts[1] : undefined;

  return { data: buyAmountWei ?? null, isLoading, error };
}
