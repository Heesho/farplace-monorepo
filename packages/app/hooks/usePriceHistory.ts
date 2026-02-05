import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getUnitHourData, getUnitDayData, type SubgraphUnitCandle } from "@/lib/subgraph-launchpad";

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
        intervalSeconds: 180, // 3 min intervals for 1H (20 points)
      };
    case "1D":
      return {
        sinceTimestamp: now - 86400,
        refetchInterval: 30_000,
        intervalSeconds: 3600, // 1 hour intervals for 1D (24 points)
      };
    case "1W":
      return {
        sinceTimestamp: now - 7 * 86400,
        refetchInterval: 60_000,
        intervalSeconds: 21600, // 6 hour intervals for 1W (28 points)
      };
    case "1M":
      return {
        sinceTimestamp: now - 30 * 86400,
        refetchInterval: 60_000,
        intervalSeconds: 86400, // 1 day intervals for 1M (30 points)
      };
    case "ALL":
      return {
        sinceTimestamp: 0,
        refetchInterval: 60_000,
        intervalSeconds: 86400, // 1 day intervals
      };
  }
}

// ---------------------------------------------------------------------------
// Fill in missing data points with last known price
// ---------------------------------------------------------------------------

function fillChartData(
  candles: ChartDataPoint[],
  timeframe: Timeframe,
  currentPrice: number,
  createdAt?: number,
): ChartDataPoint[] {
  const config = getTimeframeConfig(timeframe);
  const rawNow = Math.floor(Date.now() / 1000);
  // Round "now" to the interval to prevent constant small shifts
  const now = Math.floor(rawNow / config.intervalSeconds) * config.intervalSeconds;

  // For "ALL" timeframe, use createdAt as start if available
  const startTimestamp = timeframe === "ALL" && createdAt
    ? Math.max(createdAt, rawNow - 365 * 86400) // Cap at 1 year
    : Math.floor(config.sinceTimestamp / config.intervalSeconds) * config.intervalSeconds;

  // Create a map of existing data points by rounded timestamp
  const dataMap = new Map<number, number>();
  candles.forEach(c => {
    const ts = Math.floor(new Date(c.time).getTime() / 1000);
    const roundedTs = Math.floor(ts / config.intervalSeconds) * config.intervalSeconds;
    dataMap.set(roundedTs, c.price);
  });

  // Generate all time points we need
  const result: ChartDataPoint[] = [];

  // If we have candle data, use the earliest price as starting point
  // Otherwise use current price for a flat line
  let lastPrice = candles.length > 0 ? candles[0].price : currentPrice;

  for (let ts = startTimestamp; ts <= now; ts += config.intervalSeconds) {
    const roundedTs = Math.floor(ts / config.intervalSeconds) * config.intervalSeconds;

    if (dataMap.has(roundedTs)) {
      lastPrice = dataMap.get(roundedTs)!;
    }

    result.push({
      time: new Date(roundedTs * 1000).toISOString(),
      price: lastPrice,
    });
  }

  // If we still have no data points, create a flat line with current price
  if (result.length === 0) {
    const numPoints = 20;
    const intervalMs = (now - startTimestamp) * 1000 / numPoints;
    for (let i = 0; i < numPoints; i++) {
      result.push({
        time: new Date(startTimestamp * 1000 + i * intervalMs).toISOString(),
        price: currentPrice,
      });
    }
  }

  // Only update last point to current price if we have actual candle data
  // This keeps the line connected to where trading actually happened
  if (result.length > 0 && candles.length > 0) {
    result[result.length - 1].price = currentPrice;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Fetch price history from LP candle data (works for all rig types)
// ---------------------------------------------------------------------------

async function fetchCandlePriceHistory(
  unitAddress: string,
  timeframe: Timeframe,
): Promise<ChartDataPoint[]> {
  const config = getTimeframeConfig(timeframe);

  // Use hourly data for short timeframes, daily for longer ones
  const useHourly = timeframe === "1H" || timeframe === "1D";

  const candles = useHourly
    ? await getUnitHourData(unitAddress, config.sinceTimestamp)
    : await getUnitDayData(unitAddress, config.sinceTimestamp);

  if (!candles || candles.length === 0) return [];

  return candles.map((c: SubgraphUnitCandle) => ({
    time: new Date(parseInt(c.timestamp) * 1000).toISOString(),
    price: parseFloat(c.close),
  }));
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePriceHistory(
  rigAddress: string,
  timeframe: Timeframe,
  unitAddress?: string,
  currentPrice: number = 0,
  createdAt?: number,
): { data: ChartDataPoint[]; isLoading: boolean } {
  const config = getTimeframeConfig(timeframe);

  const { data: rawData, isLoading } = useQuery({
    queryKey: ["priceHistory", rigAddress, timeframe, unitAddress],
    queryFn: () =>
      unitAddress
        ? fetchCandlePriceHistory(unitAddress.toLowerCase(), timeframe)
        : Promise.resolve([]),
    enabled: !!rigAddress && !!unitAddress,
    staleTime: config.refetchInterval,
    refetchInterval: config.refetchInterval,
    placeholderData: (previousData) => previousData,
  });

  // Fill in missing data points with last known price
  // Memoize to prevent recalculating on every render
  // Round currentPrice to prevent tiny floating point changes from causing recalcs
  const roundedPrice = Math.round(currentPrice * 1e6) / 1e6;
  const filledData = useMemo(
    () => fillChartData(rawData ?? [], timeframe, roundedPrice, createdAt),
    [rawData, timeframe, roundedPrice, createdAt]
  );

  return {
    data: filledData,
    isLoading,
  };
}
