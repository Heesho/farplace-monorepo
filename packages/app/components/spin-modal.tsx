"use client";

import { useCallback, useEffect, useState } from "react";
import { X, AlertCircle, Loader2 } from "lucide-react";
import { formatUnits, formatEther } from "viem";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { NavBar } from "@/components/nav-bar";
import { Leaderboard } from "@/components/leaderboard";
import { useFarcaster } from "@/hooks/useFarcaster";
import { useSpinRigState } from "@/hooks/useSpinRigState";
import { useSpinHistory, type SpinEvent } from "@/hooks/useSpinHistory";
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SpinModalProps = {
  isOpen: boolean;
  onClose: () => void;
  rigAddress: `0x${string}`;
  tokenSymbol?: string;
  tokenName?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatUSDC(value: bigint): string {
  return Number(formatUnits(value, QUOTE_TOKEN_DECIMALS)).toFixed(2);
}

function formatTokenAmount(value: bigint): string {
  const num = Number(formatEther(value));
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  if (num >= 1) return num.toFixed(2);
  if (num >= 0.01) return num.toFixed(4);
  return num.toFixed(6);
}

function timeAgo(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SpinModal({
  isOpen,
  onClose,
  rigAddress,
  tokenSymbol = "TOKEN",
  tokenName = "Token",
}: SpinModalProps) {
  // ---------- Local UI state ----------
  const [miningState, setMiningState] = useState<"idle" | "mining" | "complete">("idle");
  const [message, setMessage] = useState("");
  const [showSubmitted, setShowSubmitted] = useState(false);
  const defaultMessage = "gm"; // Default message set by rig owner

  // ---------- Hooks ----------
  const { address: account } = useFarcaster();
  const {
    spinState,
    odds,
    refetch: refetchSpin,
    isLoading: isSpinLoading,
  } = useSpinRigState(rigAddress, account);
  const {
    execute,
    status: txStatus,
    txHash,
    error: txError,
    reset: resetTx,
  } = useBatchedTransaction();
  const {
    entries: leaderboardEntries,
    userRank,
    isLoading: isLeaderboardLoading,
  } = useRigLeaderboard(rigAddress, account, 10);
  const {
    spins: spinHistory,
    isLoading: isSpinHistoryLoading,
  } = useSpinHistory(rigAddress, 10);

  // ---------- Derived display values ----------
  const price = spinState?.price ?? 0n;
  const prizePool = spinState?.prizePool ?? 0n;
  const userQuoteBalance = spinState?.accountQuoteBalance ?? 0n;
  const userUnitBalance = spinState ? Number(formatEther(spinState.accountUnitBalance)) : 0;
  const userQuoteBalanceNum = spinState
    ? Number(formatUnits(spinState.accountQuoteBalance, QUOTE_TOKEN_DECIMALS))
    : 0;

  // Token price from spinState (unitPrice is 18 decimals representing DONUT/unit ratio)
  const tokenPrice = spinState?.unitPrice
    ? Number(formatEther(spinState.unitPrice))
    : 0;

  // Compute min/max mine from real odds
  const oddsNumbers = odds.map((o) => Number(o)); // bps values
  const minOddsBps = oddsNumbers.length > 0 ? Math.min(...oddsNumbers) : 0;
  const maxOddsBps = oddsNumbers.length > 0 ? Math.max(...oddsNumbers) : 0;
  const prizePoolNumber = Number(formatEther(prizePool));
  const maxMine = prizePoolNumber * maxOddsBps / 10000;
  const minMine = prizePoolNumber * minOddsBps / 10000;

  const rigUrl =
    typeof window !== "undefined" ? `${window.location.origin}/rig/${rigAddress}` : "";


  // ---------- Transaction handler ----------
  const handleMine = useCallback(async () => {
    if (!account || !spinState || txStatus === "pending") return;

    setMiningState("mining");

    const maxPrice = spinState.price + (spinState.price * 5n / 100n); // 5% slippage
    const deadline = BigInt(
      Math.floor(Date.now() / 1000) + DEADLINE_BUFFER_SECONDS
    );
    const calls: Call[] = [];

    // Approve quote token
    calls.push(
      encodeApproveCall(
        CONTRACT_ADDRESSES.usdc as `0x${string}`,
        CONTRACT_ADDRESSES.spinMulticall as `0x${string}`,
        maxPrice
      )
    );

    // Spin call (payable -- entropyFee as value)
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
  }, [account, spinState, rigAddress, execute, txStatus]);

  // ---------- Effects ----------

  // Reset on modal close
  useEffect(() => {
    if (!isOpen) {
      resetTx();
      setMiningState("idle");
      setShowSubmitted(false);
    }
  }, [isOpen, resetTx]);

  // Handle tx status changes
  useEffect(() => {
    if (txStatus === "success") {
      setMiningState("complete");
      setShowSubmitted(true);
      const timer = setTimeout(() => {
        refetchSpin();
        setMiningState("idle");
      }, 3000);
      return () => clearTimeout(timer);
    }
    if (txStatus === "error") {
      setMiningState("idle");
    }
  }, [txStatus, refetchSpin]);

  // Clear "submitted" message after a delay when returning to idle
  useEffect(() => {
    if (showSubmitted && miningState === "idle") {
      const timer = setTimeout(() => setShowSubmitted(false), 4000);
      return () => clearTimeout(timer);
    }
  }, [showSubmitted, miningState]);

  // ---------- Render nothing when closed ----------
  if (!isOpen) return null;

  const isPending = txStatus === "pending";
  const isButtonDisabled =
    isPending ||
    miningState !== "idle" ||
    !account ||
    !spinState ||
    userQuoteBalance < price;

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
          <span className="text-base font-semibold">Spin</span>
          <div className="w-9" />
        </div>

        {/* Sticky Top Section */}
        <div className="px-4 pb-4">
          {/* Max Mine & Min Mine */}
          <div className="flex items-start justify-between mb-4">
            {/* Max Mine */}
            <div>
              <div className="text-[11px] text-muted-foreground mb-0.5">MAX WIN</div>
              <div className="flex items-center gap-1.5">
                <div className="w-5 h-5 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white text-[10px] font-semibold">
                  {tokenSymbol.charAt(0)}
                </div>
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
              <div className="text-[11px] text-muted-foreground mb-0.5">MIN WIN</div>
              <div className="flex items-center justify-end gap-1.5">
                <span className="text-lg font-bold tabular-nums">
                  {minMine.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
                <div className="w-5 h-5 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white text-[10px] font-semibold">
                  {tokenSymbol.charAt(0)}
                </div>
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
                    <AvatarImage
                      src={
                        account
                          ? `https://api.dicebear.com/7.x/shapes/svg?seed=${account.toLowerCase()}`
                          : undefined
                      }
                      alt="You"
                    />
                    <AvatarFallback className="bg-zinc-700 text-[10px]">
                      {account ? account.slice(2, 4).toUpperCase() : "??"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="text-[14px] font-medium truncate">
                    {account ? `${account.slice(0, 6)}...${account.slice(-4)}` : "You"}
                  </div>
                </div>
                <div className="text-xl font-bold text-center text-transparent">
                  --%
                </div>
                <div className="text-right">
                  <div className="flex items-center justify-end gap-2 h-8">
                    <div className="w-6 h-6 border-2 border-zinc-700 border-t-white rounded-full animate-spin" />
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                      {tokenSymbol.charAt(0)}
                    </div>
                  </div>
                  <div className="text-[12px] text-muted-foreground h-4">
                    &nbsp;
                  </div>
                </div>
              </div>
            )}

            {miningState === "complete" && (
              <div className="grid grid-cols-[1fr_60px_120px] items-center gap-2">
                <div className="flex items-center gap-2">
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarImage
                      src={
                        account
                          ? `https://api.dicebear.com/7.x/shapes/svg?seed=${account.toLowerCase()}`
                          : undefined
                      }
                      alt="You"
                    />
                    <AvatarFallback className="bg-zinc-700 text-[10px]">
                      {account ? account.slice(2, 4).toUpperCase() : "??"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="text-[14px] font-medium truncate">
                    {account ? `${account.slice(0, 6)}...${account.slice(-4)}` : "You"}
                  </div>
                </div>
                <div className="text-xl font-bold text-center text-green-400">
                  OK
                </div>
                <div className="text-right">
                  <div className="flex items-center justify-end gap-2 h-8">
                    <span className="text-lg font-bold text-green-400">Spin submitted!</span>
                  </div>
                  <div className="text-[12px] text-muted-foreground tabular-nums h-4">
                    {txHash && (
                      <a
                        href={`https://basescan.org/tx/${txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-green-400/70 hover:underline"
                      >
                        View tx
                      </a>
                    )}
                  </div>
                </div>
              </div>
            )}

            {miningState === "idle" && (
              <div className="grid grid-cols-[1fr_60px_120px] items-center gap-2">
                <div className="flex items-center gap-2">
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarImage
                      src={
                        account
                          ? `https://api.dicebear.com/7.x/shapes/svg?seed=${account.toLowerCase()}`
                          : undefined
                      }
                      alt="Ready"
                    />
                    <AvatarFallback className="bg-zinc-700 text-[10px]">
                      {account ? account.slice(2, 4).toUpperCase() : "??"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="text-[14px] font-medium truncate">
                    {showSubmitted
                      ? "Spin submitted!"
                      : account
                        ? `${account.slice(0, 6)}...${account.slice(-4)}`
                        : "Connect wallet"}
                  </div>
                </div>
                <div className="text-xl font-bold text-center">
                  {oddsNumbers.length > 0
                    ? `${oddsNumbers.length}`
                    : "--"}
                </div>
                <div className="text-right">
                  <div className="flex items-center justify-end gap-2 h-8">
                    <span className="text-2xl font-bold tabular-nums">
                      {prizePoolNumber.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                      {tokenSymbol.charAt(0)}
                    </div>
                  </div>
                  <div className="text-[12px] text-muted-foreground tabular-nums h-4">
                    Prize Pool
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Loading State */}
        {isSpinLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Transaction Error */}
        {txStatus === "error" && txError && (
          <div className="flex items-center gap-2 text-[13px] text-red-400 bg-red-500/10 rounded-lg px-3 py-2 mx-4 mb-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{txError.message ?? "Transaction failed"}</span>
          </div>
        )}

        {/* Scrollable Content */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-4">

          {/* Your Position */}
          <div className="mb-6">
            <div className="font-semibold text-[18px] mb-3">Your position</div>
            <div className="grid grid-cols-2 gap-y-4 gap-x-8">
              <div>
                <div className="text-muted-foreground text-[12px] mb-1">Won</div>
                <div className="font-semibold text-[15px] tabular-nums flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-[10px] text-white font-semibold">
                    {tokenSymbol.charAt(0)}
                  </span>
                  {userUnitBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-1">Balance</div>
                <div className="font-semibold text-[15px] tabular-nums">
                  ${userQuoteBalanceNum.toFixed(2)}
                </div>
              </div>
            </div>
          </div>

          {/* Recent Spins */}
          <div className="mb-6">
            <div className="font-semibold text-[18px] mb-3">Recent Spins</div>

            {isSpinHistoryLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            ) : spinHistory.length === 0 ? (
              <div className="text-center py-4 text-muted-foreground text-[13px]">
                No spin history yet
              </div>
            ) : (
              <>
                {/* Header */}
                <div className="grid grid-cols-[1fr_4rem_4.5rem_4rem] gap-2 px-2 pb-2 text-[11px] text-muted-foreground">
                  <span>Spinner</span>
                  <span className="text-right">Cost</span>
                  <span className="text-right">Won</span>
                  <span className="text-right">Time</span>
                </div>

                {/* Entries */}
                <div className="space-y-1">
                  {spinHistory.map((spin, index) => {
                    const isUser = account && spin.spinner.toLowerCase() === account.toLowerCase();
                    return (
                      <div
                        key={`${spin.spinner}-${spin.timestamp}-${index}`}
                        className={`grid grid-cols-[1fr_4rem_4.5rem_4rem] gap-2 px-2 py-2 rounded-lg text-[12px] ${isUser ? "bg-white/5" : ""}`}
                      >
                        <span className="font-mono truncate">
                          {truncateAddress(spin.spinner)}
                          {isUser && <span className="ml-1 text-[10px] text-muted-foreground">(you)</span>}
                        </span>
                        <span className="text-right tabular-nums">${formatUSDC(spin.price)}</span>
                        <span className={`text-right tabular-nums ${spin.won ? "text-green-400" : "text-muted-foreground"}`}>
                          {spin.won ? formatTokenAmount(spin.winAmount) : "Miss"}
                        </span>
                        <span className="text-right text-muted-foreground">{timeAgo(Number(spin.timestamp))}</span>
                      </div>
                    );
                  })}
                </div>
              </>
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
                    ${Number(formatUnits(price, QUOTE_TOKEN_DECIMALS)).toFixed(4)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[12px]">Balance</div>
                  <div className="font-semibold text-[17px] tabular-nums">
                    ${Number(formatUnits(userQuoteBalance, QUOTE_TOKEN_DECIMALS)).toFixed(2)}
                  </div>
                </div>
              </div>
              <button
                onClick={handleMine}
                disabled={isButtonDisabled}
                className={`
                  w-32 h-10 text-[14px] font-semibold rounded-xl transition-all flex items-center justify-center gap-2
                  ${miningState !== "idle" || isPending
                    ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
                    : !account || !spinState || userQuoteBalance < price
                      ? "bg-zinc-700 text-zinc-500 cursor-not-allowed"
                      : "bg-white text-black hover:bg-zinc-200"
                  }
                `}
              >
                {isPending || miningState === "mining" ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Spinning...
                  </>
                ) : (
                  "Spin"
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
