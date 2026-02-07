import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getUnitHourData, getUnitDayData, type SubgraphUnitCandle } from "@/lib/subgraph-launchpad";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Timeframe = "1H" | "1D" | "1W" | "1M" | "ALL";

export type ChartDataPoint = { time: number; value: number };

// ---------------------------------------------------------------------------
// Timeframe configuration
// ---------------------------------------------------------------------------

function getTimeframeConfig(timeframe: Timeframe, createdAt?: number) {
  const now = Math.floor(Date.now() / 1000);
  const tokenAge = createdAt ? now - createdAt : Infinity;

  switch (timeframe) {
    case "1H":
      return {
        sinceTimestamp: now - 6 * 3600, // Fetch 6 hours of hourly candles
        refetchInterval: 30_000,
        intervalSeconds: 3600, // Match hourly candle granularity
        timeframeSeconds: 3600,
        useHourly: true,
      };
    case "1D":
      return {
        sinceTimestamp: now - 86400,
        refetchInterval: 30_000,
        intervalSeconds: 3600,
        timeframeSeconds: 86400,
        useHourly: true,
      };
    case "1W":
      return {
        sinceTimestamp: now - 7 * 86400,
        refetchInterval: 60_000,
        // Finer intervals for new tokens so trading data isn't collapsed
        intervalSeconds: tokenAge < 86400 ? 3600 : 21600,
        timeframeSeconds: 7 * 86400,
        useHourly: true,
      };
    case "1M":
      return {
        sinceTimestamp: now - 30 * 86400,
        refetchInterval: 60_000,
        // Finer intervals for new tokens so trading data isn't collapsed
        intervalSeconds: tokenAge < 86400 ? 3600 : tokenAge < 7 * 86400 ? 21600 : 86400,
        timeframeSeconds: 30 * 86400,
        useHourly: tokenAge < 7 * 86400,
      };
    case "ALL": {
      // Dynamic interval based on token age
      let intervalSeconds: number;
      let useHourly: boolean;
      if (tokenAge < 3600) {
        intervalSeconds = 180;
        useHourly = true;
      } else if (tokenAge < 86400) {
        intervalSeconds = 900;
        useHourly = true;
      } else if (tokenAge < 7 * 86400) {
        intervalSeconds = 3600;
        useHourly = true;
      } else if (tokenAge < 30 * 86400) {
        intervalSeconds = 21600;
        useHourly = false;
      } else {
        intervalSeconds = 86400;
        useHourly = false;
      }
      return {
        sinceTimestamp: 0,
        refetchInterval: 60_000,
        intervalSeconds,
        timeframeSeconds: Infinity,
        useHourly,
      };
    }
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
  initialPrice?: number,
): ChartDataPoint[] {
  const config = getTimeframeConfig(timeframe, createdAt);
  const rawNow = Math.floor(Date.now() / 1000);
  const now = Math.floor(rawNow / config.intervalSeconds) * config.intervalSeconds;

  // ALL starts at createdAt (no pre-creation data, no baseline)
  // Other timeframes start at their sinceTimestamp (shows baseline for pre-creation period)
  let startTimestamp: number;
  if (timeframe === "ALL" && createdAt) {
    startTimestamp = Math.floor(createdAt / config.intervalSeconds) * config.intervalSeconds;
  } else {
    startTimestamp = Math.floor(config.sinceTimestamp / config.intervalSeconds) * config.intervalSeconds;
  }

  // Create a map of existing data points by rounded timestamp
  const dataMap = new Map<number, number>();
  candles.forEach(c => {
    const roundedTs = Math.floor(c.time / config.intervalSeconds) * config.intervalSeconds;
    dataMap.set(roundedTs, c.value);
  });

  // Generate all time points we need
  const result: ChartDataPoint[] = [];

  // Starting price priority: initial LP price > earliest candle > current price
  let lastPrice = initialPrice && initialPrice > 0
    ? initialPrice
    : candles.length > 0 ? candles[0].value : currentPrice;

  for (let ts = startTimestamp; ts <= now; ts += config.intervalSeconds) {
    const roundedTs = Math.floor(ts / config.intervalSeconds) * config.intervalSeconds;

    if (dataMap.has(roundedTs)) {
      lastPrice = dataMap.get(roundedTs)!;
    }

    result.push({
      time: roundedTs,
      value: lastPrice,
    });
  }

  // Always add a final point at rawNow with currentPrice to ensure
  // there's a post-creation data point (fixes 1M/1W when token is very new
  // and `now` rounds down to before `createdAt`)
  if (currentPrice > 0) {
    const lastTime = result.length > 0 ? result[result.length - 1].time : 0;
    if (rawNow > lastTime) {
      result.push({ time: rawNow, value: currentPrice });
    } else if (result.length > 0 && candles.length > 0) {
      result[result.length - 1].value = currentPrice;
    }
  }

  // If we still have no data points, create a flat line with current price
  if (result.length === 0) {
    const numPoints = 20;
    const interval = Math.max((now - startTimestamp) / numPoints, 1);
    for (let i = 0; i < numPoints; i++) {
      result.push({
        time: Math.floor(startTimestamp + i * interval),
        value: currentPrice,
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Fetch price history from LP candle data (works for all rig types)
// ---------------------------------------------------------------------------

async function fetchCandlePriceHistory(
  unitAddress: string,
  timeframe: Timeframe,
  createdAt?: number,
): Promise<ChartDataPoint[]> {
  const config = getTimeframeConfig(timeframe, createdAt);

  const candles = config.useHourly
    ? await getUnitHourData(unitAddress, config.sinceTimestamp)
    : await getUnitDayData(unitAddress, config.sinceTimestamp);

  if (!candles || candles.length === 0) return [];

  return candles.map((c: SubgraphUnitCandle) => ({
    time: parseInt(c.timestamp),
    value: parseFloat(c.close),
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
  initialPrice?: number,
): { data: ChartDataPoint[]; isLoading: boolean; timeframeSeconds: number } {
  const config = getTimeframeConfig(timeframe, createdAt);

  const { data: rawData, isLoading } = useQuery({
    queryKey: ["priceHistory", rigAddress, timeframe, unitAddress],
    queryFn: () =>
      unitAddress
        ? fetchCandlePriceHistory(unitAddress.toLowerCase(), timeframe, createdAt)
        : Promise.resolve([]),
    enabled: !!rigAddress && !!unitAddress,
    staleTime: config.refetchInterval,
    refetchInterval: config.refetchInterval,
    placeholderData: (previousData) => previousData,
  });

  const roundedPrice = Math.round(currentPrice * 1e6) / 1e6;
  const filledData = useMemo(
    () => fillChartData(rawData ?? [], timeframe, roundedPrice, createdAt, initialPrice),
    [rawData, timeframe, roundedPrice, createdAt, initialPrice]
  );

  return {
    data: filledData,
    isLoading,
    timeframeSeconds: config.timeframeSeconds,
  };
}
