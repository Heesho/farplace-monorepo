"use client";

import { useState, useEffect, useCallback } from "react";
import { X, Loader2, AlertCircle } from "lucide-react";
import { formatUnits, formatEther, parseUnits } from "viem";
import { useFarcaster } from "@/hooks/useFarcaster";
import { useFundRigState } from "@/hooks/useFundRigState";
import { useRigLeaderboard } from "@/hooks/useRigLeaderboard";
import { useFundHistory, type DonationEvent } from "@/hooks/useFundHistory";
import {
  useBatchedTransaction,
  encodeApproveCall,
  encodeContractCall,
  type Call,
} from "@/hooks/useBatchedTransaction";
import {
  CONTRACT_ADDRESSES,
  FUND_MULTICALL_ABI,
  QUOTE_TOKEN_DECIMALS,
} from "@/lib/contracts";
import { NavBar } from "@/components/nav-bar";
import { Leaderboard } from "@/components/leaderboard";

// Preset funding amounts
const PRESET_AMOUNTS = [5, 10, 25, 50];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FundModalProps = {
  isOpen: boolean;
  onClose: () => void;
  rigAddress: `0x${string}`;
  tokenSymbol?: string;
  tokenName?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCountdown(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function truncateAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatUSDC(value: bigint): string {
  return Number(formatUnits(value, QUOTE_TOKEN_DECIMALS)).toFixed(2);
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

export function FundModal({
  isOpen,
  onClose,
  rigAddress,
  tokenSymbol = "TOKEN",
  tokenName = "Token",
}: FundModalProps) {
  // ---------- Local UI state ----------
  const [fundAmount, setFundAmount] = useState("5");
  const [selectedPreset, setSelectedPreset] = useState<number | null>(5);
  const [isCustom, setIsCustom] = useState(false);
  const [message, setMessage] = useState("");
  const defaultMessage = "for the cause";

  // Day countdown ticker
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));

  // ---------- Hooks ----------
  const { address: account } = useFarcaster();

  const {
    fundState,
    claimableDays,
    totalPending,
    refetch: refetchFund,
    isLoading: isFundLoading,
  } = useFundRigState(rigAddress, account);

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
    donations,
    isLoading: isHistoryLoading,
  } = useFundHistory(rigAddress, 10);

  // ---------- Derived display values ----------

  // Today's pool
  const todayTotalDonated = fundState
    ? Number(formatUnits(fundState.todayTotalDonated, QUOTE_TOKEN_DECIMALS))
    : 0;
  const todayEmission = fundState
    ? Number(formatEther(fundState.todayEmission))
    : 0;
  const currentPricePerToken =
    todayTotalDonated > 0 ? todayTotalDonated / todayEmission : 0;

  // User balance (USDC)
  const userBalance = fundState
    ? Number(formatUnits(fundState.accountPaymentTokenBalance, QUOTE_TOKEN_DECIMALS))
    : 0;

  // User's today donation
  const userTodayDonation = fundState
    ? Number(formatUnits(fundState.accountTodayDonation, QUOTE_TOKEN_DECIMALS))
    : 0;

  // User's unit balance
  const userUnitBalance = fundState
    ? Number(formatEther(fundState.accountUnitBalance))
    : 0;

  // Pending claims
  const pendingTokens = Number(formatEther(totalPending));
  const unclaimedDayCount = claimableDays.length;

  // Day countdown from chain data
  const startTime = fundState ? Number(fundState.startTime) : 0;
  const currentDay = fundState ? Number(fundState.currentDay) : 0;
  const dayEndTime = startTime > 0 ? startTime + (currentDay + 1) * 86400 : 0;
  const dayEndsIn = Math.max(0, dayEndTime - now);

  // Recipient (treasury)
  const recipientAddress = fundState?.treasury ?? null;

  // Parsed amount from input
  const parsedAmount = parseFloat(fundAmount) || 0;

  // Estimated tokens for current input
  const estimatedTokens =
    parsedAmount > 0 && todayEmission > 0
      ? (parsedAmount / (todayTotalDonated + parsedAmount)) * todayEmission
      : 0;


  // ---------- Effects ----------

  // Countdown timer from chain data
  useEffect(() => {
    if (!isOpen || !fundState) return;
    const interval = setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [isOpen, fundState]);

  // Reset tx on modal close
  useEffect(() => {
    if (!isOpen) {
      resetTx();
    }
  }, [isOpen, resetTx]);

  // Auto-refetch after successful tx
  useEffect(() => {
    if (txStatus === "success") {
      const timer = setTimeout(() => {
        refetchFund();
        resetTx();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [txStatus, refetchFund, resetTx]);

  // ---------- Handlers ----------

  const handlePresetSelect = (amount: number) => {
    setSelectedPreset(amount);
    setFundAmount(amount.toString());
    setIsCustom(false);
  };

  const handleCustomSelect = () => {
    setSelectedPreset(null);
    setIsCustom(true);
    setFundAmount("");
  };

  const handleCustomChange = (value: string) => {
    setFundAmount(value);
    setSelectedPreset(null);
  };

  const handleFund = useCallback(async () => {
    if (!account || !fundState || txStatus === "pending") return;
    const amount = parseUnits(fundAmount || "0", QUOTE_TOKEN_DECIMALS);
    if (amount <= 0n) return;

    const calls: Call[] = [];

    // Approve quote token for fund multicall
    calls.push(
      encodeApproveCall(
        CONTRACT_ADDRESSES.usdc as `0x${string}`,
        CONTRACT_ADDRESSES.fundMulticall as `0x${string}`,
        amount
      )
    );

    // Fund call
    calls.push(
      encodeContractCall(
        CONTRACT_ADDRESSES.fundMulticall as `0x${string}`,
        FUND_MULTICALL_ABI,
        "fund",
        [rigAddress, account, amount]
      )
    );

    await execute(calls);
  }, [account, fundState, fundAmount, rigAddress, execute, txStatus]);

  const handleClaim = useCallback(async () => {
    if (!account || claimableDays.length === 0 || txStatus === "pending") return;
    const dayIds = claimableDays.map((d) => d.day);
    const calls: Call[] = [
      encodeContractCall(
        CONTRACT_ADDRESSES.fundMulticall as `0x${string}`,
        FUND_MULTICALL_ABI,
        "claimMultiple",
        [rigAddress, account, dayIds]
      ),
    ];
    await execute(calls);
  }, [account, claimableDays, rigAddress, execute, txStatus]);

  // ---------- Render ----------

  if (!isOpen) return null;

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
          <span className="text-base font-semibold">Fund</span>
          <div className="w-9" />
        </div>

        {/* Loading State */}
        {isFundLoading && (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isFundLoading && (
          <>
            {/* Sticky Top Section - Compact */}
            <div className="px-4 pb-3 bg-background">
              {/* Recipient - single line */}
              <div className="flex items-center justify-between py-2">
                <div className="text-[15px] font-semibold">
                  {recipientAddress
                    ? `${recipientAddress.slice(0, 6)}...${recipientAddress.slice(-4)}`
                    : "--"}
                </div>
                {recipientAddress && (
                  <a
                    href={`https://basescan.org/address/${recipientAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-muted-foreground font-mono hover:text-white transition-colors underline underline-offset-2"
                  >
                    {recipientAddress.slice(0, 6)}...{recipientAddress.slice(-4)}
                  </a>
                )}
              </div>

              {/* Pool Stats - compact 2x2 grid */}
              <div className="grid grid-cols-4 gap-2 py-2 mb-2">
                <div>
                  <div className="text-muted-foreground text-[10px]">Pool</div>
                  <div className="font-semibold text-[13px] tabular-nums">
                    ${todayTotalDonated.toFixed(0)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[10px]">Emission</div>
                  <div className="font-semibold text-[13px] tabular-nums flex items-center gap-1">
                    <span className="w-4 h-4 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-[8px] text-white font-semibold">
                      {tokenSymbol.charAt(0)}
                    </span>
                    {todayEmission >= 1_000_000 ? `${(todayEmission / 1_000_000).toFixed(2)}M`
                      : todayEmission >= 1_000 ? `${(todayEmission / 1_000).toFixed(0)}K`
                      : todayEmission.toFixed(0)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[10px]">Price</div>
                  <div className="font-semibold text-[13px] tabular-nums">
                    ${currentPricePerToken.toFixed(4)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[10px]">Ends in</div>
                  <div className="font-semibold text-[13px] tabular-nums">
                    {formatCountdown(dayEndsIn)}
                  </div>
                </div>
              </div>

              {/* Fund Preset Amounts - no header */}
              <div className="mb-1">
                {!isCustom ? (
                  <div className="flex gap-1.5">
                    {PRESET_AMOUNTS.map((amount) => (
                      <button
                        key={amount}
                        onClick={() => handlePresetSelect(amount)}
                        className={`
                          flex-1 py-2 rounded-lg text-[13px] font-semibold transition-all
                          ${selectedPreset === amount
                            ? "bg-white text-black"
                            : "bg-zinc-800 text-white hover:bg-zinc-700"
                          }
                        `}
                      >
                        ${amount}
                      </button>
                    ))}
                    <button
                      onClick={handleCustomSelect}
                      className="flex-1 py-2 rounded-lg text-[13px] font-semibold transition-all bg-zinc-800 text-white hover:bg-zinc-700"
                    >
                      Other
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-1.5 items-center">
                    <button
                      onClick={() => {
                        setIsCustom(false);
                        setFundAmount("5");
                        setSelectedPreset(5);
                      }}
                      className="px-3 py-2 rounded-lg text-[13px] font-semibold bg-zinc-800 text-white hover:bg-zinc-700 transition-all"
                    >
                      ✕
                    </button>
                    <div className="flex-1 flex items-center gap-2 bg-zinc-800 rounded-lg px-3 py-1.5">
                      <span className="text-base text-muted-foreground">$</span>
                      <input
                        type="number"
                        value={fundAmount}
                        onChange={(e) => handleCustomChange(e.target.value)}
                        placeholder="0.00"
                        autoFocus
                        className="flex-1 bg-transparent text-base font-semibold outline-none placeholder:text-zinc-600 tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    </div>
                  </div>
                )}
                {/* Estimate - always show */}
                <div className="text-[12px] text-muted-foreground mt-1.5 text-center">
                  ≈ {estimatedTokens.toLocaleString(undefined, { maximumFractionDigits: 0 })} {tokenSymbol}
                  <span className="text-zinc-600 ml-1">@ current rate</span>
                </div>
              </div>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-4">

              {/* Transaction Status */}
              {txStatus === "error" && txError && (
                <div className="flex items-center gap-2 text-[13px] text-red-400 bg-red-500/10 rounded-lg px-3 py-2 mb-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{txError.message ?? "Transaction failed"}</span>
                </div>
              )}
              {txStatus === "success" && (
                <div className="flex items-center gap-2 text-[13px] text-zinc-300 bg-zinc-700/50 rounded-lg px-3 py-2 mb-2">
                  <span>Transaction confirmed!</span>
                </div>
              )}

              {/* Your Position */}
              <div className="mb-6">
                <div className="font-semibold text-[18px] mb-3">Your position</div>

                {/* Pending Claims */}
                {unclaimedDayCount > 0 && (
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <div className="text-muted-foreground text-[12px] mb-1">Pending</div>
                      <div className="font-semibold text-[15px] tabular-nums flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-[10px] text-white font-semibold">
                          {tokenSymbol.charAt(0)}
                        </span>
                        {pendingTokens >= 1000
                          ? `${(pendingTokens / 1000).toFixed(1)}K`
                          : pendingTokens.toFixed(0)}
                        <span className="text-[12px] text-muted-foreground font-normal">
                          · {unclaimedDayCount}d
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={handleClaim}
                      disabled={txStatus === "pending"}
                      className={`px-5 py-2 text-[13px] font-semibold rounded-xl transition-all ${
                        txStatus === "pending"
                          ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
                          : "bg-white text-black hover:bg-zinc-200"
                      }`}
                    >
                      {txStatus === "pending" ? "Claiming..." : "Claim"}
                    </button>
                  </div>
                )}

                {/* Today + Est. */}
                <div className="grid grid-cols-2 gap-y-4 gap-x-8 mb-4">
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-1">Today</div>
                    <div className="font-semibold text-[15px] tabular-nums">
                      ${userTodayDonation.toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-1">Est.</div>
                    <div className="font-semibold text-[15px] tabular-nums flex items-center gap-1.5">
                      <span className="w-5 h-5 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-[10px] text-white font-semibold">
                        {tokenSymbol.charAt(0)}
                      </span>
                      ~{todayTotalDonated > 0
                        ? ((userTodayDonation / todayTotalDonated) * todayEmission / 1000).toFixed(1)
                        : "0"}K
                    </div>
                  </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-y-4 gap-x-8">
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-1">Earned</div>
                    <div className="font-semibold text-[15px] tabular-nums flex items-center gap-1.5">
                      <span className="w-5 h-5 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-[10px] text-white font-semibold">
                        {tokenSymbol.charAt(0)}
                      </span>
                      {userUnitBalance >= 1000
                        ? `${(userUnitBalance / 1000).toFixed(1)}K`
                        : userUnitBalance.toFixed(0)}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-1">Funded</div>
                    <div className="font-semibold text-[15px] tabular-nums">
                      --
                    </div>
                  </div>
                </div>
              </div>

              {/* Recent Donations */}
              <div className="mt-6">
                <h2 className="text-[18px] font-semibold mb-3">Recent Donations</h2>
                {isHistoryLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : donations.length === 0 ? (
                  <div className="text-center py-4 text-muted-foreground text-[13px]">
                    No donation history yet
                  </div>
                ) : (
                  <div>
                    {/* Header */}
                    <div className="grid grid-cols-[1fr_4.5rem_4rem] gap-2 px-2 pb-2 text-[11px] text-muted-foreground">
                      <span>Donor</span>
                      <span className="text-right">Amount</span>
                      <span className="text-right">Time</span>
                    </div>

                    {/* Entries */}
                    <div className="space-y-1">
                      {donations.map((donation, index) => {
                        const isUser = account && donation.donor.toLowerCase() === account.toLowerCase();
                        return (
                          <div key={`${donation.donor}-${donation.timestamp}-${index}`}
                            className={`grid grid-cols-[1fr_4.5rem_4rem] gap-2 px-2 py-2 rounded-lg text-[12px] ${isUser ? "bg-white/5" : ""}`}>
                            <span className="font-mono truncate">
                              {truncateAddress(donation.donor)}
                              {isUser && <span className="ml-1 text-[10px] text-muted-foreground">(you)</span>}
                            </span>
                            <span className="text-right tabular-nums">${formatUSDC(donation.amount)}</span>
                            <span className="text-right text-muted-foreground">{timeAgo(Number(donation.timestamp))}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Leaderboard */}
              <Leaderboard
                entries={leaderboardEntries ?? []}
                userRank={userRank ?? null}
                tokenSymbol={tokenSymbol}
                tokenName={tokenName}
                rigUrl={typeof window !== "undefined" ? `${window.location.origin}/rig/${rigAddress}` : ""}
                isLoading={isLeaderboardLoading}
              />
            </div>
          </>
        )}

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
            {/* Amount, Balance, Mine Button */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6">
                <div>
                  <div className="text-muted-foreground text-[12px]">Amount</div>
                  <div className="font-semibold text-[17px] tabular-nums">
                    ${parsedAmount.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[12px]">Balance</div>
                  <div className="font-semibold text-[17px] tabular-nums">
                    ${userBalance.toFixed(2)}
                  </div>
                </div>
              </div>
              <button
                onClick={handleFund}
                disabled={txStatus === "pending" || parsedAmount <= 0 || parsedAmount > userBalance}
                className={`
                  w-32 h-10 text-[14px] font-semibold rounded-xl transition-all
                  ${txStatus === "pending"
                    ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
                    : parsedAmount > 0 && parsedAmount <= userBalance
                      ? "bg-white text-black hover:bg-zinc-200"
                      : "bg-zinc-700 text-zinc-500 cursor-not-allowed"
                  }
                `}
              >
                {txStatus === "pending" ? "Funding..." : "Fund"}
              </button>
            </div>
          </div>
        </div>
      </div>
      <NavBar />
    </div>
  );
}
