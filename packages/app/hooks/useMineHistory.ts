import { useQuery } from "@tanstack/react-query";
import { SUBGRAPH_URL } from "./subgraph";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MineEvent = {
  miner: string;
  price: bigint;
  minted: bigint;
  timestamp: bigint;
};

// ---------------------------------------------------------------------------
// GraphQL
// ---------------------------------------------------------------------------

const MINE_HISTORY_QUERY = `
  query GetMineHistory($rigAddress: String!, $first: Int!) {
    mineEvents(
      where: { rig: $rigAddress }
      orderBy: timestamp
      orderDirection: desc
      first: $first
    ) {
      miner
      price
      minted
      timestamp
    }
  }
`;

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

type RawMineEvent = {
  miner: string;
  price: string;
  minted: string;
  timestamp: string;
};

async function fetchMineHistory(
  rigAddress: string,
  limit: number,
): Promise<MineEvent[]> {
  const res = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: MINE_HISTORY_QUERY,
      variables: {
        rigAddress: rigAddress.toLowerCase(),
        first: limit,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Subgraph request failed: ${res.status}`);
  }

  const json = await res.json();

  if (json.errors) {
    throw new Error(json.errors[0]?.message ?? "Subgraph query error");
  }

  const raw: RawMineEvent[] = json.data?.mineEvents ?? [];

  return raw.map((event) => ({
    miner: event.miner,
    price: BigInt(event.price),
    minted: BigInt(event.minted),
    timestamp: BigInt(event.timestamp),
  }));
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMineHistory(
  rigAddress: string | undefined,
  limit: number = 10,
): {
  mines: MineEvent[] | undefined;
  isLoading: boolean;
} {
  const { data: mines, isLoading } = useQuery({
    queryKey: ["mineHistory", rigAddress, limit],
    queryFn: () => fetchMineHistory(rigAddress!, limit),
    enabled: !!rigAddress,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  return {
    mines,
    isLoading,
  };
}
