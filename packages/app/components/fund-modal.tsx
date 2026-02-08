"use client";

import { useState, useEffect, useCallback } from "react";
import { X, Loader2, CheckCircle } from "lucide-react";
import { formatUnits, formatEther, parseUnits } from "viem";
import { useFarcaster } from "@/hooks/useFarcaster";
import { useFundRigState } from "@/hooks/useFundRigState";
import { useTokenMetadata } from "@/hooks/useMetadata";
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
import { Leaderboard } from "@/components/leaderboard";
import { DonationHistoryItem } from "@/components/donation-history-item";
import { truncateAddress, timeAgo, formatUSDC } from "@/lib/format";
import { TokenLogo } from "@/components/token-logo";

// Preset funding amounts
const PRESET_AMOUNTS = [1, 10, 100];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FundModalProps = {
  isOpen: boolean;
  onClose: () => void;
  rigAddress: `0x${string}`;
  tokenSymbol?: string;
  tokenName?: string;
  tokenLogoUrl?: string | null;
  recipientName?: string;
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FundModal({
  isOpen,
  onClose,
  rigAddress,
  tokenSymbol = "TOKEN",
  tokenName = "Token",
  tokenLogoUrl,
  recipientName,
}: FundModalProps) {
  // ---------- Local UI state ----------
  const [fundAmount, setFundAmount] = useState("1");
  const [selectedPreset, setSelectedPreset] = useState<number | null>(1);
  const [isCustom, setIsCustom] = useState(false);
  const [message, setMessage] = useState("");

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

  const { metadata } = useTokenMetadata(fundState?.rigUri);
  const defaultMessage = metadata?.defaultMessage || "gm";

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
    ? Number(formatUnits(fundState.accountQuoteBalance, QUOTE_TOKEN_DECIMALS))
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

  // Auto-refetch after successful tx, auto-reset after error
  useEffect(() => {
    if (txStatus === "success") {
      const timer = setTimeout(() => {
        refetchFund();
        resetTx();
      }, 3000);
      return () => clearTimeout(timer);
    }
    if (txStatus === "error") {
      const timer = setTimeout(() => resetTx(), 2000);
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
        [rigAddress, account, amount, message || defaultMessage]
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
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 80px)",
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
              {/* Recipient */}
              <div className="py-2">
                <div className="text-[15px] font-semibold">
                  {recipientName || (recipientAddress
                    ? `${recipientAddress.slice(0, 6)}...${recipientAddress.slice(-4)}`
                    : "--")}
                </div>
                {recipientName && recipientAddress && (
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
                  <div className="text-muted-foreground text-[11px]">Pool</div>
                  <div className="font-semibold text-[13px] tabular-nums">
                    ${todayTotalDonated.toFixed(0)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[11px]">Emission</div>
                  <div className="font-semibold text-[13px] tabular-nums flex items-center gap-1">
                    <TokenLogo name={tokenSymbol} logoUrl={tokenLogoUrl} size="xs" />
                    {todayEmission >= 1_000_000 ? `${(todayEmission / 1_000_000).toFixed(2)}M`
                      : todayEmission >= 1_000 ? `${(todayEmission / 1_000).toFixed(0)}K`
                      : todayEmission.toFixed(0)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[11px]">Pay</div>
                  <div className="font-semibold text-[13px] tabular-nums">
                    ${currentPricePerToken.toFixed(4)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[11px]">Ends in</div>
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
                        setFundAmount("1");
                        setSelectedPreset(1);
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
                <div className="text-[13px] text-white mt-2">
                  ≈ {estimatedTokens.toLocaleString(undefined, { maximumFractionDigits: 0 })} {tokenSymbol} <span className="text-muted-foreground">@ current rate</span>
                </div>
              </div>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-4">

              {/* Your Position */}
              <div className="mb-6">
                <div className="font-semibold text-[18px] mb-3">Your position</div>

                {/* Pending Claims */}
                {unclaimedDayCount > 0 && (
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <div className="text-muted-foreground text-[12px] mb-1">Pending</div>
                      <div className="font-semibold text-[15px] tabular-nums flex items-center gap-1.5">
                        <TokenLogo name={tokenSymbol} logoUrl={tokenLogoUrl} size="sm" />
                        {pendingTokens >= 1000
                          ? `${(pendingTokens / 1000).toFixed(1)}K`
                          : pendingTokens.toFixed(0)}
                        <span className="text-[12px] text-muted-foreground font-normal">
                          ${(pendingTokens * currentPricePerToken).toFixed(2)} · {unclaimedDayCount}d
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={handleClaim}
                      disabled={txStatus === "pending" || txStatus === "success"}
                      className={`px-5 py-2 text-[13px] font-semibold rounded-xl transition-all flex items-center gap-1.5 ${
                        txStatus === "success"
                          ? "bg-zinc-300 text-black"
                          : txStatus === "error"
                          ? "bg-zinc-600 text-white"
                          : txStatus === "pending"
                          ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
                          : "bg-white text-black hover:bg-zinc-200"
                      }`}
                    >
                      {txStatus === "pending" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      {txStatus === "success" && <CheckCircle className="w-3.5 h-3.5" />}
                      {txStatus === "pending"
                        ? "Claiming..."
                        : txStatus === "success"
                        ? "Claimed!"
                        : txStatus === "error"
                        ? txError?.message?.includes("cancelled") ? "Rejected" : "Failed"
                        : "Claim"}
                    </button>
                  </div>
                )}

                {/* Estimated + Today */}
                <div className="grid grid-cols-2 gap-y-4 gap-x-8 mb-4">
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-1">Estimated</div>
                    <div className="font-semibold text-[15px] tabular-nums flex items-center gap-1.5">
                      <span className="w-5 h-5 rounded-full bg-gradient-to-br from-zinc-500 to-zinc-700 flex items-center justify-center text-[10px] text-white font-semibold">
                        {tokenSymbol.charAt(0)}
                      </span>
                      {todayTotalDonated > 0
                        ? ((userTodayDonation / todayTotalDonated) * todayEmission / 1000).toFixed(1)
                        : "0"}K
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-1">Today</div>
                    <div className="font-semibold text-[15px] tabular-nums">
                      ${userTodayDonation.toFixed(2)}
                    </div>
                  </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-y-4 gap-x-8">
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-1">Mined</div>
                    <div className="font-semibold text-[15px] tabular-nums flex items-center gap-1.5">
                      <span className="w-5 h-5 rounded-full bg-gradient-to-br from-zinc-500 to-zinc-700 flex items-center justify-center text-[10px] text-white font-semibold">
                        {tokenSymbol.charAt(0)}
                      </span>
                      {(userUnitBalance + pendingTokens) >= 1000
                        ? `${((userUnitBalance + pendingTokens) / 1000).toFixed(1)}K`
                        : (userUnitBalance + pendingTokens).toFixed(0)}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-1">Value</div>
                    <div className="font-semibold text-[15px] tabular-nums">
                      ${((userUnitBalance + pendingTokens) * currentPricePerToken).toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[12px] mb-1">Claimed</div>
                    <div className="font-semibold text-[15px] tabular-nums flex items-center gap-1.5">
                      <span className="w-5 h-5 rounded-full bg-gradient-to-br from-zinc-500 to-zinc-700 flex items-center justify-center text-[10px] text-white font-semibold">
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

              {/* Recent Mines */}
              <div className="mt-6">
                <h2 className="text-[18px] font-semibold mb-3">Recent Mines</h2>
                {isHistoryLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : donations.length === 0 ? (
                  <div className="text-center py-4 text-muted-foreground text-[13px]">
                    No mines yet
                  </div>
                ) : (
                  <div>
                    {donations.map((donation, index) => (
                      <DonationHistoryItem
                        key={`${donation.donor}-${donation.timestamp}-${index}`}
                        donation={{
                          id: `${donation.donor}-${donation.timestamp}-${index}`,
                          donor: donation.donor,
                          uri: donation.uri,
                          amount: donation.amount,
                          estimatedTokens: todayEmission > 0
                            ? BigInt(Math.floor((Number(formatUnits(donation.amount, QUOTE_TOKEN_DECIMALS)) / (todayTotalDonated || 1)) * todayEmission * 1e18))
                            : 0n,
                          timestamp: Number(donation.timestamp),
                        }}
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
                rigUrl={typeof window !== "undefined" ? `${window.location.origin}/rig/${rigAddress}` : ""}
                isLoading={isLeaderboardLoading}
              />
            </div>
          </>
        )}

        {/* Bottom Action Bar */}
        <div
          className="fixed bottom-0 left-0 right-0 z-50 bg-background flex justify-center"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}
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
            {/* Amount, Balance, Mine Button */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6">
                <div>
                  <div className="text-muted-foreground text-[12px]">Pay</div>
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
                disabled={txStatus === "pending" || txStatus === "success" || parsedAmount <= 0 || parsedAmount > userBalance}
                className={`
                  w-32 h-10 text-[14px] font-semibold rounded-xl transition-all flex items-center justify-center gap-2
                  ${txStatus === "success"
                    ? "bg-zinc-300 text-black"
                    : txStatus === "error"
                    ? "bg-zinc-600 text-white"
                    : txStatus === "pending"
                    ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
                    : parsedAmount > 0 && parsedAmount <= userBalance
                      ? "bg-white text-black hover:bg-zinc-200"
                      : "bg-zinc-700 text-zinc-500 cursor-not-allowed"
                  }
                `}
              >
                {txStatus === "pending" && <Loader2 className="w-4 h-4 animate-spin" />}
                {txStatus === "success" && <CheckCircle className="w-4 h-4" />}
                {txStatus === "pending"
                  ? "Funding..."
                  : txStatus === "success"
                  ? "Success"
                  : txStatus === "error"
                  ? txError?.message?.includes("cancelled") ? "Rejected" : "Failed"
                  : "Mine"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
