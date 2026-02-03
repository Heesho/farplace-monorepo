import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getUnitsByActivity,
  getUnitsByMarketCap,
  getUnitsByCreatedAt,
  searchRigs,
  type SubgraphUnitListItem,
} from "@/lib/subgraph-launchpad";

export type RigListItem = {
  address: `0x${string}`;         // Rig contract address
  unitAddress: `0x${string}`;     // Unit token address
  lpPairAddress: `0x${string}`;   // LP pair address
  tokenName: string;
  tokenSymbol: string;
  rigType: string;                // "mine", "spin", "fund"
  rigUri: string;
  launcher: `0x${string}`;
  // Market data (from subgraph)
  priceUsd: number;
  change24h: number;
  marketCapUsd: number;
  volume24h: number;           // 24h volume in USDC
  liquidityUsd: number;
  // Subgraph data
  totalMinted: bigint;
  lastActivityAt: number;         // Unix timestamp
  createdAt: number;
};

export type SortOption = "bump" | "top" | "new";

// Hook to get unit list from subgraph with sorting
export function useRigList(sortBy: SortOption = "top", first = 50) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["unitList", sortBy, first],
    queryFn: async () => {
      if (sortBy === "bump") return getUnitsByActivity(first);
      if (sortBy === "top") return getUnitsByMarketCap(first);
      return getUnitsByCreatedAt(first); // "new"
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  return { units: data ?? [], isLoading, error };
}

// Hook to search units by name/symbol
export function useSearchUnits(searchQuery: string) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["searchUnits", searchQuery],
    queryFn: async () => {
      if (!searchQuery || searchQuery.length < 2) return [];
      return searchRigs(searchQuery, 20);
    },
    enabled: searchQuery.length >= 2,
    staleTime: 10_000,
    retry: false,
  });

  return { units: data ?? [], isLoading, error };
}

// Convert SubgraphUnitListItem to RigListItem
function unitToRigListItem(u: SubgraphUnitListItem): RigListItem {
  return {
    address: u.rig.id.toLowerCase() as `0x${string}`,
    unitAddress: u.id.toLowerCase() as `0x${string}`,
    lpPairAddress: (u.lpPair?.toLowerCase() ?? "0x0") as `0x${string}`,
    tokenName: u.name,
    tokenSymbol: u.symbol,
    rigType: u.rig.rigType,
    rigUri: u.rig.uri,
    launcher: u.rig.launcher.id.toLowerCase() as `0x${string}`,
    priceUsd: parseFloat(u.priceUSD) || 0,
    change24h: parseFloat(u.priceChange24h) || 0,
    marketCapUsd: parseFloat(u.marketCapUSD) || 0,
    volume24h: parseFloat(u.volume24h) || 0,
    liquidityUsd: parseFloat(u.liquidityUSD) || 0,
    totalMinted: BigInt(Math.floor(parseFloat(u.totalMinted || "0") * 1e18)),
    lastActivityAt: parseInt(u.lastActivityAt) || 0,
    createdAt: parseInt(u.createdAt) || 0,
  };
}

// Combined hook for explore page
export function useExploreRigs(
  sortBy: SortOption = "top",
  searchQuery = "",
  _account: `0x${string}` | undefined // keep param for compat, not used
) {
  const { units: searchResults, isLoading: isSearchLoading } = useSearchUnits(searchQuery);
  const { units: listUnits, isLoading: isListLoading } = useRigList(sortBy);

  const isSearching = searchQuery.length >= 2;
  const units = isSearching ? searchResults : listUnits;
  const isLoadingUnits = isSearching ? isSearchLoading : isListLoading;

  // Convert subgraph data to RigListItem[]
  const rigs: RigListItem[] = useMemo(() => {
    return units
      .filter(u => !!u.rig)
      .map(unitToRigListItem);
  }, [units]);

  return {
    rigs,
    isLoading: isLoadingUnits,
    isUsingFallback: false,
  };
}
