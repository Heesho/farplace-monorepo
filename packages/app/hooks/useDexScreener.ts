import { useQuery } from "@tanstack/react-query";
import { useReadContract } from "wagmi";
import { base } from "wagmi/chains";
import { CONTRACT_ADDRESSES, CORE_ABI } from "@/lib/contracts";

export type DexScreenerPair = {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd: string;
  liquidity: {
    usd: number;
    base: number;
    quote: number;
  };
  fdv: number;
  marketCap: number;
  volume: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  priceChange: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
};

async function fetchDexScreenerByPair(pairAddress: string): Promise<DexScreenerPair | null> {
  if (!pairAddress || pairAddress === "0x0000000000000000000000000000000000000000") {
    return null;
  }

  try {
    const response = await fetch(
      `https://api.dexscreener.com/latest/dex/pairs/base/${pairAddress.toLowerCase()}`
    );

    if (!response.ok) return null;

    const json = await response.json();
    const pair = json.pair ?? json.pairs?.[0];
    return pair ? (pair as DexScreenerPair) : null;
  } catch {
    return null;
  }
}

async function fetchDexScreenerByToken(tokenAddress: string): Promise<DexScreenerPair | null> {
  if (!tokenAddress || tokenAddress === "0x0000000000000000000000000000000000000000") {
    return null;
  }

  try {
    const response = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress.toLowerCase()}`
    );

    if (!response.ok) return null;

    const json = await response.json();
    const basePairs = (json.pairs ?? []).filter(
      (p: DexScreenerPair) => p.chainId === "base"
    );

    if (basePairs.length === 0) return null;

    basePairs.sort((a: DexScreenerPair, b: DexScreenerPair) =>
      (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0)
    );

    return basePairs[0] as DexScreenerPair;
  } catch {
    return null;
  }
}

async function fetchDexScreenerData(
  pairAddress: string,
  tokenAddress?: string
): Promise<DexScreenerPair | null> {
  const pairResult = await fetchDexScreenerByPair(pairAddress);
  if (pairResult) return pairResult;
  if (tokenAddress) return fetchDexScreenerByToken(tokenAddress);
  return null;
}

export function useDexScreener(
  rigAddress: `0x${string}` | undefined,
  unitAddress?: `0x${string}`,
  coreAddress?: `0x${string}`,
) {
  // Get LP token address from Core
  const { data: lpAddress, isLoading: isLoadingLp } = useReadContract({
    address: (coreAddress ?? CONTRACT_ADDRESSES.core) as `0x${string}`,
    abi: CORE_ABI,
    functionName: "rigToLP",
    args: rigAddress ? [rigAddress] : undefined,
    chainId: base.id,
    query: {
      enabled: !!rigAddress,
    },
  });

  // Fetch DexScreener data
  const { data: pairData, isLoading: isLoadingPair } = useQuery({
    queryKey: ["dexScreenerPair", lpAddress, unitAddress],
    queryFn: () => fetchDexScreenerData(lpAddress as string, unitAddress),
    enabled: !!lpAddress || !!unitAddress,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
  });

  return {
    pairData: pairData ?? null,
    lpAddress: lpAddress as `0x${string}` | undefined,
    isLoading: isLoadingLp || (!!lpAddress && isLoadingPair),
  };
}
