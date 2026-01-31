import { useQuery } from "@tanstack/react-query";
import { getEpochs, type SubgraphEpoch } from "@/lib/subgraph-launchpad";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Timeframe = "1H" | "1D" | "1W" | "1M" | "ALL";

type ChartDataPoint = { time: string; price: number };

// ---------------------------------------------------------------------------
// Timeframe configuration
// ---------------------------------------------------------------------------

function getTimeframeConfig(timeframe: Timeframe) {
  const now = Math.floor(Date.now() / 1000);

  switch (timeframe) {
    case "1H":
      return {
        sinceTimestamp: now - 3600,
        refetchInterval: 30_000,
      };
    case "1D":
      return {
        sinceTimestamp: now - 86400,
        refetchInterval: 30_000,
      };
    case "1W":
      return {
        sinceTimestamp: now - 7 * 86400,
        refetchInterval: 60_000,
      };
    case "1M":
      return {
        sinceTimestamp: now - 30 * 86400,
        refetchInterval: 60_000,
      };
    case "ALL":
      return {
        sinceTimestamp: 0,
        refetchInterval: 60_000,
      };
  }
}

// ---------------------------------------------------------------------------
// Fetch price history from epochs (mining cost over time)
// ---------------------------------------------------------------------------

async function fetchPriceHistory(
  rigAddress: string,
  timeframe: Timeframe,
): Promise<ChartDataPoint[]> {
  const config = getTimeframeConfig(timeframe);

  // Fetch all available epochs (up to 1000)
  const epochs = await getEpochs(rigAddress, 1000, 0);

  if (!epochs || epochs.length === 0) return [];

  // Epochs come in desc order (newest first) — reverse to chronological
  const sorted = [...epochs].reverse();

  // Filter by timeframe
  const filtered =
    config.sinceTimestamp > 0
      ? sorted.filter((e) => parseInt(e.startTime) >= config.sinceTimestamp)
      : sorted;

  if (filtered.length === 0) return [];

  return filtered.map((epoch: SubgraphEpoch) => ({
    time: new Date(parseInt(epoch.startTime) * 1000).toISOString(),
    price: parseFloat(epoch.spent),
  }));
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePriceHistory(
  rigAddress: string,
  timeframe: Timeframe,
): { data: ChartDataPoint[]; isLoading: boolean } {
  const config = getTimeframeConfig(timeframe);

  const { data, isLoading } = useQuery({
    queryKey: ["priceHistory", rigAddress, timeframe],
    queryFn: () => fetchPriceHistory(rigAddress.toLowerCase(), timeframe),
    enabled: !!rigAddress,
    staleTime: config.refetchInterval,
    refetchInterval: config.refetchInterval,
    placeholderData: (previousData) => previousData,
  });

  return {
    data: data ?? [],
    isLoading,
  };
}
