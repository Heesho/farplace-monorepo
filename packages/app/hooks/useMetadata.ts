"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ipfsToHttp } from "@/lib/constants";

export type TokenMetadata = {
  image?: string;
  description?: string;
  defaultMessage?: string;
  recipientName?: string;
  links?: string[];
  // Legacy format support
  website?: string;
  twitter?: string;
  telegram?: string;
  discord?: string;
};

const METADATA_STALE_TIME = 30 * 60 * 1000; // 30 minutes - metadata rarely changes

/**
 * Fetch and cache token metadata from IPFS
 * Uses React Query for caching and deduplication
 */
async function fetchMetadata(rigUri: string): Promise<TokenMetadata | null> {
  if (!rigUri || rigUri === "") return null;

  const metadataUrl = ipfsToHttp(rigUri);
  if (!metadataUrl || metadataUrl === "") return null;

  try {
    const response = await fetch(metadataUrl);
    if (!response.ok) {
      console.warn(`[useMetadata] Failed to fetch metadata from ${metadataUrl}: ${response.status}`);
      return null;
    }
    const data = await response.json();
    // Log if metadata is missing image
    if (!data.image) {
      console.warn(`[useMetadata] Metadata has no image field:`, rigUri, data);
    }
    return data;
  } catch (error) {
    console.warn(`[useMetadata] Error fetching metadata from ${metadataUrl}:`, error);
    return null;
  }
}

/**
 * Hook for fetching token metadata with caching
 */
export function useTokenMetadata(rigUri: string | undefined) {
  const validUri = rigUri && rigUri.length > 0 && rigUri.startsWith("ipfs://");

  const { data: metadata, isLoading } = useQuery({
    queryKey: ["tokenMetadata", rigUri],
    queryFn: () => fetchMetadata(rigUri!),
    enabled: !!validUri,
    staleTime: METADATA_STALE_TIME,
    gcTime: 60 * 60 * 1000, // Keep in cache for 1 hour
    retry: 2, // Retry twice on failure
    retryDelay: 1000, // Wait 1 second between retries
  });

  const logoUrl = metadata?.image ? ipfsToHttp(metadata.image) : null;

  return {
    metadata,
    logoUrl,
    isLoading: validUri ? isLoading : false,
  };
}

/**
 * Hook to prefetch metadata for multiple rigs at once
 * Call this when you have a list of rigs to prefetch their metadata
 */
export function usePrefetchMetadata() {
  const queryClient = useQueryClient();

  // Memoize the prefetch function to prevent useEffect loops
  const prefetch = useCallback((rigUris: string[]) => {
    const uniqueUris = [...new Set(rigUris.filter((uri) => uri && uri.startsWith("ipfs://")))];

    uniqueUris.forEach((rigUri) => {
      queryClient.prefetchQuery({
        queryKey: ["tokenMetadata", rigUri],
        queryFn: () => fetchMetadata(rigUri),
        staleTime: METADATA_STALE_TIME,
      });
    });
  }, [queryClient]);

  return prefetch;
}

/**
 * Batch fetch metadata for multiple rigs
 * Returns a map of rigUri -> metadata
 */
export function useBatchMetadata(rigUris: string[]) {
  const uniqueUris = [...new Set(rigUris.filter(Boolean))];

  const { data: metadataMap, isLoading } = useQuery({
    queryKey: ["batchMetadata", uniqueUris.sort().join(",")],
    queryFn: async () => {
      const results = await Promise.all(
        uniqueUris.map(async (uri) => {
          const metadata = await fetchMetadata(uri);
          return [uri, metadata] as const;
        })
      );
      return Object.fromEntries(results) as Record<string, TokenMetadata | null>;
    },
    enabled: uniqueUris.length > 0,
    staleTime: METADATA_STALE_TIME,
    gcTime: 60 * 60 * 1000,
  });

  return {
    metadataMap: metadataMap ?? {},
    isLoading,
    getLogoUrl: (rigUri: string) => {
      const metadata = metadataMap?.[rigUri];
      return metadata?.image ? ipfsToHttp(metadata.image) : null;
    },
  };
}
