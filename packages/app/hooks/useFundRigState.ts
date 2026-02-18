import { useReadContract } from "wagmi";
import { base } from "wagmi/chains";
import { zeroAddress } from "viem";
import {
  CONTRACT_ADDRESSES,
  FUND_MULTICALL_ABI,
  type FundRigState,
  type ClaimableEpoch,
} from "@/lib/contracts";

export function useFundRigState(
  rigAddress: `0x${string}` | undefined,
  account: `0x${string}` | undefined,
  enabled: boolean = true,
) {
  const multicallAddr = CONTRACT_ADDRESSES.fundMulticall as `0x${string}`;

  const { data: rawState, refetch, isLoading } = useReadContract({
    address: multicallAddr,
    abi: FUND_MULTICALL_ABI,
    functionName: "getRig",
    args: rigAddress ? [rigAddress, account ?? zeroAddress] : undefined,
    chainId: base.id,
    query: {
      enabled: !!rigAddress && enabled,
      refetchInterval: 15_000,
    },
  });

  const fundState = rawState as FundRigState | undefined;
  const currentEpoch = fundState?.currentEpoch ?? 0n;

  // Fetch claimable epochs (from epoch 0 to currentEpoch)
  const { data: rawClaimable } = useReadContract({
    address: multicallAddr,
    abi: FUND_MULTICALL_ABI,
    functionName: "getClaimableEpochs",
    args: rigAddress && account
      ? [rigAddress, account, 0n, currentEpoch]
      : undefined,
    chainId: base.id,
    query: {
      enabled: !!rigAddress && !!account && currentEpoch > 0n && enabled,
      refetchInterval: 30_000,
    },
  });

  // Fetch total pending rewards
  const { data: rawPending } = useReadContract({
    address: multicallAddr,
    abi: FUND_MULTICALL_ABI,
    functionName: "getTotalPendingRewards",
    args: rigAddress && account
      ? [rigAddress, account, 0n, currentEpoch]
      : undefined,
    chainId: base.id,
    query: {
      enabled: !!rigAddress && !!account && currentEpoch > 0n && enabled,
      refetchInterval: 30_000,
    },
  });

  const claimableEpochs = (rawClaimable as ClaimableEpoch[] | undefined)
    ?.filter(d => !d.hasClaimed && d.pendingReward > 0n) ?? [];

  // rawPending is a tuple: [totalPending, unclaimedDays[]]
  const totalPending = rawPending
    ? (rawPending as [bigint, bigint[]])[0]
    : 0n;

  return {
    fundState,
    claimableEpochs,
    totalPending,
    refetch,
    isLoading,
  };
}
