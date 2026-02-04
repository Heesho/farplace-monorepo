"use client";

import { useState, useEffect, useCallback } from "react";
import { X, Loader2, CheckCircle } from "lucide-react";
import { formatUnits, formatEther } from "viem";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { NavBar } from "@/components/nav-bar";
import { Leaderboard } from "@/components/leaderboard";
import { SpinHistoryItem } from "@/components/spin-history-item";
import { useFarcaster } from "@/hooks/useFarcaster";
import { useSpinRigState } from "@/hooks/useSpinRigState";
import { useSpinHistory } from "@/hooks/useSpinHistory";
import { useRigLeaderboard } from "@/hooks/useRigLeaderboard";
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

type SpinModalProps = {
  isOpen: boolean;
  onClose: () => void;
  rigAddress: `0x${string}`;
  tokenSymbol?: string;
  tokenName?: string;
  tokenLogoUrl?: string | null;
};

function truncateAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// Token logo component
function TokenLogo({
  symbol,
  logoUrl,
  size = "md",
}: {
  symbol: string;
  logoUrl?: string | null;
  size?: "xs" | "sm" | "md";
}) {
  const sizeClasses = {
    xs: "w-4 h-4 text-[8px]",
    sm: "w-5 h-5 text-[10px]",
    md: "w-7 h-7 text-xs",
  };

  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={symbol}
        className={`${sizeClasses[size].split(" ").slice(0, 2).join(" ")} rounded-full object-cover`}
      />
    );
  }

  return (
    <div
      className={`${sizeClasses[size]} rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white font-semibold`}
    >
      {symbol.charAt(0)}
    </div>
  );
}

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
  const { spins: spinHistory, isLoading: isSpinHistoryLoading } = useSpinHistory(rigAddress, 10);
  const { entries: leaderboardEntries, userRank, isLoading: isLeaderboardLoading } = useRigLeaderboard(rigAddress, account, 10);
  const { execute, status: txStatus, txHash, error: txError, reset: resetTx } = useBatchedTransaction();

  // UI state
  const [miningState, setMiningState] = useState<"idle" | "mining" | "revealing" | "complete">("idle");
  const [minedAmount, setMinedAmount] = useState(0);
  const [displayedAmount, setDisplayedAmount] = useState(0);
  const [minedPayoutPercent, setMinedPayoutPercent] = useState(0);
  const [message, setMessage] = useState("");
  const defaultMessage = "gm";

  // Derived values from real data
  const price = spinState?.price ?? 0n;
  const prizePool = spinState?.prizePool ?? 0n;
  const userQuoteBalance = spinState?.accountQuoteBalance ?? 0n;
  const userQuoteBalanceNum = Number(formatUnits(userQuoteBalance, QUOTE_TOKEN_DECIMALS));
  const priceNum = Number(formatUnits(price, QUOTE_TOKEN_DECIMALS));
  const prizePoolNumber = Number(formatEther(prizePool));
  const tokenPrice = spinState?.unitPrice ? Number(formatEther(spinState.unitPrice)) : 0.01;

  // Compute min/max mine from real odds
  const oddsNumbers = odds.map((o) => Number(o));
  const minPayoutBps = oddsNumbers.length > 0 ? Math.min(...oddsNumbers) : 0;
  const maxPayoutBps = oddsNumbers.length > 0 ? Math.max(...oddsNumbers) : 0;
  const maxMine = prizePoolNumber * maxPayoutBps / 10000;
  const minMine = prizePoolNumber * minPayoutBps / 10000;

  // Last mine result (from spin history)
  const lastSpin = spinHistory[0];
  const lastMine = lastSpin ? {
    name: truncateAddress(lastSpin.spinner),
    avatar: `https://api.dicebear.com/7.x/shapes/svg?seed=${lastSpin.spinner.toLowerCase()}`,
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

  function timeAgo(timestamp: number): string {
    const seconds = Math.floor(Date.now() / 1000 - timestamp);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  // Handle the spin/mine action
  const handleMine = useCallback(async () => {
    if (!account || !spinState || miningState !== "idle") return;

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
        [rigAddress, spinState.epochId, deadline, maxPrice],
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
        }, 2000);
      }
    }, duration / steps);

    return () => clearInterval(interval);
  }, [miningState, minedAmount, minedPayoutPercent, refetchSpin]);

  // Handle tx status changes
  useEffect(() => {
    if (txStatus === "success") {
      const randomOdds = oddsNumbers.length > 0
        ? oddsNumbers[Math.floor(Math.random() * oddsNumbers.length)]
        : 500;
      const result = Math.floor(prizePoolNumber * randomOdds / 10000);
      setMinedAmount(result);
      setMinedPayoutPercent(randomOdds / 100);
      setDisplayedAmount(0);
      setMiningState("revealing");
    }
    if (txStatus === "error") {
      setMiningState("idle");
    }
  }, [txStatus, oddsNumbers, prizePoolNumber]);

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
    uri: "",
    price: spin.price,
    payoutPercent: Number(spin.oddsBps) / 100,
    won: spin.winAmount,
    timestamp: Number(spin.timestamp),
  }));

  return (
    <div className="fixed inset-0 z-[100] flex h-screen w-screen justify-center bg-zinc-800">
      <div
        className="relative flex h-full w-full max-w-[520px] flex-col bg-background"
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 8px)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 130px)",
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
          <span className="text-base font-semibold">Mine</span>
          <div className="w-9" />
        </div>

        {/* Sticky Top Section */}
        <div className="px-4 pb-4">
          {/* Max Mine & Min Mine */}
          <div className="flex items-start justify-between mb-4">
            {/* Max Mine */}
            <div>
              <div className="text-[11px] text-muted-foreground mb-0.5">MAX MINE</div>
              <div className="flex items-center gap-1.5">
                <TokenLogo symbol={tokenSymbol} logoUrl={tokenLogoUrl} size="sm" />
                <span className="text-lg font-bold tabular-nums">
                  {maxMine.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
              </div>
              <div className="text-[12px] text-muted-foreground tabular-nums">
                ${(maxMine * tokenPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>

            {/* Min Mine */}
            <div className="text-right">
              <div className="text-[11px] text-muted-foreground mb-0.5">MIN MINE</div>
              <div className="flex items-center justify-end gap-1.5">
                <TokenLogo symbol={tokenSymbol} logoUrl={tokenLogoUrl} size="sm" />
                <span className="text-lg font-bold tabular-nums">
                  {minMine.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
              </div>
              <div className="text-[12px] text-muted-foreground tabular-nums">
                ${(minMine * tokenPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
          </div>

          {/* Mining Result Area */}
          <div className="py-4">
            {miningState === "mining" && (
              <div className="grid grid-cols-[1fr_60px_120px] items-center gap-2">
                <div className="flex items-center gap-2">
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarImage src={account ? `https://api.dicebear.com/7.x/shapes/svg?seed=${account.toLowerCase()}` : undefined} alt="You" />
                    <AvatarFallback className="bg-zinc-700 text-[10px]">{account ? account.slice(2, 4).toUpperCase() : "??"}</AvatarFallback>
                  </Avatar>
                  <div className="text-[14px] font-medium truncate">{account ? truncateAddress(account) : "You"}</div>
                </div>
                <div className="text-xl font-bold text-center text-transparent">
                  --%
                </div>
                <div className="text-right">
                  <div className="flex items-center justify-end gap-2 h-8">
                    <TokenLogo symbol={tokenSymbol} logoUrl={tokenLogoUrl} size="md" />
                    <div className="w-6 h-6 border-2 border-zinc-700 border-t-white rounded-full animate-spin" />
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
                    <AvatarImage src={account ? `https://api.dicebear.com/7.x/shapes/svg?seed=${account.toLowerCase()}` : undefined} alt="You" />
                    <AvatarFallback className="bg-zinc-700 text-[10px]">{account ? account.slice(2, 4).toUpperCase() : "??"}</AvatarFallback>
                  </Avatar>
                  <div className="text-[14px] font-medium truncate">{account ? truncateAddress(account) : "You"}</div>
                </div>
                <div className="text-xl font-bold text-center text-transparent">
                  --%
                </div>
                <div className="text-right">
                  <div className="flex items-center justify-end gap-2 h-8">
                    <TokenLogo symbol={tokenSymbol} logoUrl={tokenLogoUrl} size="md" />
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
                    <AvatarImage src={account ? `https://api.dicebear.com/7.x/shapes/svg?seed=${account.toLowerCase()}` : undefined} alt="You" />
                    <AvatarFallback className="bg-zinc-700 text-[10px]">{account ? account.slice(2, 4).toUpperCase() : "??"}</AvatarFallback>
                  </Avatar>
                  <div className="text-[14px] font-medium truncate">{account ? truncateAddress(account) : "You"}</div>
                </div>
                <div className="text-xl font-bold text-center">
                  {minedPayoutPercent}%
                </div>
                <div className="text-right">
                  <div className="flex items-center justify-end gap-2 h-8">
                    <TokenLogo symbol={tokenSymbol} logoUrl={tokenLogoUrl} size="md" />
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
                    <TokenLogo symbol={tokenSymbol} logoUrl={tokenLogoUrl} size="md" />
                    <span className="text-2xl font-bold tabular-nums">
                      {lastMine.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                  <div className="text-[12px] text-muted-foreground tabular-nums h-4">
                    ${(lastMine.amount * tokenPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
                  <TokenLogo symbol={tokenSymbol} logoUrl={tokenLogoUrl} size="sm" />
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
            entries={leaderboardEntries ?? []}
            userRank={userRank ?? null}
            tokenSymbol={tokenSymbol}
            tokenName={tokenName}
            rigUrl={rigUrl}
            isLoading={isLeaderboardLoading}
          />
        </div>

        {/* Bottom Action Bar */}
        <div
          className="fixed bottom-0 left-0 right-0 z-50 bg-zinc-800 flex justify-center"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 60px)" }}
        >
          <div className="w-full max-w-[520px] px-4 pt-3 pb-3 bg-background">
            {/* Message Input */}
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={defaultMessage}
              maxLength={100}
              className="w-full bg-zinc-800 rounded-xl px-4 py-3 text-[15px] outline-none placeholder:text-zinc-500 mb-3"
            />
            {/* Price, Balance, Mine Button */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6">
                <div>
                  <div className="text-muted-foreground text-[12px]">Price</div>
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
                    ? "bg-green-600 text-white"
                    : txStatus === "error"
                    ? "bg-red-600 text-white"
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
                  "Failed"
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
      <NavBar />
    </div>
  );
}
