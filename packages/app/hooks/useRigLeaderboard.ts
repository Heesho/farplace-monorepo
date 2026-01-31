import { useQuery } from "@tanstack/react-query";
import { SUBGRAPH_URL } from "./subgraph";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LeaderboardEntry = {
  miner: string;
  mined: bigint;
  earned: bigint;
};

// ---------------------------------------------------------------------------
// GraphQL
// ---------------------------------------------------------------------------

const LEADERBOARD_QUERY = `
  query GetRigLeaderboard($rigAddress: String!, $first: Int!) {
    rigAccounts(
      where: { rig: $rigAddress }
      orderBy: mined
      orderDirection: desc
      first: $first
    ) {
      account
      mined
      earned
    }
  }
`;

/**
 * Separate query to find the user's rank – we need their position across
 * ALL participants, not just the top `limit`. We fetch all participants
 * ordered by `mined` descending and find the user's index.
 */
const USER_RANK_QUERY = `
  query GetUserRank($rigAddress: String!) {
    rigAccounts(
      where: { rig: $rigAddress }
      orderBy: mined
      orderDirection: desc
      first: 1000
    ) {
      account
      mined
    }
  }
`;

// ---------------------------------------------------------------------------
// Fetcher helpers
// ---------------------------------------------------------------------------

type RawLeaderboardEntry = {
  account: string;
  mined: string;
  earned: string;
};

async function fetchLeaderboard(
  rigAddress: string,
  limit: number,
): Promise<LeaderboardEntry[]> {
  const res = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: LEADERBOARD_QUERY,
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

  const raw: RawLeaderboardEntry[] = json.data?.rigAccounts ?? [];

  return raw.map((entry) => ({
    miner: entry.account,
    mined: BigInt(entry.mined),
    earned: BigInt(entry.earned),
  }));
}

async function fetchUserRank(
  rigAddress: string,
  account: string,
): Promise<number | undefined> {
  const res = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: USER_RANK_QUERY,
      variables: {
        rigAddress: rigAddress.toLowerCase(),
      },
    }),
  });

  if (!res.ok) return undefined;

  const json = await res.json();
  if (json.errors) return undefined;

  const raw: { account: string; mined: string }[] =
    json.data?.rigAccounts ?? [];

  const index = raw.findIndex(
    (entry) => entry.account.toLowerCase() === account.toLowerCase(),
  );

  // 1-indexed rank; undefined if not found
  return index >= 0 ? index + 1 : undefined;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useRigLeaderboard(
  rigAddress: string | undefined,
  account: string | undefined,
  limit: number = 10,
): {
  entries: LeaderboardEntry[] | undefined;
  userRank: number | undefined;
  isLoading: boolean;
} {
  const {
    data: entries,
    isLoading: isEntriesLoading,
  } = useQuery({
    queryKey: ["rigLeaderboard", rigAddress, limit],
    queryFn: () => fetchLeaderboard(rigAddress!, limit),
    enabled: !!rigAddress,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const {
    data: userRank,
    isLoading: isRankLoading,
  } = useQuery({
    queryKey: ["rigLeaderboardRank", rigAddress, account],
    queryFn: () => fetchUserRank(rigAddress!, account!),
    enabled: !!rigAddress && !!account,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  return {
    entries,
    userRank,
    isLoading: isEntriesLoading || (!!account && isRankLoading),
  };
}
