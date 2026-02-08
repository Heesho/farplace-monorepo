"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { X, Loader2, CheckCircle } from "lucide-react";
import { formatUnits, formatEther } from "viem";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Leaderboard } from "@/components/leaderboard";
import { SpinHistoryItem } from "@/components/spin-history-item";
import { useFarcaster } from "@/hooks/useFarcaster";
import { useBatchProfiles } from "@/hooks/useBatchProfiles";
import { useSpinRigState } from "@/hooks/useSpinRigState";
import { useSpinHistory } from "@/hooks/useSpinHistory";
import { useSpinLeaderboard } from "@/hooks/useSpinLeaderboard";
import { useTokenMetadata } from "@/hooks/useMetadata";
import {
  useBatchedTransaction,
  encodeApproveCall,
  encodeContractCall,
  type Call,
} from "@/hooks/useBatchedTransaction";
import {
  CONTRACT_ADDRESSES,
  SPIN_MULTICALL_ABI,
  QUOTE_TOKEN_DECIMALS,
} from "@/lib/contracts";
import { DEADLINE_BUFFER_SECONDS } from "@/lib/constants";
import { timeAgo } from "@/lib/format";
import { TokenLogo } from "@/components/token-logo";

type SpinModalProps = {
  isOpen: boolean;
  onClose: () => void;
  rigAddress: `0x${string}`;
  tokenSymbol?: string;
  tokenName?: string;
  tokenLogoUrl?: string | null;
};

export function SpinModal({
  isOpen,
  onClose,
  rigAddress,
  tokenSymbol = "TOKEN",
  tokenName = "Token",
  tokenLogoUrl,
}: SpinModalProps) {
  const { address: account } = useFarcaster();

  // Real data hooks
  const { spinState, odds, refetch: refetchSpin, isLoading: isSpinLoading } = useSpinRigState(rigAddress, account);
  const { spins: spinHistory, isLoading: isSpinHistoryLoading, refetch: refetchHistoryFn } = useSpinHistory(rigAddress, 10);
  const refetchHistoryRef = useRef(refetchHistoryFn);
  refetchHistoryRef.current = refetchHistoryFn;
  const { entries: leaderboardEntries, userRank, isLoading: isLeaderboardLoading } = useSpinLeaderboard(rigAddress, account, 10);
  const { execute, status: txStatus, txHash, error: txError, reset: resetTx } = useBatchedTransaction();

  // Batch fetch Farcaster profiles for spinners + leaderboard
  const profileAddresses = useMemo(() => {
    const addrs: string[] = [];
    if (account) addrs.push(account);
    for (const s of spinHistory) addrs.push(s.spinner);
    if (leaderboardEntries) {
      for (const e of leaderboardEntries) addrs.push(e.address);
    }
    return addrs;
  }, [account, spinHistory, leaderboardEntries]);
  const { getProfile, getDisplayName, getAvatarUrl } = useBatchProfiles(profileAddresses);

  // UI state
  const [miningState, setMiningState] = useState<"idle" | "mining" | "revealing" | "complete">("idle");
  const [minedAmount, setMinedAmount] = useState(0);
  const [displayedAmount, setDisplayedAmount] = useState(0);
  const [minedPayoutPercent, setMinedPayoutPercent] = useState(0);
  const [message, setMessage] = useState("");
  const { metadata } = useTokenMetadata(spinState?.rigUri);
  const defaultMessage = metadata?.defaultMessage || "gm";
  const spinCountBeforeMine = useRef(0);

  // Derived values from real data
  const price = spinState?.price ?? 0n;
  const prizePool = spinState?.prizePool ?? 0n;
  const pendingEmissions = spinState?.pendingEmissions ?? 0n;
  const ups = spinState?.ups ?? 0n;
  const userQuoteBalance = spinState?.accountQuoteBalance ?? 0n;
  const userQuoteBalanceNum = Number(formatUnits(userQuoteBalance, QUOTE_TOKEN_DECIMALS));
  const priceNum = Number(formatUnits(price, QUOTE_TOKEN_DECIMALS));
  const basePoolNumber = Number(formatEther(prizePool + pendingEmissions));
  const upsPerSecond = Number(formatEther(ups));
  const tokenPrice = spinState?.unitPrice ? Number(formatEther(spinState.unitPrice)) : 0.01;

  // Live-ticking prize pool — increments by UPS every second
  const [poolTick, setPoolTick] = useState(0);
  const poolSnapshotRef = useRef({ base: 0, time: Date.now() });

  useEffect(() => {
    poolSnapshotRef.current = { base: basePoolNumber, time: Date.now() };
    setPoolTick(0);
  }, [basePoolNumber]);

  useEffect(() => {
    if (upsPerSecond <= 0) return;
    const interval = setInterval(() => {
      const elapsed = (Date.now() - poolSnapshotRef.current.time) / 1000;
      setPoolTick(elapsed * upsPerSecond);
    }, 1000);
    return () => clearInterval(interval);
  }, [upsPerSecond]);

  const prizePoolNumber = poolSnapshotRef.current.base + poolTick;

  // Compute min/max mine from real odds + probabilities
  const oddsNumbers = odds.map((o) => Number(o));
  const minPayoutBps = oddsNumbers.length > 0 ? Math.min(...oddsNumbers) : 0;
  const maxPayoutBps = oddsNumbers.length > 0 ? Math.max(...oddsNumbers) : 0;
  const maxMine = prizePoolNumber * maxPayoutBps / 10000;
  const minMine = prizePoolNumber * minPayoutBps / 10000;
  const totalOdds = oddsNumbers.length;
  const maxChance = totalOdds > 0 ? (oddsNumbers.filter((o) => o === maxPayoutBps).length / totalOdds) * 100 : 0;
  const minChance = totalOdds > 0 ? (oddsNumbers.filter((o) => o === minPayoutBps).length / totalOdds) * 100 : 0;

  // Last mine result (from spin history)
  const lastSpin = spinHistory[0];
  const lastMine = lastSpin ? {
    name: getDisplayName(lastSpin.spinner),
    avatar: getAvatarUrl(lastSpin.spinner),
    amount: Number(formatEther(lastSpin.winAmount)),
    payoutPercent: Number(lastSpin.oddsBps) / 100,
  } : {
    name: "No mines yet",
    avatar: "https://api.dicebear.com/7.x/shapes/svg?seed=default",
    amount: 0,
    payoutPercent: 0,
  };

  // User stats from spin history
  const userSpins = account ? spinHistory.filter((s) => s.spinner.toLowerCase() === account.toLowerCase()) : [];
  const userMined = userSpins.reduce((sum, s) => sum + Number(formatEther(s.winAmount)), 0);
  const userSpentAmount = userSpins.reduce((sum, s) => sum + Number(formatUnits(s.price, QUOTE_TOKEN_DECIMALS)), 0);
  const userStats = {
    mined: Math.round(userMined),
    minedUsd: userMined * tokenPrice,
    spins: userSpins.length,
    spent: userSpentAmount,
  };

  const rigUrl = typeof window !== "undefined" ? `${window.location.origin}/rig/${rigAddress}` : "";

  // Handle the spin/mine action
  const handleMine = useCallback(async () => {
    if (!account || !spinState || miningState !== "idle") return;

    spinCountBeforeMine.current = spinHistory.length;
    setMiningState("mining");
    setDisplayedAmount(0);

    const maxPrice = spinState.price + (spinState.price * 5n / 100n);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_BUFFER_SECONDS);
    const calls: Call[] = [];

    calls.push(
      encodeApproveCall(
        CONTRACT_ADDRESSES.usdc as `0x${string}`,
        CONTRACT_ADDRESSES.spinMulticall as `0x${string}`,
        maxPrice
      )
    );

    calls.push(
      encodeContractCall(
        CONTRACT_ADDRESSES.spinMulticall as `0x${string}`,
        SPIN_MULTICALL_ABI,
        "spin",
        [rigAddress, spinState.epochId, deadline, maxPrice, message || defaultMessage],
        spinState.entropyFee
      )
    );

    await execute(calls);
  }, [account, spinState, rigAddress, execute, miningState]);

  // Tick-up animation for revealing mined amount
  useEffect(() => {
    if (miningState !== "revealing") return;

    const duration = 1000;
    const steps = 30;
    const increment = minedAmount / steps;
    let step = 0;

    const interval = setInterval(() => {
      step++;
      const current = Math.min(minedAmount, Math.floor(increment * step));
      setDisplayedAmount(current);

      if (step >= steps) {
        clearInterval(interval);
        setDisplayedAmount(minedAmount);
        setMiningState("complete");

        setTimeout(() => {
          setMiningState("idle");
          refetchSpin();
          refetchHistoryRef.current();
        }, 2000);
      }
    }, duration / steps);

    return () => clearInterval(interval);
  }, [miningState, minedAmount, minedPayoutPercent, refetchSpin]);

  // After tx succeeds, poll subgraph for VRF callback result
  useEffect(() => {
    if (txStatus === "success" && miningState === "mining") {
      const interval = setInterval(() => { refetchHistoryRef.current(); refetchSpin(); }, 1500);
      return () => clearInterval(interval);
    }
  }, [txStatus, miningState, refetchSpin]);

  // When new spin result appears in subgraph, reveal the real amount
  useEffect(() => {
    if (txStatus === "success" && miningState === "mining" && spinHistory.length > spinCountBeforeMine.current) {
      const latest = spinHistory[0];
      const realAmount = Number(formatEther(latest.winAmount));
      if (realAmount > 0) {
        const realPercent = Number(latest.oddsBps) / 100;
        setMinedAmount(Math.round(realAmount));
        setMinedPayoutPercent(realPercent);
        setDisplayedAmount(0);
        setMiningState("revealing");
      }
    }
  }, [txStatus, miningState, spinHistory]);

  // Handle tx error — auto-reset after 2s
  useEffect(() => {
    if (txStatus === "error") {
      setMiningState("idle");
      const timer = setTimeout(() => resetTx(), 2000);
      return () => clearTimeout(timer);
    }
  }, [txStatus, resetTx]);

  // Reset on modal close
  useEffect(() => {
    if (!isOpen) {
      resetTx();
      setMiningState("idle");
    }
  }, [isOpen, resetTx]);

  if (!isOpen) return null;

  // Format spin history for SpinHistoryItem
  const formattedSpins = spinHistory.map((spin, index) => ({
    id: spin.txHash || index.toString(),
    spinner: spin.spinner,
    uri: spin.uri,
    price: spin.price,
    payoutPercent: Number(spin.oddsBps) / 100,
    won: spin.winAmount,
    timestamp: Number(spin.timestamp),
  }));

  // Populate leaderboard entries with Farcaster profiles
  const formattedLeaderboard = useMemo(() => {
    if (!leaderboardEntries) return [];
    return leaderboardEntries.map((entry) => {
      const profile = getProfile(entry.address);
      return {
        ...entry,
        profile: profile
          ? { displayName: profile.displayName, username: profile.username, pfpUrl: profile.pfpUrl }
          : null,
      };
    });
  }, [leaderboardEntries, getProfile]);

  return (
    <div className="fixed inset-0 z-[100] flex h-screen w-screen justify-center bg-zinc-800">
      <div
        className="relative flex h-full w-full max-w-[520px] flex-col bg-background"
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 8px)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 160px)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-2">
          <button
            onClick={onClose}
            className="p-2 -ml-2 rounded-xl hover:bg-secondary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          <span className="text-base font-semibold">Spin</span>
          <div className="w-9" />
        </div>

        {/* Sticky Top Section */}
        <div className="px-4 pb-2">
          {/* Max Mine & Min Mine */}
          <div className="flex items-start justify-between mb-2">
            {/* Min Mine */}
            <div>
              <div className="mb-0.5">
                <span className="text-[13px] font-medium text-zinc-200">Min Mine</span>
                <span className="text-[11px] text-zinc-500 ml-1.5">{minChance % 1 === 0 ? minChance.toFixed(0) : minChance.toFixed(1)}% chance</span>
              </div>
              <div className="flex items-center gap-1.5">
                <TokenLogo name={tokenSymbol} logoUrl={tokenLogoUrl} size="sm" />
                <span className="text-lg font-bold tabular-nums">
                  {minMine.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
              </div>
              <div className="text-[12px] text-muted-foreground tabular-nums">
                ${(minMine * tokenPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>

            {/* Max Mine */}
            <div className="text-right">
              <div className="mb-0.5">
                <span className="text-[11px] text-zinc-500">{maxChance % 1 === 0 ? maxChance.toFixed(0) : maxChance.toFixed(1)}% chance</span>
                <span className="text-[13px] font-medium text-zinc-200 ml-1.5">Max Mine</span>
              </div>
              <div className="flex items-center justify-end gap-1.5">
                <TokenLogo name={tokenSymbol} logoUrl={tokenLogoUrl} size="sm" />
                <span className="text-lg font-bold tabular-nums">
                  {maxMine.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
              </div>
              <div className="text-[12px] text-muted-foreground tabular-nums">
                ${(maxMine * tokenPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
          </div>

          {/* Mining Result Area */}
          <div className="py-2">
            {miningState === "mining" && (
              <div className="grid grid-cols-[1fr_60px_120px] items-center gap-2">
                <div className="flex items-center gap-2">
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarImage src={account ? getAvatarUrl(account) : undefined} alt="You" />
                    <AvatarFallback className="bg-zinc-700 text-[10px]">{account ? account.slice(2, 4).toUpperCase() : "??"}</AvatarFallback>
                  </Avatar>
                  <div className="text-[14px] font-medium truncate">{account ? getDisplayName(account) : "You"}</div>
                </div>
                <div className="text-xl font-bold text-center text-transparent">
                  --%
                </div>
                <div className="text-right">
                  <div className="flex items-center justify-end gap-2 h-8">
                    <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
                    <span className="text-[14px] text-zinc-400">Mining...</span>
                  </div>
                  <div className="text-[12px] text-muted-foreground h-4">
                    &nbsp;
                  </div>
                </div>
              </div>
            )}

            {miningState === "revealing" && (
              <div className="grid grid-cols-[1fr_60px_120px] items-center gap-2">
                <div className="flex items-center gap-2">
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarImage src={account ? getAvatarUrl(account) : undefined} alt="You" />
                    <AvatarFallback className="bg-zinc-700 text-[10px]">{account ? account.slice(2, 4).toUpperCase() : "??"}</AvatarFallback>
                  </Avatar>
                  <div className="text-[14px] font-medium truncate">{account ? getDisplayName(account) : "You"}</div>
                </div>
                <div className="text-xl font-bold text-center text-transparent">
                  --%
                </div>
                <div className="text-right">
                  <div className="flex items-center justify-end gap-2 h-8">
                    <TokenLogo name={tokenSymbol} logoUrl={tokenLogoUrl} size="md" />
                    <span className="text-2xl font-bold tabular-nums">
                      {displayedAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                  <div className="text-[12px] text-muted-foreground tabular-nums h-4">
                    ${(displayedAmount * tokenPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
              </div>
            )}

            {miningState === "complete" && (
              <div className="grid grid-cols-[1fr_60px_120px] items-center gap-2">
                <div className="flex items-center gap-2">
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarImage src={account ? getAvatarUrl(account) : undefined} alt="You" />
                    <AvatarFallback className="bg-zinc-700 text-[10px]">{account ? account.slice(2, 4).toUpperCase() : "??"}</AvatarFallback>
                  </Avatar>
                  <div className="text-[14px] font-medium truncate">{account ? getDisplayName(account) : "You"}</div>
                </div>
                <div className="text-xl font-bold text-center">
                  {minedPayoutPercent}%
                </div>
                <div className="text-right">
                  <div className="flex items-center justify-end gap-2 h-8">
                    <TokenLogo name={tokenSymbol} logoUrl={tokenLogoUrl} size="md" />
                    <span className="text-2xl font-bold tabular-nums">
                      {displayedAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                  <div className="text-[12px] text-muted-foreground tabular-nums h-4">
                    ${(displayedAmount * tokenPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
              </div>
            )}

            {miningState === "idle" && (
              <div>
                {lastSpin && (
                  <div className="text-[12px] text-zinc-500 mb-1">Last Mine</div>
                )}
                <div className="grid grid-cols-[1fr_60px_120px] items-center gap-2">
                <div className="flex items-center gap-2">
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarImage src={lastMine.avatar} alt={lastMine.name} />
                    <AvatarFallback className="bg-zinc-700 text-[10px]">
                      {lastMine.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="text-[14px] font-medium truncate">{lastMine.name}</div>
                </div>
                <div className="text-xl font-bold text-center">
                  {lastMine.payoutPercent > 0 ? `${lastMine.payoutPercent}%` : "--"}
                </div>
                <div className="text-right">
                  <div className="flex items-center justify-end gap-2 h-8">
                    <TokenLogo name={tokenSymbol} logoUrl={tokenLogoUrl} size="md" />
                    <span className="text-2xl font-bold tabular-nums">
                      {lastMine.amount > 0 ? lastMine.amount.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "--"}
                    </span>
                  </div>
                  <div className="text-[12px] text-muted-foreground tabular-nums h-4">
                    {lastMine.amount > 0
                      ? `$${(lastMine.amount * tokenPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                      : "\u00A0"}
                  </div>
                </div>
              </div>
              </div>
            )}
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-4">

          {/* Your Position */}
          <div className="mb-6">
            <div className="font-semibold text-[18px] mb-3">Your position</div>
            <div className="grid grid-cols-2 gap-y-4 gap-x-8">
              <div>
                <div className="text-muted-foreground text-[12px] mb-1">Mined</div>
                <div className="font-semibold text-[15px] tabular-nums flex items-center gap-1.5">
                  <TokenLogo name={tokenSymbol} logoUrl={tokenLogoUrl} size="sm" />
                  {userStats.mined.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-1">Value</div>
                <div className="font-semibold text-[15px] tabular-nums">
                  ${userStats.minedUsd.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-1">Mines</div>
                <div className="font-semibold text-[15px] tabular-nums">
                  {userStats.spins}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-1">Spent</div>
                <div className="font-semibold text-[15px] tabular-nums">
                  ${userStats.spent.toFixed(2)}
                </div>
              </div>
            </div>
          </div>

          {/* Recent Mines */}
          <div className="mb-6">
            <div className="font-semibold text-[18px] mb-3">Recent Mines</div>
            {isSpinHistoryLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            ) : formattedSpins.length === 0 ? (
              <div className="text-center py-4 text-muted-foreground text-[13px]">
                No mines yet
              </div>
            ) : (
              <div>
                {formattedSpins.map((spin) => (
                  <SpinHistoryItem
                    key={spin.id}
                    spin={spin}
                    timeAgo={timeAgo}
                    tokenSymbol={tokenSymbol}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Leaderboard */}
          <Leaderboard
            entries={formattedLeaderboard}
            userRank={userRank ?? null}
            tokenSymbol={tokenSymbol}
            tokenName={tokenName}
            rigUrl={rigUrl}
            isLoading={isLeaderboardLoading}
          />
        </div>

        {/* Bottom Action Bar */}
        <div
          className="fixed bottom-0 left-0 right-0 z-50 bg-background flex justify-center"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 32px)" }}
        >
          <div className="w-full max-w-[520px] px-4 pt-2 pb-2 bg-background">
            {/* Message Input */}
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={defaultMessage}
              maxLength={100}
              className="w-full bg-zinc-800 rounded-xl px-4 py-2 text-[15px] outline-none placeholder:text-zinc-500 mb-2"
            />
            {/* Price, Balance, Mine Button */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6">
                <div>
                  <div className="text-muted-foreground text-[12px]">Pay</div>
                  <div className="font-semibold text-[17px] tabular-nums">
                    ${priceNum.toFixed(4)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[12px]">Balance</div>
                  <div className="font-semibold text-[17px] tabular-nums">
                    ${userQuoteBalanceNum.toFixed(2)}
                  </div>
                </div>
              </div>
              <button
                onClick={handleMine}
                disabled={miningState !== "idle" || !account || !spinState || userQuoteBalance < price}
                className={`
                  w-32 h-10 text-[14px] font-semibold rounded-xl transition-all flex items-center justify-center gap-2
                  ${miningState === "complete"
                    ? "bg-zinc-300 text-black"
                    : txStatus === "error"
                    ? "bg-zinc-600 text-white"
                    : miningState !== "idle"
                    ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
                    : account && spinState && userQuoteBalance >= price
                      ? "bg-white text-black hover:bg-zinc-200"
                      : "bg-zinc-700 text-zinc-500 cursor-not-allowed"
                  }
                `}
              >
                {miningState === "complete" ? (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    Success
                  </>
                ) : txStatus === "error" ? (
                  txError?.message?.includes("cancelled") ? "Rejected" : "Failed"
                ) : miningState !== "idle" ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Mining...
                  </>
                ) : (
                  "Mine"
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
