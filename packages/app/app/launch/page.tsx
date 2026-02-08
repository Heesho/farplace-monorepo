"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Upload, ChevronDown, ChevronUp, X, Pickaxe, Dices, Heart, Plus, Minus } from "lucide-react";
import { parseUnits, formatUnits, parseEventLogs } from "viem";
import { useReadContract, useWaitForTransactionReceipt } from "wagmi";
import { useFarcaster } from "@/hooks/useFarcaster";
import {
  useBatchedTransaction,
  encodeApproveCall,
  encodeContractCall,
  type Call,
} from "@/hooks/useBatchedTransaction";
import {
  CONTRACT_ADDRESSES,
  MULTICALL_ABI,
  SPIN_MULTICALL_ABI,
  FUND_MULTICALL_ABI,
  QUOTE_TOKEN_DECIMALS,
  ERC20_ABI,
} from "@/lib/contracts";

// USDC token icon - blue circle with $ sign
function UsdcIcon({ size = 20 }: { size?: number }) {
  return (
    <div
      className="rounded-full bg-[#2775CA] flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size }}
    >
      <span
        className="font-bold text-white"
        style={{ fontSize: size * 0.5 }}
      >
        $
      </span>
    </div>
  );
}

// Rig types
type RigType = "mine" | "spin" | "fund" | null;

// Bounds matching smart contract validation (for UI enforcement)
const BOUNDS = {
  // Shared: Dutch auction parameters (MineRig, SpinRig, Auction)
  epochPeriod: { min: 600, max: 31536000 }, // 10 min - 365 days (in seconds)
  priceMultiplier: { min: 1.1, max: 3 }, // 1.1x - 3x
  minInitPrice: { min: 0.000001, max: 1e12 }, // Contract uses 1e6 wei min
  // Auction-specific bounds (LP token units, 18 decimals)
  auctionEpochPeriod: { min: 3600, max: 31536000 }, // 1 hour - 365 days
  auctionPriceMultiplier: { min: 1.1, max: 3 },
  auctionMinInitPrice: { min: 0.000001, max: 1e12 },
  auctionInitPrice: { min: 0.000001, max: 1e12 },

  // MineRig/SpinRig: Emission (per second)
  initialUps: { min: 0.000001, max: 1000000 }, // Contract max is 1e24 wei/sec
  tailUps: { min: 0.000001 }, // Must be > 0 and <= initialUps

  // MineRig: Supply-based halving
  halvingAmount: { min: 1000 }, // Contract min is 1000 ether (1000 tokens)

  // SpinRig/FundRig: Time-based halving
  halvingPeriod: { min: 604800, max: 31536000 }, // 7 days - 365 days (in seconds)

  // FundRig: Daily emission
  initialEmission: { min: 1, max: 1e12 }, // Contract: 1e18 - 1e30 wei/day (1 - 1e12 tokens/day)
  minEmission: { min: 1 }, // Must be > 0 and <= initialEmission

};

// Default values per rig type
const DEFAULTS = {
  mine: {
    usdcAmount: 1,
    unitAmount: 1000,
    initialUps: 4, // 4 tokens/sec
    tailUps: 0.01, // 0.01 token/sec floor
    halvingAmount: 10000000, // 10M tokens (supply-based) → ~20M at floor
    rigEpochPeriod: 3600, // 1 hour
    rigPriceMultiplier: 2, // 2x
    rigMinInitPrice: 1, // $1
    auctionEpochPeriod: 86400, // 1 day
    auctionPriceMultiplier: 1.2, // 1.2x
    auctionTargetUsd: 100, // target $100 min auction price
    upsMultipliers: [1, 1, 1, 1, 1, 1, 1, 2, 2, 3] as number[], // ~1.4x average
    upsMultiplierDuration: 86400, // 24h
  },
  spin: {
    usdcAmount: 1,
    unitAmount: 1000,
    initialUps: 4, // 4 tokens/sec
    tailUps: 0.01, // 0.01 token/sec floor
    halvingPeriod: 30 * 24 * 3600, // 30 days (time-based)
    rigEpochPeriod: 3600, // 1 hour
    rigPriceMultiplier: 1.2, // 1.2x
    rigMinInitPrice: 1, // $1
    auctionEpochPeriod: 86400, // 1 day
    auctionPriceMultiplier: 1.2, // 1.2x
    auctionTargetUsd: 100, // target $100 min auction price
    odds: [
      ...Array(30).fill(20),   // 30% × 0.2% pool
      ...Array(25).fill(50),   // 25% × 0.5% pool
      ...Array(20).fill(100),  // 20% × 1% pool
      ...Array(15).fill(250),  // 15% × 2.5% pool
      ...Array(7).fill(500),   //  7% × 5% pool
      ...Array(2).fill(1000),  //  2% × 10% pool
      2000,                    //  1% × 20% pool (jackpot)
    ] as number[], // ~1.5% avg — slot machine curve: frequent small wins, rare jackpot
  },
  fund: {
    usdcAmount: 1,
    unitAmount: 1000,
    initialUps: 50000, // 50,000 tokens/day (expressed as daily)
    tailUps: 5000, // 5,000 tokens/day floor
    halvingPeriod: 30 * 24 * 3600, // 30 days
    auctionEpochPeriod: 86400, // 1 day
    auctionPriceMultiplier: 1.2, // 1.2x
    auctionTargetUsd: 100, // target $100 min auction price
  },
};

type DistributionRow = {
  id: string;
  value: number;
  probability: number;
};

const DISTRIBUTION_ARRAY_LENGTH = 100;
const MAX_DISTRIBUTION_ROWS = 12;
const SPIN_ODDS_BPS_MIN = 10; // 0.1%
const SPIN_ODDS_BPS_MAX = 8000; // 80%
const MINE_MULTIPLIER_MIN = 1; // 1x
const MINE_MULTIPLIER_MAX = 10; // 10x

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const createDistributionRow = (value: number, probability: number): DistributionRow => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  value,
  probability,
});

function arrayToDistributionRows(values: number[]): DistributionRow[] {
  if (values.length === 0) return [];

  const counts = new Map<string, { value: number; count: number }>();
  values.forEach((raw) => {
    const value = Number(raw.toFixed(4));
    const key = value.toString();
    const entry = counts.get(key);
    if (entry) {
      entry.count += 1;
      return;
    }
    counts.set(key, { value, count: 1 });
  });

  const buckets = Array.from(counts.values()).sort((a, b) => a.value - b.value);
  const withShares = buckets.map((bucket) => {
    const exactShare = (bucket.count * DISTRIBUTION_ARRAY_LENGTH) / values.length;
    const baseShare = Math.floor(exactShare);
    return {
      ...bucket,
      probability: baseShare,
      remainder: exactShare - baseShare,
    };
  });

  let remaining = DISTRIBUTION_ARRAY_LENGTH - withShares.reduce((sum, bucket) => sum + bucket.probability, 0);
  const byRemainder = [...withShares].sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; remaining > 0 && byRemainder.length > 0; i = (i + 1) % byRemainder.length) {
    byRemainder[i].probability += 1;
    remaining -= 1;
  }

  return byRemainder
    .sort((a, b) => a.value - b.value)
    .filter((bucket) => bucket.probability > 0)
    .map((bucket) => createDistributionRow(bucket.value, bucket.probability));
}

function buildDistributionArray(
  rows: DistributionRow[],
  options: {
    min: number;
    max: number;
    valueDecimals: number;
    integerValues?: boolean;
  }
): {
  array: number[];
  totalProbability: number;
  isValid: boolean;
  error: string | null;
} {
  const normalizedRows = rows.map((row) => {
    let value = Number.isFinite(row.value) ? row.value : options.min;
    value = clamp(value, options.min, options.max);
    if (options.integerValues) {
      value = Math.round(value);
    } else {
      const factor = 10 ** options.valueDecimals;
      value = Math.round(value * factor) / factor;
    }

    const probability = clamp(Math.floor(Number(row.probability) || 0), 0, 100);
    return { value, probability };
  });

  const totalProbability = normalizedRows.reduce((sum, row) => sum + row.probability, 0);
  const nonZeroRows = normalizedRows.filter((row) => row.probability > 0);

  if (nonZeroRows.length === 0) {
    return {
      array: [],
      totalProbability,
      isValid: false,
      error: "Add at least one outcome with a non-zero probability.",
    };
  }

  if (totalProbability !== DISTRIBUTION_ARRAY_LENGTH) {
    return {
      array: [],
      totalProbability,
      isValid: false,
      error: `Total probability must equal 100% (currently ${totalProbability}%).`,
    };
  }

  const merged = new Map<string, { value: number; probability: number }>();
  nonZeroRows.forEach((row) => {
    const key = row.value.toString();
    const existing = merged.get(key);
    if (existing) {
      existing.probability += row.probability;
      return;
    }
    merged.set(key, { value: row.value, probability: row.probability });
  });

  const array: number[] = [];
  Array.from(merged.values())
    .sort((a, b) => a.value - b.value)
    .forEach((entry) => {
      for (let i = 0; i < entry.probability; i++) {
        array.push(entry.value);
      }
    });

  array.sort((a, b) => a - b); // enforce smallest value at index 0

  return {
    array,
    totalProbability,
    isValid: true,
    error: null,
  };
}

// Rig type info
const RIG_INFO = {
  mine: {
    icon: Pickaxe,
    name: "Mine",
    description: "Best for competitive communities. Claim the active mining position and earn emissions until replaced.",
    color: "text-zinc-400",
  },
  spin: {
    icon: Dices,
    name: "Spin",
    description: "Best for high-engagement launches. Users spin for randomized payouts from the prize pool.",
    color: "text-zinc-400",
  },
  fund: {
    icon: Heart,
    name: "Fund",
    description: "Best for causes, teams, charities, or agents. Fund daily and share emissions by contribution.",
    color: "text-zinc-400",
  },
};

// Rig type selection card
function RigTypeCard({
  type,
  onSelect,
}: {
  type: "mine" | "spin" | "fund";
  onSelect: () => void;
}) {
  const info = RIG_INFO[type];
  const Icon = info.icon;

  return (
    <button
      onClick={onSelect}
      className="w-full p-4 rounded-xl ring-1 ring-zinc-700 hover:ring-zinc-500 transition-colors text-left flex items-start gap-4"
    >
      <div className={`${info.color} mt-0.5`}>
        <Icon className="w-6 h-6" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-white">{info.name}</div>
        <div className="text-sm text-zinc-400 mt-1 leading-snug">{info.description}</div>
      </div>
    </button>
  );
}

// Emission preview component - unified format showing time + supply for all rig types
function EmissionPreview({
  rigType,
  initialUps,
  tailUps,
  halvingPeriod,
  halvingAmount,
  compact = false,
}: {
  rigType: "mine" | "spin" | "fund";
  initialUps: number;
  tailUps: number;
  halvingPeriod: number;
  halvingAmount: number;
  compact?: boolean;
}) {
  const formatSupply = (n: number) => {
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    if (n >= 1) return n.toFixed(0);
    return n.toFixed(2);
  };

  const formatTime = (days: number) => {
    if (days >= 365) {
      const years = days / 365;
      return years >= 10 ? `${Math.round(years)}y` : `${years.toFixed(1)}y`;
    }
    return `${Math.round(days)}d`;
  };

  // Calculate milestones based on rig type
  let firstHalvingDays: number;
  let firstHalvingSupply: number;
  let halfwayDays: number;
  let halfwaySupply: number;
  let floorDays: number;
  let floorSupply: number;
  let afterFloorPerYear: number;
  let totalHalvings: number;

  if (rigType === "mine") {
    // Supply-based halving - we know supply, estimate time
    const avgUps = (initialUps + tailUps) / 2; // rough average for time estimation

    // Calculate halvings to reach tail
    totalHalvings = 0;
    let currentUps = initialUps;
    while (currentUps > tailUps && totalHalvings < 64) {
      totalHalvings++;
      currentUps = initialUps / Math.pow(2, totalHalvings);
    }

    // Supply thresholds (geometric series)
    firstHalvingSupply = halvingAmount;

    // 50% to floor supply
    const halfHalvings = Math.floor(totalHalvings / 2);
    halfwaySupply = halvingAmount;
    for (let i = 1; i < halfHalvings; i++) {
      halfwaySupply += halvingAmount / Math.pow(2, i);
    }

    // Floor supply (sum of geometric series)
    floorSupply = halvingAmount;
    for (let i = 1; i < totalHalvings; i++) {
      floorSupply += halvingAmount / Math.pow(2, i);
    }

    // Estimate time based on emission rates (assuming continuous mining)
    // Time = supply / avgEmissionRate
    firstHalvingDays = firstHalvingSupply / (initialUps * 86400);

    // For halfway and floor, use weighted average of rates
    let timeAccum = 0;
    let supplyAccum = 0;
    let foundHalfway = false;
    halfwayDays = 0;
    for (let i = 0; i < totalHalvings; i++) {
      const periodSupply = halvingAmount / Math.pow(2, i);
      const periodUps = initialUps / Math.pow(2, i);
      const periodDays = periodSupply / (periodUps * 86400);
      timeAccum += periodDays;
      supplyAccum += periodSupply;
      if (supplyAccum >= halfwaySupply && !foundHalfway) {
        halfwayDays = timeAccum;
        foundHalfway = true;
      }
    }
    if (!foundHalfway) {
      halfwayDays = timeAccum / 2;
    }
    floorDays = timeAccum;

    // After floor: tailUps per second forever
    afterFloorPerYear = tailUps * 86400 * 365;

  } else {
    // Time-based halving (SpinRig, FundRig) - we know time, calculate supply
    const isDaily = rigType === "fund";
    const initialPerSec = isDaily ? initialUps / 86400 : initialUps;
    const tailPerSec = isDaily ? tailUps / 86400 : tailUps;

    // Calculate halvings to reach tail
    totalHalvings = 0;
    let currentRate = initialPerSec;
    while (currentRate > tailPerSec && totalHalvings < 64) {
      totalHalvings++;
      currentRate = initialPerSec / Math.pow(2, totalHalvings);
    }

    const halvingPeriodDays = halvingPeriod / 86400;

    // First halving
    firstHalvingDays = halvingPeriodDays;
    firstHalvingSupply = initialPerSec * halvingPeriod;

    // 50% to floor (halfway through halvings)
    const halfHalvings = Math.floor(totalHalvings / 2);
    halfwayDays = halfHalvings * halvingPeriodDays;
    halfwaySupply = 0;
    for (let i = 0; i < halfHalvings; i++) {
      halfwaySupply += (initialPerSec / Math.pow(2, i)) * halvingPeriod;
    }

    // Floor reached
    floorDays = totalHalvings * halvingPeriodDays;
    floorSupply = 0;
    for (let i = 0; i < totalHalvings; i++) {
      floorSupply += (initialPerSec / Math.pow(2, i)) * halvingPeriod;
    }

    // After floor
    afterFloorPerYear = tailPerSec * 86400 * 365;
  }

  const content = (
    <>
      <div className="text-[13px] font-semibold text-foreground">Emission Schedule</div>
      <div className="space-y-1.5 text-[12px]">
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">First halving</span>
          <span className="text-foreground font-semibold tabular-nums">
            {formatTime(firstHalvingDays)} · {formatSupply(firstHalvingSupply)} coins
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Floor reached</span>
          <span className="text-foreground font-semibold tabular-nums">
            {formatTime(floorDays)} · {formatSupply(floorSupply)} coins
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">After floor</span>
          <span className="text-foreground font-semibold tabular-nums">
            +{formatSupply(afterFloorPerYear)}/year forever
          </span>
        </div>
      </div>
      <div className="text-[11px] text-muted-foreground pt-1">
        {totalHalvings} halvings
      </div>
    </>
  );

  if (compact) {
    return <div className="space-y-2">{content}</div>;
  }

  return <div className="rounded-xl ring-1 ring-zinc-700 bg-zinc-800/40 p-3 space-y-2">{content}</div>;
}

// Combined settings summary component
function SettingsSummary({
  rigType,
  usdcAmount,
  unitAmount,
  initialUps,
  tailUps,
  halvingAmount,
  halvingPeriod,
  rigEpochPeriod,
  rigPriceMultiplier,
  rigMinInitPrice,
  upsMultipliers,
  odds,
}: {
  rigType: "mine" | "spin" | "fund";
  usdcAmount: number;
  unitAmount: number;
  initialUps: number;
  tailUps: number;
  halvingAmount: number;
  halvingPeriod: number;
  rigEpochPeriod: number;
  rigPriceMultiplier: number;
  rigMinInitPrice: number;
  upsMultipliers: number[];
  odds: number[];
}) {
  const formatNum = (n: number) => {
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    if (n >= 1) return n.toFixed(0);
    return n.toFixed(2);
  };

  const formatDur = (seconds: number) => {
    if (seconds >= 86400) return `${Math.round(seconds / 86400)}d`;
    if (seconds >= 3600) return `${Math.round(seconds / 3600)}h`;
    return `${Math.round(seconds / 60)}m`;
  };

  // Calculate multiplier probabilities for display
  const getMultiplierSummary = () => {
    if (upsMultipliers.length === 0) return "1x: 100%";
    const counts: Record<number, number> = {};
    upsMultipliers.forEach(m => { counts[m] = (counts[m] || 0) + 1; });
    const parts = Object.entries(counts)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([mult, count]) => `${mult}x: ${Math.round((count / upsMultipliers.length) * 100)}%`);
    return parts.join(", ");
  };

  // Calculate odds summary for SpinRig
  const getOddsSummary = () => {
    const counts: Record<number, number> = {};
    odds.forEach(o => { counts[o] = (counts[o] || 0) + 1; });
    const parts = Object.entries(counts)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([bps, count]) => `${(Number(bps) / 100).toFixed(1)}%: ${Math.round((count / odds.length) * 100)}%`);
    return parts.join(", ");
  };

  return (
    <div className="bg-zinc-800/50 rounded-lg p-3 space-y-3">
      <div className="text-[13px] font-medium text-zinc-300">Current Parameters</div>

      {/* All settings as bullet points */}
      <div className="space-y-1">
        <div className="text-[12px] text-zinc-400 flex items-center gap-2">
          <span className="text-zinc-500">•</span>
          Initial LP: ${formatNum(usdcAmount)} + {formatNum(unitAmount)} coins
        </div>
        <div className="text-[12px] text-zinc-400 flex items-center gap-2">
          <span className="text-zinc-500">•</span>
          Starting price: ${(usdcAmount / unitAmount).toFixed(6)}
        </div>
        {rigType === "mine" && (
          <>
            <div className="text-[12px] text-zinc-400 flex items-center gap-2">
              <span className="text-zinc-500">•</span>
              Emission: {formatNum(initialUps)}/sec initial → {formatNum(tailUps)}/sec floor
            </div>
            <div className="text-[12px] text-zinc-400 flex items-center gap-2">
              <span className="text-zinc-500">•</span>
              Halving every {formatNum(halvingAmount)} coins mined
            </div>
            <div className="text-[12px] text-zinc-400 flex items-center gap-2">
              <span className="text-zinc-500">•</span>
              Market cycle: {formatDur(rigEpochPeriod)}, min ${rigMinInitPrice}, {rigPriceMultiplier}x reset
            </div>
            <div className="text-[12px] text-zinc-400 flex items-center gap-2">
              <span className="text-zinc-500">•</span>
              UPS multipliers: {getMultiplierSummary()}
            </div>
          </>
        )}
        {rigType === "spin" && (
          <>
            <div className="text-[12px] text-zinc-400 flex items-center gap-2">
              <span className="text-zinc-500">•</span>
              Emission: {formatNum(initialUps)}/sec initial → {formatNum(tailUps)}/sec floor
            </div>
            <div className="text-[12px] text-zinc-400 flex items-center gap-2">
              <span className="text-zinc-500">•</span>
              Halving every {formatDur(halvingPeriod)}
            </div>
            <div className="text-[12px] text-zinc-400 flex items-center gap-2">
              <span className="text-zinc-500">•</span>
              Spin cycle: {formatDur(rigEpochPeriod)}, min ${rigMinInitPrice}, {rigPriceMultiplier}x reset
            </div>
            <div className="text-[12px] text-zinc-400 flex items-center gap-2">
              <span className="text-zinc-500">•</span>
              Payout odds: {getOddsSummary()}
            </div>
          </>
        )}
        {rigType === "fund" && (
          <>
            <div className="text-[12px] text-zinc-400 flex items-center gap-2">
              <span className="text-zinc-500">•</span>
              Emission: {formatNum(initialUps)}/day initial → {formatNum(tailUps)}/day floor
            </div>
            <div className="text-[12px] text-zinc-400 flex items-center gap-2">
              <span className="text-zinc-500">•</span>
              Halving every {formatDur(halvingPeriod)}
            </div>
            <div className="text-[12px] text-zinc-400 flex items-center gap-2">
              <span className="text-zinc-500">•</span>
              Funding split: 50% target, 45% treasury, 4% team, 1% protocol
            </div>
          </>
        )}
      </div>

      {/* Emission Schedule - use the existing EmissionPreview component */}
      <div className="pt-3">
        <EmissionPreview
          rigType={rigType}
          initialUps={initialUps}
          tailUps={tailUps}
          halvingPeriod={halvingPeriod}
          halvingAmount={halvingAmount}
          compact
        />
      </div>
    </div>
  );
}

// Slider component
function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  formatValue,
  description,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  formatValue?: (value: number) => string;
  description?: string;
}) {
  const displayValue = formatValue ? formatValue(value) : value.toString();

  return (
    <div className="py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[13px] text-muted-foreground">{label}</span>
        <span className="text-[13px] font-medium tabular-nums">{displayValue}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-2 bg-zinc-700 rounded-full appearance-none cursor-pointer accent-white"
      />
      {description && (
        <p className="text-[11px] text-muted-foreground mt-1">{description}</p>
      )}
    </div>
  );
}

// Minimal ABIs for parsing Launched events from tx receipts
const LAUNCHED_EVENT_ABIS = [
  {
    type: "event",
    name: "MineCore__Launched",
    inputs: [
      { name: "launcher", type: "address", indexed: true },
      { name: "rig", type: "address", indexed: true },
      { name: "unit", type: "address", indexed: true },
      { name: "auction", type: "address", indexed: false },
      { name: "lpToken", type: "address", indexed: false },
      { name: "quoteToken", type: "address", indexed: false },
      { name: "tokenName", type: "string", indexed: false },
      { name: "tokenSymbol", type: "string", indexed: false },
      { name: "uri", type: "string", indexed: false },
      { name: "usdcAmount", type: "uint256", indexed: false },
      { name: "unitAmount", type: "uint256", indexed: false },
      { name: "initialUps", type: "uint256", indexed: false },
      { name: "tailUps", type: "uint256", indexed: false },
      { name: "halvingAmount", type: "uint256", indexed: false },
      { name: "rigEpochPeriod", type: "uint256", indexed: false },
      { name: "rigPriceMultiplier", type: "uint256", indexed: false },
      { name: "rigMinInitPrice", type: "uint256", indexed: false },
      { name: "upsMultipliers", type: "uint256[]", indexed: false },
      { name: "upsMultiplierDuration", type: "uint256", indexed: false },
      { name: "auctionInitPrice", type: "uint256", indexed: false },
      { name: "auctionEpochPeriod", type: "uint256", indexed: false },
      { name: "auctionPriceMultiplier", type: "uint256", indexed: false },
      { name: "auctionMinInitPrice", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SpinCore__Launched",
    inputs: [
      { name: "launcher", type: "address", indexed: true },
      { name: "rig", type: "address", indexed: true },
      { name: "unit", type: "address", indexed: true },
      { name: "auction", type: "address", indexed: false },
      { name: "lpToken", type: "address", indexed: false },
      { name: "quoteToken", type: "address", indexed: false },
      { name: "tokenName", type: "string", indexed: false },
      { name: "tokenSymbol", type: "string", indexed: false },
      { name: "uri", type: "string", indexed: false },
      { name: "usdcAmount", type: "uint256", indexed: false },
      { name: "unitAmount", type: "uint256", indexed: false },
      { name: "initialUps", type: "uint256", indexed: false },
      { name: "tailUps", type: "uint256", indexed: false },
      { name: "halvingPeriod", type: "uint256", indexed: false },
      { name: "rigEpochPeriod", type: "uint256", indexed: false },
      { name: "rigPriceMultiplier", type: "uint256", indexed: false },
      { name: "rigMinInitPrice", type: "uint256", indexed: false },
      { name: "odds", type: "uint256[]", indexed: false },
      { name: "auctionInitPrice", type: "uint256", indexed: false },
      { name: "auctionEpochPeriod", type: "uint256", indexed: false },
      { name: "auctionPriceMultiplier", type: "uint256", indexed: false },
      { name: "auctionMinInitPrice", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "FundCore__Launched",
    inputs: [
      { name: "launcher", type: "address", indexed: true },
      { name: "rig", type: "address", indexed: true },
      { name: "unit", type: "address", indexed: true },
      { name: "recipient", type: "address", indexed: false },
      { name: "auction", type: "address", indexed: false },
      { name: "lpToken", type: "address", indexed: false },
      { name: "quoteToken", type: "address", indexed: false },
      { name: "tokenName", type: "string", indexed: false },
      { name: "tokenSymbol", type: "string", indexed: false },
      { name: "uri", type: "string", indexed: false },
      { name: "usdcAmount", type: "uint256", indexed: false },
      { name: "unitAmount", type: "uint256", indexed: false },
      { name: "initialEmission", type: "uint256", indexed: false },
      { name: "minEmission", type: "uint256", indexed: false },
      { name: "halvingPeriod", type: "uint256", indexed: false },
      { name: "auctionInitPrice", type: "uint256", indexed: false },
      { name: "auctionEpochPeriod", type: "uint256", indexed: false },
      { name: "auctionPriceMultiplier", type: "uint256", indexed: false },
      { name: "auctionMinInitPrice", type: "uint256", indexed: false },
    ],
  },
] as const;

export default function LaunchPage() {
  const router = useRouter();
  const { address: account, isConnected, isConnecting, connect } = useFarcaster();
  const { execute, status: txStatus, txHash, batchReceipts, error: txError, reset: resetTx } = useBatchedTransaction();

  // Extract rig address from tx receipt (sequential mode)
  const [launchedRigAddress, setLaunchedRigAddress] = useState<string | null>(null);
  const { data: txReceipt } = useWaitForTransactionReceipt({
    hash: txHash as `0x${string}` | undefined,
  });

  // Helper to extract rig address from parsed logs
  const extractRigAddress = (logs: readonly { address: string; topics: readonly string[]; data: string }[]) => {
    try {
      const parsed = parseEventLogs({
        abi: LAUNCHED_EVENT_ABIS,
        logs: logs as Parameters<typeof parseEventLogs>["0"]["logs"],
      });
      const launchedEvent = parsed.find(
        (e) =>
          e.eventName === "MineCore__Launched" ||
          e.eventName === "SpinCore__Launched" ||
          e.eventName === "FundCore__Launched"
      );
      if (launchedEvent?.args && "rig" in launchedEvent.args) {
        return launchedEvent.args.rig as string;
      }
    } catch (err) {
      console.error("Failed to parse launch event logs:", err);
    }
    return null;
  };

  // Parse from sequential tx receipt
  useEffect(() => {
    if (!txReceipt?.logs || launchedRigAddress) return;
    const rig = extractRigAddress(txReceipt.logs);
    if (rig) setLaunchedRigAddress(rig);
  }, [txReceipt, launchedRigAddress]);

  // Parse from EIP-5792 batch receipts (batch mode may not populate txHash)
  useEffect(() => {
    if (!batchReceipts || launchedRigAddress) return;
    for (const receipt of batchReceipts) {
      if (receipt.logs) {
        const rig = extractRigAddress(receipt.logs as never);
        if (rig) {
          setLaunchedRigAddress(rig);
          break;
        }
      }
    }
  }, [batchReceipts, launchedRigAddress]);

  // Read user's USDC balance
  const { data: usdcBalance } = useReadContract({
    address: CONTRACT_ADDRESSES.usdc as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: account ? [account] : undefined,
    query: { enabled: !!account },
  });

  // Rig type selection
  const [rigType, setRigType] = useState<RigType>(null);

  // Basic info
  const [tokenName, setTokenName] = useState("");
  const [tokenSymbol, setTokenSymbol] = useState("");
  const [tokenDescription, setTokenDescription] = useState("");
  const [miningMessage, setMiningMessage] = useState("");
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);

  // FundRig-specific fields
  const [recipientName, setRecipientName] = useState("");
  const [recipientAddress, setRecipientAddress] = useState("");

  // Advanced settings
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Liquidity
  const [usdcAmount, setUsdcAmount] = useState(DEFAULTS.mine.usdcAmount);
  const [unitAmount, setUnitAmount] = useState(DEFAULTS.mine.unitAmount);

  // Emission
  const [initialUps, setInitialUps] = useState(DEFAULTS.mine.initialUps);
  const [tailUps, setTailUps] = useState(DEFAULTS.mine.tailUps);
  const [halvingAmount, setHalvingAmount] = useState(DEFAULTS.mine.halvingAmount);
  const [halvingPeriod, setHalvingPeriod] = useState(DEFAULTS.spin.halvingPeriod);

  // Mining/Spin specific
  const [rigEpochPeriod, setRigEpochPeriod] = useState(DEFAULTS.mine.rigEpochPeriod);
  const [rigPriceMultiplier, setRigPriceMultiplier] = useState(DEFAULTS.mine.rigPriceMultiplier);
  const [rigMinInitPrice, setRigMinInitPrice] = useState(DEFAULTS.mine.rigMinInitPrice);

  // Spin odds (basis points)
  const [spinOddsRows, setSpinOddsRows] = useState<DistributionRow[]>(
    () => arrayToDistributionRows(DEFAULTS.spin.odds)
  );

  // Mine multipliers
  const [mineMultiplierRows, setMineMultiplierRows] = useState<DistributionRow[]>(
    () => arrayToDistributionRows(DEFAULTS.mine.upsMultipliers)
  );
  const [upsMultiplierDuration, setUpsMultiplierDuration] = useState(DEFAULTS.mine.upsMultiplierDuration);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Auto-reset error state after 10 seconds so button reverts to normal
  useEffect(() => {
    if (txStatus !== "error" && !launchError) return;
    if (launchError) console.error("[Launch Error]", launchError);
    if (txStatus === "error") console.error("[Tx Error]", txStatus);
    const timer = setTimeout(() => {
      resetTx();
      setLaunchError(null);
    }, 10000);
    return () => clearTimeout(timer);
  }, [txStatus, launchError, resetTx]);

  const spinOddsConfig = useMemo(
    () =>
      buildDistributionArray(spinOddsRows, {
        min: SPIN_ODDS_BPS_MIN,
        max: SPIN_ODDS_BPS_MAX,
        valueDecimals: 0,
        integerValues: true,
      }),
    [spinOddsRows]
  );

  const mineMultiplierConfig = useMemo(
    () =>
      buildDistributionArray(mineMultiplierRows, {
        min: MINE_MULTIPLIER_MIN,
        max: MINE_MULTIPLIER_MAX,
        valueDecimals: 1,
      }),
    [mineMultiplierRows]
  );

  const odds = spinOddsConfig.isValid ? spinOddsConfig.array : [];
  const upsMultipliers = mineMultiplierConfig.isValid ? mineMultiplierConfig.array : [];


  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setLogoFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setLogoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRigTypeSelect = (type: "mine" | "spin" | "fund") => {
    setRigType(type);
    // Reset to defaults for selected rig type
    if (type === "mine") {
      const defaults = DEFAULTS.mine;
      setUsdcAmount(defaults.usdcAmount);
      setUnitAmount(defaults.unitAmount);
      setInitialUps(defaults.initialUps);
      setTailUps(defaults.tailUps);
      setHalvingAmount(defaults.halvingAmount);
      setRigEpochPeriod(defaults.rigEpochPeriod);
      setRigPriceMultiplier(defaults.rigPriceMultiplier);
      setRigMinInitPrice(defaults.rigMinInitPrice);
      setMineMultiplierRows(arrayToDistributionRows(defaults.upsMultipliers));
      setUpsMultiplierDuration(defaults.upsMultiplierDuration);
    } else if (type === "spin") {
      const defaults = DEFAULTS.spin;
      setUsdcAmount(defaults.usdcAmount);
      setUnitAmount(defaults.unitAmount);
      setInitialUps(defaults.initialUps);
      setTailUps(defaults.tailUps);
      setHalvingPeriod(defaults.halvingPeriod);
      setRigEpochPeriod(defaults.rigEpochPeriod);
      setRigPriceMultiplier(defaults.rigPriceMultiplier);
      setRigMinInitPrice(defaults.rigMinInitPrice);
      setSpinOddsRows(arrayToDistributionRows(defaults.odds));
    } else if (type === "fund") {
      const defaults = DEFAULTS.fund;
      setUsdcAmount(defaults.usdcAmount);
      setUnitAmount(defaults.unitAmount);
      setInitialUps(defaults.initialUps);
      setTailUps(defaults.tailUps);
      setHalvingPeriod(defaults.halvingPeriod);
    }
  };

  const resetAdvancedToDefaults = () => {
    if (rigType === "mine") {
      const defaults = DEFAULTS.mine;
      setUsdcAmount(defaults.usdcAmount);
      setUnitAmount(defaults.unitAmount);
      setInitialUps(defaults.initialUps);
      setTailUps(defaults.tailUps);
      setHalvingAmount(defaults.halvingAmount);
      setRigEpochPeriod(defaults.rigEpochPeriod);
      setRigPriceMultiplier(defaults.rigPriceMultiplier);
      setRigMinInitPrice(defaults.rigMinInitPrice);
      setMineMultiplierRows(arrayToDistributionRows(defaults.upsMultipliers));
      setUpsMultiplierDuration(defaults.upsMultiplierDuration);
    } else if (rigType === "spin") {
      const defaults = DEFAULTS.spin;
      setUsdcAmount(defaults.usdcAmount);
      setUnitAmount(defaults.unitAmount);
      setInitialUps(defaults.initialUps);
      setTailUps(defaults.tailUps);
      setHalvingPeriod(defaults.halvingPeriod);
      setRigEpochPeriod(defaults.rigEpochPeriod);
      setRigPriceMultiplier(defaults.rigPriceMultiplier);
      setRigMinInitPrice(defaults.rigMinInitPrice);
      setSpinOddsRows(arrayToDistributionRows(defaults.odds));
    } else if (rigType === "fund") {
      const defaults = DEFAULTS.fund;
      setUsdcAmount(defaults.usdcAmount);
      setUnitAmount(defaults.unitAmount);
      setInitialUps(defaults.initialUps);
      setTailUps(defaults.tailUps);
      setHalvingPeriod(defaults.halvingPeriod);
    }
  };

  const handleBack = () => {
    setRigType(null);
  };

  // Validate Ethereum address format
  const isValidAddress = (address: string) => {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  };

  // Form validation
  const isFormValid = (() => {
    if (!logoFile) return false;
    if (!tokenName.trim().length || !tokenSymbol.trim().length) return false;
    if (!tokenDescription.trim().length || !miningMessage.trim().length) return false;
    if (rigType === "fund") {
      if (!recipientName.trim().length) return false;
      if (!isValidAddress(recipientAddress)) return false;
    }
    if (rigType === "spin" && !spinOddsConfig.isValid) return false;
    if (rigType === "mine" && (!mineMultiplierConfig.isValid || upsMultipliers.length === 0)) return false;
    return true;
  })();

  const isLaunching = txStatus === "pending" || txStatus === "confirming";

  const uploadLogoToPinata = async (): Promise<string> => {
    if (!logoFile) return "";
    const formData = new FormData();
    formData.append("file", logoFile);
    formData.append("tokenSymbol", tokenSymbol);

    const res = await fetch("/api/pinata/upload", {
      method: "POST",
      body: formData,
    });
    const data = await res.json();
    if (!res.ok || !data?.ipfsUrl) {
      throw new Error(data?.error || "Logo upload failed");
    }
    return data.ipfsUrl as string;
  };

  const uploadMetadataToPinata = async (imageUrl: string): Promise<string> => {
    const res = await fetch("/api/pinata/metadata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: tokenName,
        symbol: tokenSymbol,
        image: imageUrl,
        description: tokenDescription,
        defaultMessage: miningMessage || "gm",
        ...(rigType === "fund" && recipientName ? { recipientName } : {}),
        links: [],
      }),
    });
    const data = await res.json();
    if (!res.ok || !data?.ipfsUrl) {
      throw new Error(data?.error || "Metadata upload failed");
    }
    return data.ipfsUrl as string;
  };

  const handleLaunch = async () => {
    if (!rigType) return;
    if (!isFormValid || isLaunching) return;

    setLaunchError(null);

    let launcher = account;
    if (!launcher) {
      try {
        launcher = await connect();
      } catch (err) {
        setLaunchError("Wallet connection failed.");
        return;
      }
    }

    if (!launcher) {
      setLaunchError("Wallet not connected.");
      return;
    }

    try {
      // Upload metadata (required for Mine/Spin/Fund rigs at launch)
      let uri = "";
      if (rigType === "mine" || rigType === "spin" || rigType === "fund") {
        setIsUploading(true);
        const logoIpfsUrl = await uploadLogoToPinata();
        uri = await uploadMetadataToPinata(logoIpfsUrl);
        setIsUploading(false);
      }

      const usdcAmountWei = parseUnits(usdcAmount.toString(), QUOTE_TOKEN_DECIMALS);
      const unitAmountWei = parseUnits(unitAmount.toString(), 18);

      const rigEpochPeriodWei = BigInt(rigEpochPeriod);
      const rigPriceMultiplierWei = parseUnits(rigPriceMultiplier.toString(), 18);
      const rigMinInitPriceWei = parseUnits(rigMinInitPrice.toString(), QUOTE_TOKEN_DECIMALS);

      // Compute auction price in LP tokens to target a dollar value
      // Formula: auctionLpPrice = targetUsd / (2e6 * sqrt(usdcAmount / unitAmount))
      const defaults = DEFAULTS[rigType!];
      const auctionTargetUsd = defaults.auctionTargetUsd;
      const auctionLpPrice = auctionTargetUsd / (2_000_000 * Math.sqrt(usdcAmount / unitAmount));
      const auctionInitPriceWei = parseUnits(auctionLpPrice.toFixed(18), 18);
      const auctionMinInitPriceWei = auctionInitPriceWei;
      const auctionEpochPeriodWei = BigInt(defaults.auctionEpochPeriod);
      const auctionPriceMultiplierWei = parseUnits(defaults.auctionPriceMultiplier.toString(), 18);

      const quoteToken = CONTRACT_ADDRESSES.usdc as `0x${string}`;

      let multicallAddress: `0x${string}`;
      let multicallAbi: readonly unknown[];
      let launchParams: Record<string, unknown>;

      if (rigType === "mine") {
        const initialUpsWei = parseUnits(initialUps.toString(), 18);
        const tailUpsWei = parseUnits(tailUps.toString(), 18);
        const halvingAmountWei = parseUnits(halvingAmount.toString(), 18);
        const upsMultipliersWei = upsMultipliers.map((m) => parseUnits(m.toString(), 18));

        multicallAddress = CONTRACT_ADDRESSES.mineMulticall as `0x${string}`;
        multicallAbi = MULTICALL_ABI;
        launchParams = {
          launcher,
          quoteToken,
          tokenName,
          tokenSymbol,
          uri,
          usdcAmount: usdcAmountWei,
          unitAmount: unitAmountWei,
          initialUps: initialUpsWei,
          tailUps: tailUpsWei,
          halvingAmount: halvingAmountWei,
          rigEpochPeriod: rigEpochPeriodWei,
          rigPriceMultiplier: rigPriceMultiplierWei,
          rigMinInitPrice: rigMinInitPriceWei,
          upsMultipliers: upsMultipliersWei,
          upsMultiplierDuration: BigInt(upsMultiplierDuration),
          auctionInitPrice: auctionInitPriceWei,
          auctionEpochPeriod: auctionEpochPeriodWei,
          auctionPriceMultiplier: auctionPriceMultiplierWei,
          auctionMinInitPrice: auctionMinInitPriceWei,
        };
      } else if (rigType === "spin") {
        const initialUpsWei = parseUnits(initialUps.toString(), 18);
        const tailUpsWei = parseUnits(tailUps.toString(), 18);

        multicallAddress = CONTRACT_ADDRESSES.spinMulticall as `0x${string}`;
        multicallAbi = SPIN_MULTICALL_ABI;
        launchParams = {
          launcher,
          quoteToken,
          tokenName,
          tokenSymbol,
          uri,
          usdcAmount: usdcAmountWei,
          unitAmount: unitAmountWei,
          initialUps: initialUpsWei,
          tailUps: tailUpsWei,
          halvingPeriod: BigInt(halvingPeriod),
          rigEpochPeriod: rigEpochPeriodWei,
          rigPriceMultiplier: rigPriceMultiplierWei,
          rigMinInitPrice: rigMinInitPriceWei,
          odds: odds.map((o) => BigInt(o)),
          auctionInitPrice: auctionInitPriceWei,
          auctionEpochPeriod: auctionEpochPeriodWei,
          auctionPriceMultiplier: auctionPriceMultiplierWei,
          auctionMinInitPrice: auctionMinInitPriceWei,
        };
      } else {
        const initialEmissionWei = parseUnits(initialUps.toString(), 18);
        const minEmissionWei = parseUnits(tailUps.toString(), 18);
        const halvingPeriodDays = Math.max(1, Math.round(halvingPeriod / 86400));

        multicallAddress = CONTRACT_ADDRESSES.fundMulticall as `0x${string}`;
        multicallAbi = FUND_MULTICALL_ABI;
        launchParams = {
          launcher,
          quoteToken,
          recipient: recipientAddress as `0x${string}`,
          tokenName,
          tokenSymbol,
          uri,
          usdcAmount: usdcAmountWei,
          unitAmount: unitAmountWei,
          initialEmission: initialEmissionWei,
          minEmission: minEmissionWei,
          halvingPeriod: BigInt(halvingPeriodDays),
          auctionInitPrice: auctionInitPriceWei,
          auctionEpochPeriod: auctionEpochPeriodWei,
          auctionPriceMultiplier: auctionPriceMultiplierWei,
          auctionMinInitPrice: auctionMinInitPriceWei,
        };
      }

      const calls: Call[] = [
        encodeApproveCall(quoteToken, multicallAddress, usdcAmountWei),
        encodeContractCall(multicallAddress, multicallAbi, "launch", [launchParams]),
      ];

      await execute(calls);
    } catch (err) {
      setIsUploading(false);
      setLaunchError(err instanceof Error ? err.message : "Launch failed.");
    }
  };

  // Format helpers
  const formatDuration = (seconds: number) => {
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
    return `${Math.round(seconds / 86400)}d`;
  };

  const formatNumber = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  };

  const formatMultiplier = (n: number) => `${n.toFixed(1)}x`;

  const formatPrice = (n: number) => `$${n.toFixed(2)}`;

  const formatLp = (n: number) => `${n.toFixed(4)} LP`;

  const formatRate = (n: number) => `${n}/s`;

  const formatDailyRate = (n: number) => `${formatNumber(n)}/day`;

  // Get action label based on rig type
  const getActionLabel = () => {
    switch (rigType) {
      case "mine":
        return "Mining message";
      case "spin":
        return "Spin message";
      case "fund":
        return "Funding message";
      default:
        return "Message";
    }
  };

  return (
    <main className="fixed inset-0 z-[100] flex h-screen w-screen justify-center bg-zinc-800">
      <div
        className="relative flex h-full w-full max-w-[520px] flex-col bg-background"
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 8px)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 120px)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-2">
          <button
            onClick={() => rigType ? handleBack() : router.back()}
            className="p-2 -ml-2 rounded-xl hover:bg-secondary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          <span className="text-base font-semibold">
            {rigType ? `Launch ${RIG_INFO[rigType].name} Rig` : "Launch"}
          </span>
          <div className="w-9" />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto scrollbar-hide px-4 pt-2">
          {rigType === null ? (
            // Rig Type Selection
            <div className="space-y-4">
              <div className="mb-6">
                <h2 className="font-semibold text-foreground mb-2">
                  Choose how your coin is mined
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Pick the mining model for your coin. You can adjust emissions,
                  halving, and pricing behavior before launch.
                </p>
              </div>
              <RigTypeCard type="mine" onSelect={() => handleRigTypeSelect("mine")} />
              <RigTypeCard type="spin" onSelect={() => handleRigTypeSelect("spin")} />
              <RigTypeCard type="fund" onSelect={() => handleRigTypeSelect("fund")} />
            </div>
          ) : (
            // Token Details Form
            <div className="space-y-4">
              {/* Logo + Name + Symbol Row */}
              <div className="flex items-start gap-4">
                {/* Logo Upload */}
                <label className="cursor-pointer flex-shrink-0">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleLogoChange}
                    className="hidden"
                  />
                  <div className="w-[88px] h-[88px] rounded-xl ring-1 ring-zinc-700 flex items-center justify-center overflow-hidden hover:ring-zinc-500 transition-colors">
                    {logoPreview ? (
                      <img
                        src={logoPreview}
                        alt="Coin logo"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Upload className="w-6 h-6 text-zinc-500" />
                    )}
                  </div>
                </label>

                {/* Name + Symbol */}
                <div className="flex-1 min-w-0 space-y-2">
                  <input
                    type="text"
                    placeholder="Coin name"
                    value={tokenName}
                    onChange={(e) => setTokenName(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg bg-transparent ring-1 ring-zinc-700 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-zinc-500 text-sm"
                  />
                  <input
                    type="text"
                    placeholder="SYMBOL"
                    value={tokenSymbol}
                    onChange={(e) => setTokenSymbol(e.target.value.toUpperCase())}
                    maxLength={10}
                    className="w-full h-10 px-3 rounded-lg bg-transparent ring-1 ring-zinc-700 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-zinc-500 text-sm"
                  />
                </div>
              </div>

              {/* Description */}
              <textarea
                placeholder="Description"
                value={tokenDescription}
                onChange={(e) => setTokenDescription(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 rounded-lg bg-transparent ring-1 ring-zinc-700 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-zinc-500 resize-none text-sm"
              />

              {/* Action Message */}
              <input
                type="text"
                placeholder={getActionLabel()}
                value={miningMessage}
                onChange={(e) => setMiningMessage(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-transparent ring-1 ring-zinc-700 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-zinc-500 text-sm"
              />

              {/* FundRig-specific fields */}
              {rigType === "fund" && (
                <div className="space-y-2 pt-2">
                  <div className="space-y-1 mb-2">
                    <div className="text-[13px] font-semibold text-foreground">Recipient</div>
                    <p className="text-[11px] text-muted-foreground">
                      The wallet that receives 50% of every funding payment.
                    </p>
                  </div>
                  <input
                    type="text"
                    placeholder="Recipient name"
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg bg-transparent ring-1 ring-zinc-700 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-zinc-500 text-sm"
                  />
                  <input
                    type="text"
                    placeholder="Recipient wallet address (0x...)"
                    value={recipientAddress}
                    onChange={(e) => setRecipientAddress(e.target.value)}
                    className={`w-full h-10 px-3 rounded-lg bg-transparent ring-1 text-white placeholder:text-zinc-500 focus:outline-none text-sm ${
                      recipientAddress.length > 0 && !isValidAddress(recipientAddress)
                        ? "ring-zinc-500/50 focus:ring-zinc-500"
                        : "ring-zinc-700 focus:ring-zinc-500"
                    }`}
                  />
                  {recipientAddress.length > 0 && !isValidAddress(recipientAddress) && (
                    <p className="text-[11px] text-zinc-400">Enter a valid Ethereum address</p>
                  )}
                </div>
              )}

              {/* Advanced Settings Toggle */}
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="w-full flex items-center justify-between py-3 text-sm text-zinc-400 hover:text-zinc-300 transition-colors"
              >
                <span>Advanced Parameters</span>
                {showAdvanced ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>

              {/* Settings Summary (only when Advanced collapsed) */}
              {!showAdvanced && (
                <SettingsSummary
                  rigType={rigType}
                  usdcAmount={usdcAmount}
                  unitAmount={unitAmount}
                  initialUps={initialUps}
                  tailUps={tailUps}
                  halvingAmount={halvingAmount}
                  halvingPeriod={halvingPeriod}
                  rigEpochPeriod={rigEpochPeriod}
                  rigPriceMultiplier={rigPriceMultiplier}
                  rigMinInitPrice={rigMinInitPrice}
                  upsMultipliers={upsMultipliers}
                  odds={odds}
                />
              )}

              {/* Advanced Settings */}
              {showAdvanced && (
                <div className="space-y-6 pb-4">
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={resetAdvancedToDefaults}
                      className="text-[12px] text-zinc-500 hover:text-zinc-300 transition-colors"
                    >
                      Reset to defaults
                    </button>
                  </div>
                  {/* Liquidity Section */}
                  <div>
                    <h3 className="text-[13px] font-semibold text-foreground mb-1">Launch Liquidity</h3>
                    <p className="text-muted-foreground text-[11px] mb-2">
                      Sets the initial coin/USDC pool and starting market price. Initial LP is locked at launch.
                    </p>
                    <Slider
                      label="USDC Side"
                      value={usdcAmount}
                      onChange={setUsdcAmount}
                      min={1}
                      max={1000}
                      step={1}
                      formatValue={formatNumber}
                      description="USDC paired into the initial LP."
                    />
                    <Slider
                      label="Coin Side"
                      value={unitAmount}
                      onChange={setUnitAmount}
                      min={100}
                      max={100000000}
                      step={100}
                      formatValue={formatNumber}
                      description="Coin amount paired against USDC in the initial LP."
                    />
                    {/* Initial LP Summary */}
                    {(() => {
                      // USDC = $1, so price in USD = usdcAmount / unitAmount
                      const initialPriceUsdc = usdcAmount / unitAmount;
                      const initialPriceUsd = initialPriceUsdc; // USDC = $1
                      const marketCapUsd = unitAmount * initialPriceUsd;

                      const formatUsd = (n: number) => {
                        if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
                        if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
                        if (n >= 1) return `$${n.toFixed(2)}`;
                        if (n >= 0.01) return `$${n.toFixed(4)}`;
                        return `$${n.toFixed(6)}`;
                      };

                      return (
                        <div className="rounded-xl ring-1 ring-zinc-700 bg-zinc-800/40 p-3 space-y-2 mt-3">
                          <div className="text-[13px] font-semibold text-foreground">Launch Snapshot</div>
                          <div className="space-y-1.5 text-[12px]">
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">Initial Price</span>
                              <div className="text-right">
                                <span className="font-semibold text-foreground tabular-nums">
                                  ${initialPriceUsdc.toFixed(6)}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">Initial Liquidity</span>
                              <div className="text-right">
                                <span className="font-semibold text-foreground tabular-nums">
                                  ${formatNumber(usdcAmount)} + {formatNumber(unitAmount)} coins
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">Initial Market Cap</span>
                              <span className="font-semibold text-foreground tabular-nums">{formatUsd(marketCapUsd)}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Emission Section */}
                  <div>
                    <h3 className="text-[13px] font-semibold text-foreground mb-1">Emission Schedule</h3>
                    <p className="text-muted-foreground text-[11px] mb-2">
                      {rigType === "fund"
                        ? "Daily emissions distributed to funders based on contribution share."
                        : "Continuous coin emissions with halving and a configurable floor rate."}
                    </p>
                    {rigType === "fund" ? (
                      // FundRig: daily rates
                      <>
                        <Slider
                          label="Starting Emission"
                          value={initialUps}
                          onChange={(v) => {
                            setInitialUps(v);
                            if (tailUps > v) setTailUps(v);
                          }}
                          min={1000}
                          max={500000}
                          step={1000}
                          formatValue={formatDailyRate}
                          description="Initial daily coin emission before halvings."
                        />
                        <Slider
                          label="Floor Emission"
                          value={tailUps}
                          onChange={setTailUps}
                          min={100}
                          max={initialUps}
                          step={100}
                          formatValue={formatDailyRate}
                          description="Lowest daily emission after all halvings."
                        />
                      </>
                    ) : (
                      // MineRig/SpinRig: per-second rates
                      <>
                        <Slider
                          label="Starting Emission"
                          value={initialUps}
                          onChange={(v) => {
                            setInitialUps(v);
                            if (tailUps > v) setTailUps(v);
                          }}
                          min={1}
                          max={100}
                          formatValue={formatRate}
                          description="Initial per-second coin emission before halvings."
                        />
                        <Slider
                          label="Floor Emission"
                          value={tailUps}
                          onChange={setTailUps}
                          min={0.01}
                          max={initialUps}
                          step={0.01}
                          formatValue={formatRate}
                          description="Lowest per-second emission after all halvings."
                        />
                      </>
                    )}

                    {/* Halving - different per rig type */}
                    {rigType === "mine" && (
                      <Slider
                        label="Halving Supply Threshold"
                        value={halvingAmount}
                        onChange={setHalvingAmount}
                        min={BOUNDS.halvingAmount.min}
                        max={100000000}
                        step={1000}
                        formatValue={formatNumber}
                        description="After this many coins are minted, emission halves."
                      />
                    )}
                    {rigType === "spin" && (
                      <Slider
                        label="Halving Interval"
                        value={halvingPeriod}
                        onChange={setHalvingPeriod}
                        min={BOUNDS.halvingPeriod.min}
                        max={BOUNDS.halvingPeriod.max}
                        step={86400} // 1 day steps
                        formatValue={formatDuration}
                        description="Time between emission halvings."
                      />
                    )}
                    {rigType === "fund" && (
                      <Slider
                        label="Halving Interval"
                        value={halvingPeriod}
                        onChange={setHalvingPeriod}
                        min={BOUNDS.halvingPeriod.min}
                        max={BOUNDS.halvingPeriod.max}
                        step={86400} // 1 day steps
                        formatValue={formatDuration}
                        description="Days between daily emission halvings."
                      />
                    )}

                    {/* Emission Preview */}
                    <EmissionPreview
                      rigType={rigType}
                      initialUps={initialUps}
                      tailUps={tailUps}
                      halvingPeriod={halvingPeriod}
                      halvingAmount={halvingAmount}
                    />
                  </div>

                  {/* Mining/Spin specific settings */}
                  {(rigType === "mine" || rigType === "spin") && (
                    <div>
                      <h3 className="text-[13px] font-semibold text-foreground mb-1">
                        {rigType === "mine" ? "Mine Price Curve" : "Spin Price Curve"}
                      </h3>
                      <p className="text-muted-foreground text-[11px] mb-2">
                        Controls how fast the action price decays, then resets after each successful action.
                      </p>
                      <Slider
                        label="Price Decay Window"
                        value={rigEpochPeriod}
                        onChange={setRigEpochPeriod}
                        min={BOUNDS.epochPeriod.min}
                        max={604800} // 7 days max for good UX (contract allows up to 365 days)
                        step={600}
                        formatValue={formatDuration}
                        description="Time for price to decay from start price to zero."
                      />
                      <Slider
                        label="Reset Multiplier"
                        value={rigPriceMultiplier}
                        onChange={setRigPriceMultiplier}
                        min={BOUNDS.priceMultiplier.min}
                        max={BOUNDS.priceMultiplier.max}
                        step={0.1}
                        formatValue={formatMultiplier}
                        description={
                          rigType === "mine"
                            ? "After each successful mine, next cycle starts at price × multiplier."
                            : "After each successful spin, next cycle starts at price × multiplier."
                        }
                      />
                      <Slider
                        label="Minimum Reset Price"
                        value={rigMinInitPrice}
                        onChange={setRigMinInitPrice}
                        min={1}
                        max={100}
                        step={0.1}
                        formatValue={formatPrice}
                        description="Lower bound for cycle start price after each reset."
                      />
                    </div>
                  )}

                  {/* Spin Odds */}
                  {rigType === "spin" && (() => {
                    const addSpinRow = () => {
                      if (spinOddsRows.length >= MAX_DISTRIBUTION_ROWS) return;
                      setSpinOddsRows((prev) => [...prev, createDistributionRow(100, 0)]);
                    };

                    const balanceSpinRows = () => {
                      setSpinOddsRows((prev) => {
                        if (prev.length === 0) return prev;
                        const others = prev.slice(0, -1).reduce(
                          (sum, row) => sum + clamp(Math.floor(Number(row.probability) || 0), 0, 100),
                          0
                        );
                        const lastProbability = clamp(DISTRIBUTION_ARRAY_LENGTH - others, 0, 100);
                        return prev.map((row, idx) =>
                          idx === prev.length - 1 ? { ...row, probability: lastProbability } : row
                        );
                      });
                    };

                    return (
                      <div>
                        <h3 className="text-[13px] font-semibold text-foreground mb-1">Spin Payout Distribution</h3>
                        <p className="text-muted-foreground text-[11px] mb-3">
                          Each payout value is a percent of the current accumulated prize pool at spin time. Set values and
                          probabilities; this compiles into a 100-entry weighted array at launch.
                        </p>
                        <div className="space-y-2.5">
                          {spinOddsRows.map((row) => (
                            <div key={row.id} className="grid grid-cols-[1fr_100px_28px] gap-2 items-end">
                              <div>
                                <label className="text-[11px] text-muted-foreground mb-1 block">Pool Payout (%)</label>
                                <input
                                  type="number"
                                  min={0.1}
                                  max={80}
                                  step={0.1}
                                  value={(row.value / 100).toString()}
                                  onChange={(e) => {
                                    const nextPercent = Number(e.target.value);
                                    const nextBps = Number.isFinite(nextPercent)
                                      ? clamp(Math.round(nextPercent * 100), SPIN_ODDS_BPS_MIN, SPIN_ODDS_BPS_MAX)
                                      : SPIN_ODDS_BPS_MIN;
                                    setSpinOddsRows((prev) =>
                                      prev.map((item) => (item.id === row.id ? { ...item, value: nextBps } : item))
                                    );
                                  }}
                                  className="w-full h-9 px-2 rounded-lg bg-transparent ring-1 ring-zinc-700 text-[13px] text-white placeholder:text-zinc-500 focus:outline-none focus:ring-zinc-500"
                                />
                              </div>
                              <div>
                                <label className="text-[11px] text-muted-foreground mb-1 block">Probability</label>
                                <div className="relative">
                                  <input
                                    type="number"
                                    min={0}
                                    max={100}
                                    step={1}
                                    value={row.probability}
                                    onChange={(e) => {
                                      const nextProbability = Number(e.target.value);
                                      setSpinOddsRows((prev) =>
                                        prev.map((item) =>
                                          item.id === row.id
                                            ? {
                                                ...item,
                                                probability: Number.isFinite(nextProbability)
                                                  ? clamp(Math.floor(nextProbability), 0, 100)
                                                  : 0,
                                              }
                                            : item
                                        )
                                      );
                                    }}
                                    className="w-full h-9 px-2 pr-6 rounded-lg bg-transparent ring-1 ring-zinc-700 text-[13px] text-white placeholder:text-zinc-500 focus:outline-none focus:ring-zinc-500 tabular-nums"
                                  />
                                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-zinc-500">%</span>
                                </div>
                              </div>
                              <button
                                onClick={() => {
                                  if (spinOddsRows.length <= 1) return;
                                  setSpinOddsRows((prev) => prev.filter((item) => item.id !== row.id));
                                }}
                                disabled={spinOddsRows.length <= 1}
                                className={`h-9 w-7 rounded-lg flex items-center justify-center transition-all ${
                                  spinOddsRows.length > 1
                                    ? "bg-zinc-700 text-zinc-100 hover:bg-zinc-600"
                                    : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                                }`}
                              >
                                <Minus className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}

                          <div className="flex items-center justify-between pt-1">
                            <button
                              onClick={addSpinRow}
                              disabled={spinOddsRows.length >= MAX_DISTRIBUTION_ROWS}
                              className={`h-8 px-2.5 rounded-lg text-[12px] font-medium transition-all flex items-center gap-1 ${
                                spinOddsRows.length < MAX_DISTRIBUTION_ROWS
                                  ? "bg-zinc-700 text-zinc-100 hover:bg-zinc-600"
                                  : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                              }`}
                            >
                              <Plus className="w-3.5 h-3.5" />
                              Add outcome
                            </button>
                            <button
                              onClick={balanceSpinRows}
                              className="text-[11px] text-zinc-300 hover:text-white transition-colors"
                            >
                              Balance to 100%
                            </button>
                          </div>

                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-muted-foreground">Total probability</span>
                            <span
                              className={`font-semibold tabular-nums ${
                                spinOddsConfig.totalProbability === DISTRIBUTION_ARRAY_LENGTH
                                  ? "text-zinc-300"
                                  : "text-zinc-400"
                              }`}
                            >
                              {spinOddsConfig.totalProbability}%
                            </span>
                          </div>

                          {spinOddsConfig.error && (
                            <div className="rounded-lg ring-1 ring-zinc-500/30 bg-zinc-500/10 px-2.5 py-1.5 text-[11px] text-zinc-300">
                              {spinOddsConfig.error}
                            </div>
                          )}

                          <p className="text-[11px] text-muted-foreground">
                            Stored smallest-first at launch. The smallest payout is used when randomness is turned off.
                            Example: 5 means a 5% payout of the current pool.
                          </p>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Mine Multipliers */}
                  {rigType === "mine" && (() => {
                    const addMultiplierRow = () => {
                      if (mineMultiplierRows.length >= MAX_DISTRIBUTION_ROWS) return;
                      setMineMultiplierRows((prev) => [...prev, createDistributionRow(1, 0)]);
                    };

                    const balanceMultiplierRows = () => {
                      setMineMultiplierRows((prev) => {
                        if (prev.length === 0) return prev;
                        const others = prev.slice(0, -1).reduce(
                          (sum, row) => sum + clamp(Math.floor(Number(row.probability) || 0), 0, 100),
                          0
                        );
                        const lastProbability = clamp(DISTRIBUTION_ARRAY_LENGTH - others, 0, 100);
                        return prev.map((row, idx) =>
                          idx === prev.length - 1 ? { ...row, probability: lastProbability } : row
                        );
                      });
                    };

                    const durationOptions = [
                      { value: 3600, label: "1h" },
                      { value: 14400, label: "4h" },
                      { value: 43200, label: "12h" },
                      { value: 86400, label: "24h" },
                      { value: 172800, label: "2d" },
                      { value: 604800, label: "7d" },
                    ];

                    return (
                      <div>
                        <h3 className="text-[13px] font-semibold text-foreground mb-1">Mine Multiplier Distribution</h3>
                        <p className="text-muted-foreground text-[11px] mb-3">
                          Enter multiplier values and probabilities. This compiles into a 100-entry weighted array at launch.
                        </p>
                        <div className="space-y-2.5 mb-3">
                          {mineMultiplierRows.map((row) => (
                            <div key={row.id} className="grid grid-cols-[1fr_100px_28px] gap-2 items-end">
                              <div>
                                <label className="text-[11px] text-muted-foreground mb-1 block">Multiplier (x)</label>
                                <input
                                  type="number"
                                  min={MINE_MULTIPLIER_MIN}
                                  max={MINE_MULTIPLIER_MAX}
                                  step={0.1}
                                  value={row.value.toString()}
                                  onChange={(e) => {
                                    const nextMultiplier = Number(e.target.value);
                                    const rounded = Number.isFinite(nextMultiplier)
                                      ? Math.round(clamp(nextMultiplier, MINE_MULTIPLIER_MIN, MINE_MULTIPLIER_MAX) * 10) / 10
                                      : MINE_MULTIPLIER_MIN;
                                    setMineMultiplierRows((prev) =>
                                      prev.map((item) => (item.id === row.id ? { ...item, value: rounded } : item))
                                    );
                                  }}
                                  className="w-full h-9 px-2 rounded-lg bg-transparent ring-1 ring-zinc-700 text-[13px] text-white placeholder:text-zinc-500 focus:outline-none focus:ring-zinc-500"
                                />
                              </div>
                              <div>
                                <label className="text-[11px] text-muted-foreground mb-1 block">Probability</label>
                                <div className="relative">
                                  <input
                                    type="number"
                                    min={0}
                                    max={100}
                                    step={1}
                                    value={row.probability}
                                    onChange={(e) => {
                                      const nextProbability = Number(e.target.value);
                                      setMineMultiplierRows((prev) =>
                                        prev.map((item) =>
                                          item.id === row.id
                                            ? {
                                                ...item,
                                                probability: Number.isFinite(nextProbability)
                                                  ? clamp(Math.floor(nextProbability), 0, 100)
                                                  : 0,
                                              }
                                            : item
                                        )
                                      );
                                    }}
                                    className="w-full h-9 px-2 pr-6 rounded-lg bg-transparent ring-1 ring-zinc-700 text-[13px] text-white placeholder:text-zinc-500 focus:outline-none focus:ring-zinc-500 tabular-nums"
                                  />
                                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-zinc-500">%</span>
                                </div>
                              </div>
                              <button
                                onClick={() => {
                                  if (mineMultiplierRows.length <= 1) return;
                                  setMineMultiplierRows((prev) => prev.filter((item) => item.id !== row.id));
                                }}
                                disabled={mineMultiplierRows.length <= 1}
                                className={`h-9 w-7 rounded-lg flex items-center justify-center transition-all ${
                                  mineMultiplierRows.length > 1
                                    ? "bg-zinc-700 text-zinc-100 hover:bg-zinc-600"
                                    : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                                }`}
                              >
                                <Minus className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}

                          <div className="flex items-center justify-between pt-1">
                            <button
                              onClick={addMultiplierRow}
                              disabled={mineMultiplierRows.length >= MAX_DISTRIBUTION_ROWS}
                              className={`h-8 px-2.5 rounded-lg text-[12px] font-medium transition-all flex items-center gap-1 ${
                                mineMultiplierRows.length < MAX_DISTRIBUTION_ROWS
                                  ? "bg-zinc-700 text-zinc-100 hover:bg-zinc-600"
                                  : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                              }`}
                            >
                              <Plus className="w-3.5 h-3.5" />
                              Add outcome
                            </button>
                            <button
                              onClick={balanceMultiplierRows}
                              className="text-[11px] text-zinc-300 hover:text-white transition-colors"
                            >
                              Balance to 100%
                            </button>
                          </div>

                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-muted-foreground">Total probability</span>
                            <span
                              className={`font-semibold tabular-nums ${
                                mineMultiplierConfig.totalProbability === DISTRIBUTION_ARRAY_LENGTH
                                  ? "text-zinc-300"
                                  : "text-zinc-400"
                              }`}
                            >
                              {mineMultiplierConfig.totalProbability}%
                            </span>
                          </div>

                          {mineMultiplierConfig.error && (
                            <div className="rounded-lg ring-1 ring-zinc-500/30 bg-zinc-500/10 px-2.5 py-1.5 text-[11px] text-zinc-300">
                              {mineMultiplierConfig.error}
                            </div>
                          )}

                          <p className="text-[11px] text-muted-foreground">
                            Stored smallest-first at launch. If randomness is turned off later, Mine rigs use fixed 1x.
                          </p>
                        </div>
                        <div>
                          <label className="text-muted-foreground text-[12px] mb-1 block">
                            Multiplier Duration
                          </label>
                          <p className="text-[11px] text-muted-foreground mb-2">
                            How long a drawn multiplier stays active before a new draw can apply.
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {durationOptions.map((opt) => (
                              <button
                                key={opt.value}
                                onClick={() => setUpsMultiplierDuration(opt.value)}
                                className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
                                  upsMultiplierDuration === opt.value
                                    ? "bg-white text-black"
                                    : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                                }`}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                </div>
              )}
            </div>
          )}
        </div>

        {/* Bottom Action Bar (only show when rig type selected) */}
        {rigType !== null && (
          <div
            className="fixed bottom-0 left-0 right-0 z-50 bg-background flex justify-center"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 32px)" }}
          >
            <div className="flex items-center justify-between w-full max-w-[520px] px-4 py-3 bg-background">
              <div className="flex items-center gap-5">
                <div>
                  <div className="text-muted-foreground text-[12px]">Pay</div>
                  <div className="font-semibold text-[17px] tabular-nums">
                    ${formatNumber(usdcAmount)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[12px]">Balance</div>
                  <div className="font-semibold text-[17px] tabular-nums">
                    ${formatNumber(usdcBalance ? Number(formatUnits(usdcBalance, QUOTE_TOKEN_DECIMALS)) : 0)}
                  </div>
                </div>
              </div>
              {!isConnected ? (
                <button
                  onClick={() => connect()}
                  disabled={isConnecting}
                  className="w-40 h-10 text-[14px] font-semibold rounded-xl bg-white text-black hover:bg-zinc-200 transition-colors disabled:opacity-50"
                >
                  {isConnecting ? "Connecting..." : "Connect Wallet"}
                </button>
              ) : (
                <button
                  onClick={handleLaunch}
                  disabled={!isFormValid || isLaunching || isUploading}
                  className={`w-32 h-10 text-[14px] font-semibold rounded-xl transition-all ${
                    launchError || txStatus === "error"
                      ? "bg-zinc-700 text-zinc-300"
                      : !isFormValid || isLaunching || isUploading
                      ? "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                      : "bg-white text-black hover:bg-zinc-200"
                  }`}
                >
                  {launchError || txStatus === "error"
                    ? txError?.message?.includes("cancelled") ? "Rejected" : "Failed"
                    : isUploading
                    ? "Uploading..."
                    : isLaunching
                    ? "Launching..."
                    : "Launch"}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Success Modal - contained within phone screen */}
      {txStatus === "success" && txHash && (
        <div className="fixed inset-0 z-[100] flex h-screen w-screen justify-center bg-zinc-800">
          <div
            className="relative flex h-full w-full max-w-[520px] flex-col bg-background items-center justify-center px-6"
            style={{
              paddingTop: "calc(env(safe-area-inset-top, 0px) + 8px)",
              paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 70px)",
            }}
          >
            <div className="text-center space-y-6 max-w-xs">
              {/* Token preview first for visual hierarchy */}
              {logoPreview && (
                <div className="flex justify-center">
                  <img src={logoPreview} alt={tokenName} className="w-24 h-24 rounded-full object-cover ring-2 ring-zinc-700" />
                </div>
              )}

              {/* Message */}
              <div>
                <h2 className="text-2xl font-bold text-white mb-2">Coin Launched!</h2>
                <p className="text-zinc-400 text-[15px]">
                  <span className="font-semibold text-white">{tokenName}</span>
                  {" "}({tokenSymbol}) is now live
                </p>
              </div>

              {/* Actions */}
              <div className="space-y-3 pt-2 w-full">
                <Link
                  href={launchedRigAddress ? `/rig/${launchedRigAddress}` : "/explore"}
                  className="block w-full py-3.5 px-4 bg-white text-black font-semibold text-[15px] rounded-xl hover:bg-zinc-200 transition-colors"
                >
                  View Coin
                </Link>
                <a
                  href={`https://basescan.org/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full py-3.5 px-4 bg-zinc-800 text-white font-semibold text-[15px] rounded-xl hover:bg-zinc-700 transition-colors"
                >
                  View on Basescan
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

    </main>
  );
}
