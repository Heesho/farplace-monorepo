import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getBatchSparklineData, type SparklineDataPoint } from "@/lib/subgraph-launchpad";

type SparklineResult = {
  getSparkline: (unitAddress: string, currentPrice?: number) => number[];
  isLoading: boolean;
};

export function useSparklineData(unitAddresses: string[]): SparklineResult {
  const { data: sparklineMap, isLoading } = useQuery({
    queryKey: ["batchSparklines", unitAddresses.sort().join(",")],
    queryFn: () => getBatchSparklineData(unitAddresses),
    enabled: unitAddresses.length > 0,
    staleTime: 60_000, // Cache for 1 minute
    refetchInterval: 60_000,
  });

  const getSparkline = useMemo(() => {
    return (unitAddress: string, currentPrice: number = 0): number[] => {
      const data = sparklineMap?.get(unitAddress.toLowerCase());

      if (!data || data.length === 0) {
        // No data - return flat line at current price
        return Array(24).fill(currentPrice);
      }

      // Fill in missing hours with last known price
      const now = Math.floor(Date.now() / 1000);
      const hourAgo24 = now - 86400;
      const hourInterval = 3600;

      const priceMap = new Map<number, number>();
      data.forEach((d) => {
        const roundedTs = Math.floor(d.timestamp / hourInterval) * hourInterval;
        priceMap.set(roundedTs, d.price);
      });

      const result: number[] = [];
      let lastPrice = data[0]?.price ?? currentPrice;

      for (let ts = hourAgo24; ts <= now; ts += hourInterval) {
        const roundedTs = Math.floor(ts / hourInterval) * hourInterval;
        if (priceMap.has(roundedTs)) {
          lastPrice = priceMap.get(roundedTs)!;
        }
        result.push(lastPrice);
      }

      // Update last point to current price if we have data
      if (result.length > 0 && data.length > 0) {
        result[result.length - 1] = currentPrice;
      }

      return result;
    };
  }, [sparklineMap]);

  return {
    getSparkline,
    isLoading,
  };
}
