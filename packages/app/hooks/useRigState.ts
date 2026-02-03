import { useReadContract } from "wagmi";
import { base } from "wagmi/chains";
import { zeroAddress } from "viem";
import {
  CONTRACT_ADDRESSES,
  MULTICALL_ABI,
  CORE_ABI,
  RIG_ABI,
  ERC20_ABI,
  type RigType,
  type RigState,
} from "@/lib/contracts";

export type RigInfo = {
  address: `0x${string}`;
  unitAddress: `0x${string}`;
  auctionAddress: `0x${string}`;
  lpAddress: `0x${string}`;
  quoteAddress: `0x${string}`;
  launcher: `0x${string}`;
  tokenName: string;
  tokenSymbol: string;
};

export function useRigState(
  rigAddress: `0x${string}` | undefined,
  account: `0x${string}` | undefined,
  slotIndex: bigint = 0n, // Default to slot 0 for single-slot rigs
  multicallAddress?: `0x${string}`,
  enabled: boolean = true,
) {
  const { data: rawRigState, refetch, isLoading, error } = useReadContract({
    address: multicallAddress ?? CONTRACT_ADDRESSES.multicall as `0x${string}`,
    abi: MULTICALL_ABI,
    functionName: "getRig",
    args: rigAddress ? [rigAddress, slotIndex, account ?? zeroAddress] : undefined,
    chainId: base.id,
    query: {
      enabled: !!rigAddress && enabled,
      refetchInterval: 15_000,
      refetchOnWindowFocus: false,
    },
  });

  const rigState = rawRigState as RigState | undefined;

  return {
    rigState,
    refetch,
    isLoading,
    error,
  };
}

export function useRigInfo(
  rigAddress: `0x${string}` | undefined,
  coreAddress?: `0x${string}`,
  rigType?: RigType,
) {
  const resolvedCore = coreAddress ?? CONTRACT_ADDRESSES.core as `0x${string}`;
  const hasRigType = !!rigType;

  // Get unit token address from rig contract
  const { data: unitAddress } = useReadContract({
    address: rigAddress,
    abi: RIG_ABI,
    functionName: "unit",
    chainId: base.id,
    query: {
      enabled: !!rigAddress,
    },
  });

  // Get quote token address from rig contract
  const { data: quoteAddress } = useReadContract({
    address: rigAddress,
    abi: RIG_ABI,
    functionName: "quote",
    chainId: base.id,
    query: {
      enabled: !!rigAddress && hasRigType && rigType !== "fund",
    },
  });

  // Fund rigs use paymentToken instead of quote
  const { data: paymentTokenAddress } = useReadContract({
    address: rigAddress,
    abi: [
      {
        inputs: [],
        name: "paymentToken",
        outputs: [{ internalType: "address", name: "", type: "address" }],
        stateMutability: "view",
        type: "function",
      },
    ] as const,
    functionName: "paymentToken",
    chainId: base.id,
    query: {
      enabled: !!rigAddress && hasRigType && rigType === "fund",
    },
  });

  // Get auction address from Core
  const { data: auctionAddress } = useReadContract({
    address: resolvedCore,
    abi: CORE_ABI,
    functionName: "rigToAuction",
    args: rigAddress ? [rigAddress] : undefined,
    chainId: base.id,
    query: {
      enabled: !!rigAddress,
    },
  });

  // Get LP token address from Core
  const { data: lpAddress } = useReadContract({
    address: resolvedCore,
    abi: CORE_ABI,
    functionName: "rigToLP",
    args: rigAddress ? [rigAddress] : undefined,
    chainId: base.id,
    query: {
      enabled: !!rigAddress,
    },
  });

  // Get owner (launcher) from rig contract
  const { data: launcher } = useReadContract({
    address: rigAddress,
    abi: [
      {
        inputs: [],
        name: "owner",
        outputs: [{ internalType: "address", name: "", type: "address" }],
        stateMutability: "view",
        type: "function",
      },
    ] as const,
    functionName: "owner",
    chainId: base.id,
    query: {
      enabled: !!rigAddress,
    },
  });

  // Get token name
  const { data: tokenName } = useReadContract({
    address: unitAddress as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "name",
    chainId: base.id,
    query: {
      enabled: !!unitAddress,
    },
  });

  // Get token symbol
  const { data: tokenSymbol } = useReadContract({
    address: unitAddress as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "symbol",
    chainId: base.id,
    query: {
      enabled: !!unitAddress,
    },
  });

  const rigInfo: RigInfo | undefined =
    rigAddress && unitAddress && auctionAddress && lpAddress && launcher
      ? {
          address: rigAddress,
          unitAddress: unitAddress as `0x${string}`,
          auctionAddress: auctionAddress as `0x${string}`,
          lpAddress: lpAddress as `0x${string}`,
          quoteAddress: (paymentTokenAddress as `0x${string}`) ?? (quoteAddress as `0x${string}`) ?? CONTRACT_ADDRESSES.usdc,
          launcher: launcher as `0x${string}`,
          tokenName: (tokenName as string) ?? "",
          tokenSymbol: (tokenSymbol as string) ?? "",
        }
      : undefined;

  return {
    rigInfo,
    isLoading: !rigInfo && !!rigAddress,
  };
}
