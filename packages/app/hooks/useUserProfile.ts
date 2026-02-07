import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useReadContracts } from "wagmi";
import { formatEther } from "viem";
import {
  getAccount,
  getAllUnits,
  type SubgraphUnitListItem,
} from "@/lib/subgraph-launchpad";
import { ERC20_ABI } from "@/lib/contracts";
import { DEFAULT_CHAIN_ID } from "@/lib/constants";

export type UserHolding = {
  address: `0x${string}`;       // Rig address
  unitAddress: `0x${string}`;   // Unit token address
  tokenName: string;
  tokenSymbol: string;
  rigType: string;
  rigUri: string;
  balance: bigint;              // Raw token balance (18 decimals)
  balanceNum: number;           // Formatted balance
  priceUsd: number;             // Price per token in USD
  valueUsd: number;             // balance * price
};

export type UserLaunchedRig = {
  address: `0x${string}`;
  tokenName: string;
  tokenSymbol: string;
  rigType: string;
  rigUri: string;
  totalMinted: number;
  unitPrice: number;
  marketCapUsd: number;
};

export function useUserProfile(accountAddress: `0x${string}` | undefined) {
  // Fetch user account data from subgraph
  const {
    data: accountData,
    isLoading: isLoadingAccount,
  } = useQuery({
    queryKey: ["userProfile", accountAddress],
    queryFn: async () => {
      if (!accountAddress) return null;
      return getAccount(accountAddress);
    },
    enabled: !!accountAddress,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  // Fetch all units from subgraph (to know which tokens exist + prices)
  const { data: allUnits, isLoading: isLoadingUnits } = useQuery({
    queryKey: ["allUnits"],
    queryFn: () => getAllUnits(100),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  // Build balanceOf calls for every unit token
  const balanceOfCalls = useMemo(() => {
    if (!accountAddress || !allUnits?.length) return [];
    return allUnits.map((unit) => ({
      address: unit.id.toLowerCase() as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "balanceOf" as const,
      args: [accountAddress] as const,
      chainId: DEFAULT_CHAIN_ID,
    }));
  }, [accountAddress, allUnits]);

  const { data: balanceResults, isLoading: isLoadingBalances } = useReadContracts({
    contracts: balanceOfCalls,
    query: {
      enabled: balanceOfCalls.length > 0,
      staleTime: 15_000,
      refetchInterval: 30_000,
    },
  });

  // Combine balances with unit metadata, filter non-zero, sort by USD value
  const holdings: UserHolding[] = useMemo(() => {
    if (!allUnits?.length || !balanceResults?.length) return [];

    const items: UserHolding[] = [];

    for (let i = 0; i < allUnits.length; i++) {
      const unit = allUnits[i];
      const result = balanceResults[i];
      if (!result || result.status !== "success") continue;

      const balance = result.result as bigint;
      if (balance === 0n) continue;

      const balanceNum = Number(formatEther(balance));
      const priceUsd = parseFloat(unit.priceUSD) || parseFloat(unit.price) || 0;
      const valueUsd = balanceNum * priceUsd;

      items.push({
        address: (unit.rig?.id?.toLowerCase() ?? "0x0") as `0x${string}`,
        unitAddress: unit.id.toLowerCase() as `0x${string}`,
        tokenName: unit.name,
        tokenSymbol: unit.symbol,
        rigType: unit.rig?.rigType ?? "mine",
        rigUri: unit.rig?.uri ?? "",
        balance,
        balanceNum,
        priceUsd,
        valueUsd,
      });
    }

    // Sort by USD value descending
    items.sort((a, b) => b.valueUsd - a.valueUsd);

    return items;
  }, [allUnits, balanceResults]);

  // Launched rigs: filter units where launcher matches account
  const launchedRigs: UserLaunchedRig[] = useMemo(() => {
    if (!allUnits?.length || !accountAddress) return [];

    return allUnits
      .filter((u) => u.rig?.launcher?.id?.toLowerCase() === accountAddress.toLowerCase())
      .map((u) => {
        const totalMinted = parseFloat(u.totalMinted || "0");
        const unitPrice = parseFloat(u.priceUSD) || parseFloat(u.price) || 0;
        const totalSupply = parseFloat(u.totalSupply || "0");
        let marketCapUsd = parseFloat(u.marketCapUSD) || 0;
        if (marketCapUsd === 0 && unitPrice > 0 && totalSupply > 0) {
          marketCapUsd = unitPrice * totalSupply;
        }
        return {
          address: (u.rig?.id?.toLowerCase() ?? "0x0") as `0x${string}`,
          tokenName: u.name,
          tokenSymbol: u.symbol,
          rigType: u.rig?.rigType ?? "mine",
          rigUri: u.rig?.uri ?? "",
          totalMinted,
          unitPrice,
          marketCapUsd,
        };
      })
      .sort((a, b) => b.marketCapUsd - a.marketCapUsd);
  }, [allUnits, accountAddress]);

  const totalHoldingsValueUsd = useMemo(
    () => holdings.reduce((sum, h) => sum + h.valueUsd, 0),
    [holdings]
  );

  const isLoading = isLoadingAccount || isLoadingUnits || isLoadingBalances;

  return {
    accountData,
    holdings,
    launchedRigs,
    totalHoldingsValueUsd,
    isLoading,
  };
}
