import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getBatchSparklineData, getBatchSparklineMinuteData } from "@/lib/subgraph-launchpad";

type SparklineResult = {
  getSparkline: (unitAddress: string, currentPrice?: number) => number[];
  isLoading: boolean;
};

export function useSparklineData(unitAddresses: string[]): SparklineResult {
  const sortedKey = useMemo(
    () => [...unitAddresses].sort().join(","),
    [unitAddresses]
  );

  // Hourly data (7 days) — primary source
  const { data: hourlyMap, isLoading: isHourlyLoading } = useQuery({
    queryKey: ["batchSparklines", sortedKey],
    queryFn: () => getBatchSparklineData(unitAddresses),
    enabled: unitAddresses.length > 0,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  // Minute data (4 hours) — fallback for new tokens without hourly candles
  const { data: minuteMap, isLoading: isMinuteLoading } = useQuery({
    queryKey: ["batchSparklinesMinute", sortedKey],
    queryFn: () => getBatchSparklineMinuteData(unitAddresses),
    enabled: unitAddresses.length > 0,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const getSparkline = useMemo(() => {
    return (unitAddress: string, currentPrice: number = 0): number[] => {
      const key = unitAddress.toLowerCase();
      const hourly = hourlyMap?.get(key);
      const minute = minuteMap?.get(key);

      // Prefer hourly if we have multiple points, otherwise use minute data
      const data = (hourly && hourly.length >= 2) ? hourly : (minute && minute.length >= 2) ? minute : hourly ?? minute;

      if (!data || data.length === 0) return [];

      // Downsample to ~24 points for the sparkline
      const targetPoints = 24;
      const prices = data.map((d) => d.price);

      let sampled: number[];
      if (prices.length <= targetPoints) {
        sampled = prices;
      } else {
        sampled = [];
        for (let i = 0; i < targetPoints; i++) {
          const idx = Math.floor((i / (targetPoints - 1)) * (prices.length - 1));
          sampled.push(prices[idx]);
        }
      }

      // Append current price as latest point
      if (currentPrice > 0) {
        sampled.push(currentPrice);
      }

      return sampled;
    };
  }, [hourlyMap, minuteMap]);

  return {
    getSparkline,
    isLoading: isHourlyLoading || isMinuteLoading,
  };
}
