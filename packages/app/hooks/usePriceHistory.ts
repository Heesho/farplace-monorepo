import { useQuery } from "@tanstack/react-query";
import { SUBGRAPH_URL } from "./subgraph";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Timeframe = "1H" | "1D" | "1W" | "1M" | "ALL";

type ChartDataPoint = { time: string; price: number };

// ---------------------------------------------------------------------------
// Timeframe configuration
// ---------------------------------------------------------------------------

/** Map each timeframe to: seconds lookback, data point limit, and polling interval. */
function getTimeframeConfig(timeframe: Timeframe) {
  const now = Math.floor(Date.now() / 1000);

  switch (timeframe) {
    case "1H":
      return {
        sinceTimestamp: now - 3600,
        first: 60,
        refetchInterval: 30_000,
      };
    case "1D":
      return {
        sinceTimestamp: now - 86400,
        first: 96,
        refetchInterval: 30_000,
      };
    case "1W":
      return {
        sinceTimestamp: now - 7 * 86400,
        first: 168,
        refetchInterval: 60_000,
      };
    case "1M":
      return {
        sinceTimestamp: now - 30 * 86400,
        first: 200,
        refetchInterval: 60_000,
      };
    case "ALL":
      return {
        sinceTimestamp: 0,
        first: 500,
        refetchInterval: 60_000,
      };
  }
}

// ---------------------------------------------------------------------------
// Subgraph query helpers
// ---------------------------------------------------------------------------

async function querySubgraph<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Subgraph request failed: ${res.status}`);
  }

  const json = await res.json();

  if (json.errors) {
    throw new Error(json.errors[0]?.message ?? "Subgraph query error");
  }

  return json.data as T;
}

// ---------------------------------------------------------------------------
// Query: Try OHLCV candle entities first (rigHourData / rigDayData)
// These are common patterns in Goldsky / Graph Protocol subgraphs.
// ---------------------------------------------------------------------------

const CANDLE_HOUR_QUERY = `
  query GetRigHourData($rigAddress: String!, $sinceTimestamp: BigInt!, $first: Int!) {
    rigHourDatas(
      where: { rig: $rigAddress, periodStartUnix_gte: $sinceTimestamp }
      orderBy: periodStartUnix
      orderDirection: asc
      first: $first
    ) {
      periodStartUnix
      close
    }
  }
`;

const CANDLE_DAY_QUERY = `
  query GetRigDayData($rigAddress: String!, $sinceTimestamp: BigInt!, $first: Int!) {
    rigDayDatas(
      where: { rig: $rigAddress, periodStartUnix_gte: $sinceTimestamp }
      orderBy: periodStartUnix
      orderDirection: asc
      first: $first
    ) {
      periodStartUnix
      close
    }
  }
`;

type CandleData = {
  periodStartUnix: string;
  close: string;
};

type HourDataResponse = { rigHourDatas: CandleData[] };
type DayDataResponse = { rigDayDatas: CandleData[] };

// ---------------------------------------------------------------------------
// Query: Fallback to mine events (the subgraph definitely has these)
// Mine events record when a miner takes a slot, including the price paid.
// ---------------------------------------------------------------------------

const MINE_EVENTS_QUERY = `
  query GetMineEvents($rigAddress: String!, $sinceTimestamp: BigInt!, $first: Int!) {
    mineEvents(
      where: { rig: $rigAddress, timestamp_gte: $sinceTimestamp }
      orderBy: timestamp
      orderDirection: asc
      first: $first
    ) {
      timestamp
      price
    }
  }
`;

type MineEvent = {
  timestamp: string;
  price: string;
};

type MineEventsResponse = { mineEvents: MineEvent[] };

// ---------------------------------------------------------------------------
// Query: Another fallback -- epochs on the rig entity
// ---------------------------------------------------------------------------

const EPOCHS_QUERY = `
  query GetRigEpochs($rigAddress: ID!, $first: Int!) {
    rig(id: $rigAddress) {
      epochs(
        orderBy: startTime
        orderDirection: desc
        first: $first
      ) {
        startTime
        price
      }
    }
  }
`;

type EpochData = {
  startTime: string;
  price: string;
};

type EpochsResponse = {
  rig: {
    epochs: EpochData[];
  } | null;
};

// ---------------------------------------------------------------------------
// Fetch price history with cascading fallbacks
// ---------------------------------------------------------------------------

async function fetchPriceHistory(
  rigAddress: string,
  timeframe: Timeframe
): Promise<ChartDataPoint[]> {
  const config = getTimeframeConfig(timeframe);
  const sinceTimestamp = config.sinceTimestamp.toString();

  // ---- Strategy 1: Try hourly candles (best for 1H, 1D, 1W) ----
  if (timeframe === "1H" || timeframe === "1D" || timeframe === "1W") {
    try {
      const data = await querySubgraph<HourDataResponse>(CANDLE_HOUR_QUERY, {
        rigAddress,
        sinceTimestamp,
        first: config.first,
      });

      if (data.rigHourDatas && data.rigHourDatas.length > 0) {
        return data.rigHourDatas.map((candle) => ({
          time: new Date(Number(candle.periodStartUnix) * 1000).toISOString(),
          price: Number(candle.close),
        }));
      }
    } catch {
      // Entity may not exist -- fall through to next strategy
    }
  }

  // ---- Strategy 2: Try daily candles (best for 1M, ALL) ----
  if (timeframe === "1M" || timeframe === "ALL" || timeframe === "1W") {
    try {
      const data = await querySubgraph<DayDataResponse>(CANDLE_DAY_QUERY, {
        rigAddress,
        sinceTimestamp,
        first: config.first,
      });

      if (data.rigDayDatas && data.rigDayDatas.length > 0) {
        return data.rigDayDatas.map((candle) => ({
          time: new Date(Number(candle.periodStartUnix) * 1000).toISOString(),
          price: Number(candle.close),
        }));
      }
    } catch {
      // Entity may not exist -- fall through to next strategy
    }
  }

  // ---- Strategy 3: Fall back to mine events ----
  try {
    const data = await querySubgraph<MineEventsResponse>(MINE_EVENTS_QUERY, {
      rigAddress,
      sinceTimestamp,
      first: config.first,
    });

    if (data.mineEvents && data.mineEvents.length > 0) {
      return data.mineEvents.map((mine) => ({
        time: new Date(Number(mine.timestamp) * 1000).toISOString(),
        // Price is in USDC (6 decimals) raw value - normalize to human-readable
        price: Number(mine.price) / 1e6,
      }));
    }
  } catch {
    // Fall through to epoch strategy
  }

  // ---- Strategy 4: Fall back to rig epochs ----
  try {
    const data = await querySubgraph<EpochsResponse>(EPOCHS_QUERY, {
      rigAddress,
      first: config.first,
    });

    if (data.rig?.epochs && data.rig.epochs.length > 0) {
      // Epochs come in desc order, reverse to chronological
      const sorted = [...data.rig.epochs].reverse();

      // Filter by sinceTimestamp if needed
      const filtered =
        config.sinceTimestamp > 0
          ? sorted.filter(
              (e) => Number(e.startTime) >= config.sinceTimestamp
            )
          : sorted;

      if (filtered.length > 0) {
        return filtered.map((epoch) => ({
          time: new Date(Number(epoch.startTime) * 1000).toISOString(),
          // Price is in USDC (6 decimals) raw value - normalize to human-readable
          price: Number(epoch.price) / 1e6,
        }));
      }
    }
  } catch {
    // All strategies failed
  }

  return [];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePriceHistory(
  rigAddress: string,
  timeframe: Timeframe
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
