import { GraphQLClient, gql } from "graphql-request";

// Subgraph URL (Goldsky)
export const LAUNCHPAD_SUBGRAPH_URL =
  process.env.NEXT_PUBLIC_LAUNCHPAD_SUBGRAPH_URL ||
  "https://api.goldsky.com/api/public/project_cmgscxhw81j5601xmhgd42rej/subgraphs/farplace/1.0.0/gn";

const client = new GraphQLClient(LAUNCHPAD_SUBGRAPH_URL);

// =============================================================================
// Types matching the subgraph schema
// =============================================================================

export type SubgraphLaunchpad = {
  id: string;
  totalUnits: string;
  totalRigs: string;
  totalVolumeUsdc: string;
  totalLiquidityUsdc: string;
  totalTreasuryRevenue: string;
  totalProtocolRevenue: string;
  totalMinted: string;
};

export type SubgraphRig = {
  id: string; // Rig contract address
  unit: {
    id: string; // Unit token address
    name: string;
    symbol: string;
    lpPair: string; // LP pair address (Bytes)
    price: string; // BigDecimal (in USDC)
    marketCap: string; // BigDecimal (in USDC)
    liquidity: string; // BigDecimal (USDC in LP)
    totalSupply: string; // BigDecimal
    totalMinted: string; // BigDecimal
    lastActivityAt: string; // BigInt timestamp
    createdAt: string;
  };
  rigType: string; // "mine", "spin", "fund"
  launcher: { id: string };
  auction: string; // Bytes
  quoteToken: string; // Bytes
  uri: string;
  usdcAmount: string; // BigDecimal — USDC deposited into LP at launch
  unitAmount: string; // BigDecimal — Unit tokens deposited into LP at launch
  treasuryRevenue: string; // BigDecimal
  teamRevenue: string; // BigDecimal
  protocolRevenue: string; // BigDecimal
  totalMinted: string; // BigDecimal
  lastActivityAt: string; // BigInt
  createdAt: string;
  createdAtBlock: string;
  mineRig: {
    id: string;
    capacity: string;
    initialUps: string;
    tailUps: string;
    halvingAmount: string;
    epochPeriod: string;
    priceMultiplier: string;
    minInitPrice: string;
  } | null;
  spinRig: {
    id: string;
    initialUps: string;
    tailUps: string;
    halvingPeriod: string;
    epochPeriod: string;
    priceMultiplier: string;
    minInitPrice: string;
    currentOdds: string[];
  } | null;
  fundRig: {
    id: string;
    initialEmission: string;
    minEmission: string;
    halvingPeriod: string;
    minDonation: string;
    recipient: string;
  } | null;
};

export type SubgraphUnitListItem = {
  id: string; // Unit token address
  name: string;
  symbol: string;
  lpPair: string;
  price: string;
  priceUSD: string;
  marketCap: string;
  marketCapUSD: string;
  liquidity: string;
  liquidityUSD: string;
  volume24h: string;
  priceChange24h: string;
  totalSupply: string;
  totalMinted: string;
  lastActivityAt: string;
  createdAt: string;
  dayData?: { close: string; open: string; timestamp: string }[];
  rig: {
    id: string; // Rig contract address
    rigType: string;
    uri: string;
    launcher: { id: string };
    auction: string;
  };
};

export type SubgraphAccount = {
  id: string;
  totalSwapVolume: string;
  totalRigSpend: string;
  totalMined: string;
  totalWon: string;
  lastActivityAt: string;
};

// Mine event for activity feed
export type SubgraphMineEvent = {
  id: string;
  mineRig: { id: string };
  miner: { id: string };
  prevMiner: { id: string } | null;
  slotIndex: string;
  epochId: string;
  uri: string;
  price: string; // What new miner paid
  minted: string; // Tokens minted for prev miner
  earned: string; // Fee earned by prev miner
  timestamp: string;
  blockNumber: string;
  txHash: string;
};

export type SubgraphSpin = {
  id: string;
  spinner: { id: string };
  epochId: string;
  price: string; // BigDecimal (USDC amount)
  uri: string;
  won: boolean;
  winAmount: string; // BigDecimal (Unit tokens won)
  oddsBps: string;
  timestamp: string;
  txHash: string;
};

export type SubgraphDonation = {
  id: string;
  donor: { id: string };
  day: string;
  amount: string; // BigDecimal (USDC)
  uri: string;
  recipientAmount: string; // BigDecimal
  timestamp: string;
  txHash: string;
};

export type SubgraphUnitCandle = {
  id: string;
  timestamp: string;
  open: string; // BigDecimal price in USDC
  high: string;
  low: string;
  close: string;
  volumeUnit: string;
  volumeUsdc: string;
  txCount: string;
};

// =============================================================================
// GraphQL field fragments (reusable field sets)
// =============================================================================

const RIG_FIELDS = `
  id
  unit {
    id
    name
    symbol
    lpPair
    price
    marketCap
    liquidity
    totalSupply
    totalMinted
    lastActivityAt
    createdAt
  }
  rigType
  launcher { id }
  auction
  quoteToken
  uri
  usdcAmount
  unitAmount
  treasuryRevenue
  teamRevenue
  protocolRevenue
  totalMinted
  lastActivityAt
  createdAt
  createdAtBlock
  mineRig {
    id
    capacity
    initialUps
    tailUps
    halvingAmount
    epochPeriod
    priceMultiplier
    minInitPrice
  }
  spinRig {
    id
    initialUps
    tailUps
    halvingPeriod
    epochPeriod
    priceMultiplier
    minInitPrice
    currentOdds
  }
  fundRig {
    id
    initialEmission
    minEmission
    halvingPeriod
    minDonation
    recipient
  }
`;

const UNIT_LIST_FIELDS = `
  id
  name
  symbol
  lpPair
  price
  priceUSD
  marketCap
  marketCapUSD
  liquidity
  liquidityUSD
  volume24h
  priceChange24h
  totalSupply
  totalMinted
  lastActivityAt
  createdAt
  dayData(first: 7, orderBy: timestamp, orderDirection: desc) {
    close
    open
    timestamp
  }
  rig {
    id
    rigType
    uri
    launcher { id }
    auction
  }
`;

// =============================================================================
// Queries
// =============================================================================

// Get global protocol stats
export const GET_LAUNCHPAD_STATS_QUERY = gql`
  query GetProtocolStats {
    protocol(id: "farplace") {
      id
      totalUnits
      totalRigs
      totalVolumeUsdc
      totalLiquidityUsdc
      totalTreasuryRevenue
      totalProtocolRevenue
      totalMinted
    }
  }
`;

// Get rigs with pagination and ordering
export const GET_RIGS_QUERY = gql`
  query GetRigs(
    $first: Int!
    $skip: Int!
    $orderBy: Rig_orderBy!
    $orderDirection: OrderDirection!
  ) {
    rigs(
      first: $first
      skip: $skip
      orderBy: $orderBy
      orderDirection: $orderDirection
    ) {
      ${RIG_FIELDS}
    }
  }
`;

// Search units by name or symbol
export const SEARCH_RIGS_QUERY = gql`
  query SearchRigs($search: String!, $first: Int!) {
    units(
      first: $first
      where: {
        or: [
          { name_contains_nocase: $search }
          { symbol_contains_nocase: $search }
        ]
      }
      orderBy: marketCap
      orderDirection: desc
    ) {
      id
      name
      symbol
      lpPair
      price
      priceUSD
      marketCap
      marketCapUSD
      liquidity
      liquidityUSD
      volume24h
      priceChange24h
      totalSupply
      totalMinted
      lastActivityAt
      createdAt
      rig {
        id
        rigType
        uri
        launcher { id }
        auction
      }
    }
  }
`;

// Get a single rig by ID
export const GET_RIG_QUERY = gql`
  query GetRig($id: ID!) {
    rig(id: $id) {
      ${RIG_FIELDS}
    }
  }
`;

// Get trending rigs (most recently active)
export const GET_TRENDING_RIGS_QUERY = gql`
  query GetTrendingRigs($first: Int!) {
    rigs(first: $first, orderBy: lastActivityAt, orderDirection: desc) {
      ${RIG_FIELDS}
    }
  }
`;

// Get top rigs by treasury revenue
export const GET_TOP_RIGS_QUERY = gql`
  query GetTopRigs($first: Int!) {
    rigs(first: $first, orderBy: treasuryRevenue, orderDirection: desc) {
      ${RIG_FIELDS}
    }
  }
`;

// Get mine actions for a rig (activity feed)
export const GET_MINES_QUERY = gql`
  query GetMines($rigId: String!, $first: Int!, $skip: Int!) {
    mineActions(
      where: { mineRig_: { id: $rigId } }
      orderBy: timestamp
      orderDirection: desc
      first: $first
      skip: $skip
    ) {
      id
      mineRig { id }
      miner { id }
      prevMiner { id }
      slotIndex
      epochId
      uri
      price
      minted
      earned
      timestamp
      blockNumber
      txHash
    }
  }
`;

// Get all recent mine actions (global activity feed)
export const GET_ALL_MINES_QUERY = gql`
  query GetAllMines($first: Int!, $skip: Int!) {
    mineActions(
      orderBy: timestamp
      orderDirection: desc
      first: $first
      skip: $skip
    ) {
      id
      mineRig { id }
      miner { id }
      prevMiner { id }
      slotIndex
      epochId
      uri
      price
      minted
      earned
      timestamp
      blockNumber
      txHash
    }
  }
`;

// Get account stats
export const GET_ACCOUNT_QUERY = gql`
  query GetAccount($id: ID!) {
    account(id: $id) {
      id
      totalSwapVolume
      totalRigSpend
      totalMined
      totalWon
      lastActivityAt
    }
  }
`;

// Get spins for a SpinRig
export const GET_SPINS_QUERY = gql`
  query GetSpins($rigAddress: String!, $limit: Int!) {
    spins(
      where: { spinRig: $rigAddress }
      orderBy: timestamp
      orderDirection: desc
      first: $limit
    ) {
      id
      spinner {
        id
      }
      epochId
      price
      uri
      won
      winAmount
      oddsBps
      timestamp
      txHash
    }
  }
`;

// Get donations for a FundRig
export const GET_DONATIONS_QUERY = gql`
  query GetDonations($rigAddress: String!, $limit: Int!) {
    donations(
      where: { fundRig: $rigAddress }
      orderBy: timestamp
      orderDirection: desc
      first: $limit
    ) {
      id
      donor {
        id
      }
      day
      amount
      uri
      recipientAmount
      timestamp
      txHash
    }
  }
`;

// Get minute candle data for a unit token
export const GET_UNIT_MINUTE_DATA_QUERY = gql`
  query GetUnitMinuteData($unitAddress: String!, $since: BigInt!) {
    unitMinuteDatas(
      where: { unit: $unitAddress, timestamp_gte: $since }
      orderBy: timestamp
      orderDirection: asc
      first: 1000
    ) {
      id
      timestamp
      open
      high
      low
      close
      volumeUnit
      volumeUsdc
      txCount
    }
  }
`;

// Get hourly candle data for a unit token
export const GET_UNIT_HOUR_DATA_QUERY = gql`
  query GetUnitHourData($unitAddress: String!, $since: BigInt!) {
    unitHourDatas(
      where: { unit: $unitAddress, timestamp_gte: $since }
      orderBy: timestamp
      orderDirection: asc
      first: 1000
    ) {
      id
      timestamp
      open
      high
      low
      close
      volumeUnit
      volumeUsdc
      txCount
    }
  }
`;

// Get daily candle data for a unit token
export const GET_UNIT_DAY_DATA_QUERY = gql`
  query GetUnitDayData($unitAddress: String!, $since: BigInt!) {
    unitDayDatas(
      where: { unit: $unitAddress, timestamp_gte: $since }
      orderBy: timestamp
      orderDirection: asc
      first: 1000
    ) {
      id
      timestamp
      open
      high
      low
      close
      volumeUnit
      volumeUsdc
      txCount
    }
  }
`;

// Get hourly candle data for multiple units (for sparklines)
export const GET_BATCH_UNIT_HOUR_DATA_QUERY = gql`
  query GetBatchUnitHourData($unitAddresses: [String!]!, $since: BigInt!) {
    unitHourDatas(
      where: { unit_in: $unitAddresses, timestamp_gte: $since }
      orderBy: timestamp
      orderDirection: asc
      first: 1000
    ) {
      id
      unit {
        id
      }
      timestamp
      close
    }
  }
`;

// Get minute candle data for multiple units (for sparklines on new tokens)
export const GET_BATCH_UNIT_MINUTE_DATA_QUERY = gql`
  query GetBatchUnitMinuteData($unitAddresses: [String!]!, $since: BigInt!) {
    unitMinuteDatas(
      where: { unit_in: $unitAddresses, timestamp_gte: $since }
      orderBy: timestamp
      orderDirection: asc
      first: 1000
    ) {
      id
      unit {
        id
      }
      timestamp
      close
    }
  }
`;

// =============================================================================
// Unit listing queries (for explore page)
// =============================================================================

// Get units sorted by lastActivityAt (bump order)
export const GET_UNITS_BY_ACTIVITY_QUERY = gql`
  query GetUnitsByActivity($first: Int!) {
    units(first: $first, orderBy: lastActivityAt, orderDirection: desc) {
      ${UNIT_LIST_FIELDS}
    }
  }
`;

// Get units sorted by marketCap (top order)
export const GET_UNITS_BY_MARKET_CAP_QUERY = gql`
  query GetUnitsByMarketCap($first: Int!) {
    units(first: $first, orderBy: marketCap, orderDirection: desc) {
      ${UNIT_LIST_FIELDS}
    }
  }
`;

// Get units sorted by createdAt (new order)
export const GET_UNITS_BY_CREATED_AT_QUERY = gql`
  query GetUnitsByCreatedAt($first: Int!) {
    units(first: $first, orderBy: createdAt, orderDirection: desc) {
      ${UNIT_LIST_FIELDS}
    }
  }
`;

// Get all units (for portfolio balance checks)
export const GET_ALL_UNITS_QUERY = gql`
  query GetAllUnits($first: Int!) {
    units(first: $first, orderBy: createdAt, orderDirection: desc) {
      ${UNIT_LIST_FIELDS}
    }
  }
`;

// =============================================================================
// API Functions
// =============================================================================

export async function getLaunchpadStats(): Promise<SubgraphLaunchpad | null> {
  try {
    const data = await client.request<{
      protocol: SubgraphLaunchpad | null;
    }>(GET_LAUNCHPAD_STATS_QUERY);
    return data.protocol;
  } catch (error) {
    console.error("[getLaunchpadStats] Error:", error);
    return null;
  }
}

export async function getRigs(
  first = 20,
  skip = 0,
  orderBy:
    | "totalMinted"
    | "createdAt"
    | "lastActivityAt"
    | "treasuryRevenue" = "totalMinted",
  orderDirection: "asc" | "desc" = "desc"
): Promise<SubgraphRig[]> {
  try {
    const data = await client.request<{ rigs: SubgraphRig[] }>(GET_RIGS_QUERY, {
      first,
      skip,
      orderBy,
      orderDirection,
    });
    return data.rigs;
  } catch (error) {
    console.error("[getRigs] Error:", error);
    return [];
  }
}

export async function searchRigs(
  search: string,
  first = 20
): Promise<SubgraphUnitListItem[]> {
  try {
    const data = await client.request<{ units: SubgraphUnitListItem[] }>(
      SEARCH_RIGS_QUERY,
      {
        search,
        first,
      }
    );
    return data.units;
  } catch (error) {
    console.error("[searchRigs] Error:", error);
    return [];
  }
}

export async function getRig(id: string): Promise<SubgraphRig | null> {
  try {
    const data = await client.request<{ rig: SubgraphRig | null }>(
      GET_RIG_QUERY,
      {
        id: id.toLowerCase(),
      }
    );
    return data.rig;
  } catch (error) {
    console.error("[getRig] Error:", error);
    return null;
  }
}

// Get mine actions for a rig (activity feed)
export async function getMines(
  rigId: string,
  first = 50,
  skip = 0
): Promise<SubgraphMineEvent[]> {
  try {
    const data = await client.request<{ mineActions: SubgraphMineEvent[] }>(
      GET_MINES_QUERY,
      {
        rigId: rigId.toLowerCase(),
        first,
        skip,
      }
    );
    return data.mineActions ?? [];
  } catch (error) {
    console.error("[getMines] Error:", error);
    return [];
  }
}

// Get all recent mine actions (global activity feed)
export async function getAllMines(
  first = 50,
  skip = 0
): Promise<SubgraphMineEvent[]> {
  try {
    const data = await client.request<{ mineActions: SubgraphMineEvent[] }>(
      GET_ALL_MINES_QUERY,
      {
        first,
        skip,
      }
    );
    return data.mineActions ?? [];
  } catch (error) {
    console.error("[getAllMines] Error:", error);
    return [];
  }
}

export async function getAccount(id: string): Promise<SubgraphAccount | null> {
  try {
    const data = await client.request<{ account: SubgraphAccount | null }>(
      GET_ACCOUNT_QUERY,
      {
        id: id.toLowerCase(),
      }
    );
    return data.account;
  } catch (error) {
    console.error("[getAccount] Error:", error);
    return null;
  }
}

export async function getTrendingRigs(first = 20): Promise<SubgraphRig[]> {
  try {
    const data = await client.request<{ rigs: SubgraphRig[] }>(
      GET_TRENDING_RIGS_QUERY,
      { first }
    );
    return data.rigs;
  } catch (error) {
    console.error("[getTrendingRigs] Error:", error);
    return [];
  }
}

export async function getTopRigs(first = 20): Promise<SubgraphRig[]> {
  try {
    const data = await client.request<{ rigs: SubgraphRig[] }>(
      GET_TOP_RIGS_QUERY,
      { first }
    );
    return data.rigs;
  } catch (error) {
    console.error("[getTopRigs] Error:", error);
    return [];
  }
}

// Unit listing functions (for explore page)

export async function getUnitsByActivity(
  first = 20
): Promise<SubgraphUnitListItem[]> {
  try {
    const data = await client.request<{ units: SubgraphUnitListItem[] }>(
      GET_UNITS_BY_ACTIVITY_QUERY,
      { first }
    );
    return data.units ?? [];
  } catch (error) {
    console.error("[getUnitsByActivity] Error:", error);
    return [];
  }
}

export async function getUnitsByMarketCap(
  first = 20
): Promise<SubgraphUnitListItem[]> {
  try {
    const data = await client.request<{ units: SubgraphUnitListItem[] }>(
      GET_UNITS_BY_MARKET_CAP_QUERY,
      { first }
    );
    return data.units ?? [];
  } catch (error) {
    console.error("[getUnitsByMarketCap] Error:", error);
    return [];
  }
}

export async function getUnitsByCreatedAt(
  first = 20
): Promise<SubgraphUnitListItem[]> {
  try {
    const data = await client.request<{ units: SubgraphUnitListItem[] }>(
      GET_UNITS_BY_CREATED_AT_QUERY,
      { first }
    );
    return data.units ?? [];
  } catch (error) {
    console.error("[getUnitsByCreatedAt] Error:", error);
    return [];
  }
}

export async function getAllUnits(
  first = 100
): Promise<SubgraphUnitListItem[]> {
  try {
    const data = await client.request<{ units: SubgraphUnitListItem[] }>(
      GET_ALL_UNITS_QUERY,
      { first }
    );
    return data.units ?? [];
  } catch (error) {
    console.error("[getAllUnits] Error:", error);
    return [];
  }
}

// Helper to format subgraph address
export function formatSubgraphAddress(address: string): `0x${string}` {
  return address.toLowerCase() as `0x${string}`;
}

// Get spins for a SpinRig
export async function getSpins(
  rigAddress: string,
  limit = 20
): Promise<SubgraphSpin[]> {
  try {
    const data = await client.request<{ spins: SubgraphSpin[] }>(
      GET_SPINS_QUERY,
      {
        rigAddress: rigAddress.toLowerCase(),
        limit,
      }
    );
    return data.spins ?? [];
  } catch (error) {
    console.error("[getSpins] Error:", error);
    return [];
  }
}

// Get donations for a FundRig
export async function getDonations(
  rigAddress: string,
  limit = 20
): Promise<SubgraphDonation[]> {
  try {
    const data = await client.request<{ donations: SubgraphDonation[] }>(
      GET_DONATIONS_QUERY,
      {
        rigAddress: rigAddress.toLowerCase(),
        limit,
      }
    );
    return data.donations ?? [];
  } catch (error) {
    console.error("[getDonations] Error:", error);
    return [];
  }
}

// Get minute candle data for a unit token
export async function getUnitMinuteData(
  unitAddress: string,
  since: number
): Promise<SubgraphUnitCandle[]> {
  try {
    const data = await client.request<{ unitMinuteDatas: SubgraphUnitCandle[] }>(
      GET_UNIT_MINUTE_DATA_QUERY,
      {
        unitAddress: unitAddress.toLowerCase(),
        since: since.toString(),
      }
    );
    return data.unitMinuteDatas ?? [];
  } catch (error) {
    console.error("[getUnitMinuteData] Error:", error);
    return [];
  }
}

// Get hourly candle data for a unit token
export async function getUnitHourData(
  unitAddress: string,
  since: number
): Promise<SubgraphUnitCandle[]> {
  try {
    const data = await client.request<{ unitHourDatas: SubgraphUnitCandle[] }>(
      GET_UNIT_HOUR_DATA_QUERY,
      {
        unitAddress: unitAddress.toLowerCase(),
        since: since.toString(),
      }
    );
    return data.unitHourDatas ?? [];
  } catch (error) {
    console.error("[getUnitHourData] Error:", error);
    return [];
  }
}

// Get daily candle data for a unit token
export async function getUnitDayData(
  unitAddress: string,
  since: number
): Promise<SubgraphUnitCandle[]> {
  try {
    const data = await client.request<{ unitDayDatas: SubgraphUnitCandle[] }>(
      GET_UNIT_DAY_DATA_QUERY,
      {
        unitAddress: unitAddress.toLowerCase(),
        since: since.toString(),
      }
    );
    return data.unitDayDatas ?? [];
  } catch (error) {
    console.error("[getUnitDayData] Error:", error);
    return [];
  }
}

// Batch fetch sparkline data for multiple units (last 24h hourly)
export type SparklineDataPoint = { timestamp: number; price: number };
export type SparklineMap = Map<string, SparklineDataPoint[]>;

export async function getBatchSparklineData(
  unitAddresses: string[]
): Promise<SparklineMap> {
  if (unitAddresses.length === 0) return new Map();

  const since = Math.floor(Date.now() / 1000) - 86400; // Last 24 hours

  try {
    const data = await client.request<{
      unitHourDatas: Array<{
        unit: { id: string };
        timestamp: string;
        close: string;
      }>;
    }>(GET_BATCH_UNIT_HOUR_DATA_QUERY, {
      unitAddresses: unitAddresses.map((a) => a.toLowerCase()),
      since: since.toString(),
    });

    // Group by unit address
    const result: SparklineMap = new Map();
    for (const candle of data.unitHourDatas ?? []) {
      const unitId = candle.unit.id.toLowerCase();
      if (!result.has(unitId)) {
        result.set(unitId, []);
      }
      result.get(unitId)!.push({
        timestamp: parseInt(candle.timestamp),
        price: parseFloat(candle.close),
      });
    }

    return result;
  } catch (error) {
    console.error("[getBatchSparklineData] Error:", error);
    return new Map();
  }
}

// Batch fetch minute-level sparkline data (last 4h, for new tokens without hourly candles)
export async function getBatchSparklineMinuteData(
  unitAddresses: string[]
): Promise<SparklineMap> {
  if (unitAddresses.length === 0) return new Map();

  const since = Math.floor(Date.now() / 1000) - 4 * 3600; // Last 4 hours

  try {
    const data = await client.request<{
      unitMinuteDatas: Array<{
        unit: { id: string };
        timestamp: string;
        close: string;
      }>;
    }>(GET_BATCH_UNIT_MINUTE_DATA_QUERY, {
      unitAddresses: unitAddresses.map((a) => a.toLowerCase()),
      since: since.toString(),
    });

    const result: SparklineMap = new Map();
    for (const candle of data.unitMinuteDatas ?? []) {
      const unitId = candle.unit.id.toLowerCase();
      if (!result.has(unitId)) {
        result.set(unitId, []);
      }
      result.get(unitId)!.push({
        timestamp: parseInt(candle.timestamp),
        price: parseFloat(candle.close),
      });
    }

    return result;
  } catch (error) {
    console.error("[getBatchSparklineMinuteData] Error:", error);
    return new Map();
  }
}
