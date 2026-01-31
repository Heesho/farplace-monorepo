"use client";

import { useState, useEffect, useCallback } from "react";
import { X, Loader2, CheckCircle, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import { formatUnits, formatEther, zeroAddress } from "viem";
import { useFarcaster } from "@/hooks/useFarcaster";
import { useRigState } from "@/hooks/useRigState";
import { useMultiSlotState } from "@/hooks/useMultiSlotState";
import { useRigLeaderboard } from "@/hooks/useRigLeaderboard";
import { useMineHistory } from "@/hooks/useMineHistory";
import {
  useBatchedTransaction,
  encodeApproveCall,
  encodeContractCall,
  type Call,
} from "@/hooks/useBatchedTransaction";
import {
  CONTRACT_ADDRESSES,
  MULTICALL_ABI,
  RIG_ABI,
  QUOTE_TOKEN_DECIMALS,
  DEADLINE_BUFFER_SECONDS,
} from "@/lib/contracts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MineModalProps = {
  isOpen: boolean;
  onClose: () => void;
  rigAddress: `0x${string}`;
  tokenSymbol: string;
  tokenName: string;
  multicallAddress?: `0x${string}`;
};

type Tab = "slots" | "leaderboard" | "history";

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

export function MineModal({
  isOpen,
  onClose,
  rigAddress,
  tokenSymbol,
  tokenName,
  multicallAddress: multicallAddressProp,
}: MineModalProps) {
  const multicallAddr =
    (multicallAddressProp ?? CONTRACT_ADDRESSES.mineMulticall) as `0x${string}`;

  // ---------- State ----------
  const [selectedSlotIndex, setSelectedSlotIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<Tab>("slots");
  const [showSlotDetails, setShowSlotDetails] = useState(false);

  // ---------- Hooks ----------
  const { address: account } = useFarcaster();

  // Fetch slot 0 to get capacity (always needed for useMultiSlotState)
  const {
    rigState: slot0State,
    isLoading: isSlot0Loading,
  } = useRigState(rigAddress, account, 0n, multicallAddr);

  const capacity = slot0State?.capacity ?? 0n;

  // Fetch the selected slot state
  const {
    rigState,
    isLoading: isRigStateLoading,
    refetch: refetchRigState,
  } = useRigState(rigAddress, account, BigInt(selectedSlotIndex), multicallAddr);

  // Fetch all slots for the overview
  const {
    slots,
    activeCount,
    isLoading: isSlotsLoading,
  } = useMultiSlotState(rigAddress, capacity, account, multicallAddr);

  // Leaderboard
  const {
    entries: leaderboardEntries,
    userRank,
    isLoading: isLeaderboardLoading,
  } = useRigLeaderboard(rigAddress, account, 10);

  // Mine history
  const {
    mines: mineHistory,
    isLoading: isHistoryLoading,
  } = useMineHistory(rigAddress, 10);

  // Batched transaction for mine / claim
  const {
    execute,
    status: txStatus,
    txHash,
    error: txError,
    reset: resetTx,
  } = useBatchedTransaction();

  // ---------- Derived ----------
  const isSlotEmpty = rigState ? rigState.miner === zeroAddress : true;
  const isUserMiner =
    rigState && account
      ? rigState.miner.toLowerCase() === account.toLowerCase()
      : false;
  const claimable = rigState?.accountClaimable ?? 0n;
  const hasClaimable = claimable > 0n;
  const userQuoteBalance = rigState?.accountQuoteBalance ?? 0n;

  // ---------- Reset tx status on slot change or modal close ----------
  useEffect(() => {
    if (!isOpen) {
      resetTx();
      setSelectedSlotIndex(0);
      setActiveTab("slots");
      setShowSlotDetails(false);
    }
  }, [isOpen, resetTx]);

  useEffect(() => {
    resetTx();
  }, [selectedSlotIndex, resetTx]);

  // Auto-refetch after successful tx
  useEffect(() => {
    if (txStatus === "success") {
      const timer = setTimeout(() => {
        refetchRigState();
        resetTx();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [txStatus, refetchRigState, resetTx]);

  // ---------- Handlers ----------
  const handleMine = useCallback(async () => {
    if (!account || !rigState) return;

    const slotState = rigState;
    const maxPrice = slotState.price + (slotState.price * 5n / 100n); // 5% slippage
    const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_BUFFER_SECONDS);
    const slotUri = ""; // Empty string for default

    const calls: Call[] = [];

    // Approve quote token for multicall contract
    const quoteTokenAddress = CONTRACT_ADDRESSES.usdc as `0x${string}`;
    calls.push(
      encodeApproveCall(quoteTokenAddress, multicallAddr, maxPrice)
    );

    // Mine call - include entropy fee as msg.value if needed
    const mineValue = slotState.needsEntropy ? slotState.entropyFee : 0n;
    calls.push(
      encodeContractCall(
        multicallAddr,
        MULTICALL_ABI,
        "mine",
        [
          rigAddress,
          BigInt(selectedSlotIndex),
          slotState.epochId,
          deadline,
          maxPrice,
          slotUri,
        ],
        mineValue
      )
    );

    await execute(calls);
  }, [account, rigState, multicallAddr, rigAddress, selectedSlotIndex, execute]);

  const handleClaim = useCallback(async () => {
    if (!account) return;
    const calls: Call[] = [
      encodeContractCall(rigAddress, RIG_ABI, "claim", [account], 0n),
    ];
    await execute(calls);
  }, [account, rigAddress, execute]);

  // ---------- Render nothing when closed ----------
  if (!isOpen) return null;

  const isPending = txStatus === "pending";
  const isSuccess = txStatus === "success";
  const isError = txStatus === "error";

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-[520px] max-h-[85vh] bg-background rounded-t-2xl flex flex-col animate-in slide-in-from-bottom duration-300">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-secondary">
          <div>
            <h2 className="text-[17px] font-semibold">Mine {tokenSymbol}</h2>
            <p className="text-[12px] text-muted-foreground">{tokenName}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 -mr-2 rounded-xl hover:bg-secondary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* User Balance Bar */}
        <div className="flex items-center justify-between px-4 py-2 bg-secondary/30">
          <span className="text-[12px] text-muted-foreground">Your USDC balance</span>
          <span className="text-[13px] font-semibold tabular-nums">
            {account ? `$${formatUSDC(userQuoteBalance)}` : "Connect wallet"}
          </span>
        </div>

        {/* Claimable Miner Fees */}
        {hasClaimable && (
          <div className="flex items-center justify-between px-4 py-2 bg-zinc-700/40 border-b border-secondary">
            <div>
              <span className="text-[12px] text-muted-foreground">Claimable miner fees</span>
              <span className="text-[13px] font-semibold tabular-nums ml-2">
                ${formatUSDC(claimable)} USDC
              </span>
            </div>
            <button
              onClick={handleClaim}
              disabled={isPending || !account}
              className="px-3 py-1.5 rounded-lg bg-white text-black text-[12px] font-semibold hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                "Claim"
              )}
            </button>
          </div>
        )}

        {/* Tab Bar */}
        <div className="flex border-b border-secondary">
          {(["slots", "leaderboard", "history"] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2.5 text-[13px] font-medium capitalize transition-colors ${
                activeTab === tab
                  ? "text-white border-b-2 border-white"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
          {/* ============ SLOTS TAB ============ */}
          {activeTab === "slots" && (
            <div className="p-4">
              {/* Slots overview */}
              <div className="mb-4">
                <div className="text-[12px] text-muted-foreground mb-2">
                  {activeCount} / {Number(capacity)} slots active
                </div>

                {isSlotsLoading || isSlot0Loading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {slots.map((slot, index) => {
                      const isEmpty = slot.miner === zeroAddress;
                      const isSelected = index === selectedSlotIndex;
                      const isUser =
                        account &&
                        slot.miner.toLowerCase() === account.toLowerCase();

                      return (
                        <button
                          key={index}
                          onClick={() => setSelectedSlotIndex(index)}
                          className={`relative p-3 rounded-xl border text-left transition-all ${
                            isSelected
                              ? "border-white bg-zinc-700/60"
                              : "border-secondary bg-secondary/30 hover:bg-secondary/50"
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] text-muted-foreground">
                              Slot {index + 1}
                            </span>
                            {isUser && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white">
                                You
                              </span>
                            )}
                          </div>
                          {isEmpty ? (
                            <div className="text-[13px] font-medium text-zinc-400">
                              Empty
                            </div>
                          ) : (
                            <div className="text-[13px] font-medium font-mono">
                              {truncateAddress(slot.miner)}
                            </div>
                          )}
                          <div className="text-[12px] tabular-nums mt-0.5">
                            ${formatUSDC(slot.price)}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Selected Slot Details */}
              {rigState && !isRigStateLoading && (
                <div className="border border-secondary rounded-xl overflow-hidden mb-4">
                  <button
                    onClick={() => setShowSlotDetails(!showSlotDetails)}
                    className="flex items-center justify-between w-full px-4 py-3 hover:bg-secondary/30 transition-colors"
                  >
                    <span className="text-[13px] font-medium">
                      Slot {selectedSlotIndex + 1} Details
                    </span>
                    {showSlotDetails ? (
                      <ChevronUp className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    )}
                  </button>

                  {showSlotDetails && (
                    <div className="px-4 pb-3 space-y-2 border-t border-secondary pt-3">
                      <div className="flex justify-between text-[12px]">
                        <span className="text-muted-foreground">Miner</span>
                        <span className="font-mono">
                          {rigState.miner === zeroAddress
                            ? "None"
                            : truncateAddress(rigState.miner)}
                        </span>
                      </div>
                      <div className="flex justify-between text-[12px]">
                        <span className="text-muted-foreground">Price</span>
                        <span className="tabular-nums">
                          ${formatUSDC(rigState.price)} USDC
                        </span>
                      </div>
                      <div className="flex justify-between text-[12px]">
                        <span className="text-muted-foreground">Epoch</span>
                        <span className="tabular-nums">{rigState.epochId.toString()}</span>
                      </div>
                      <div className="flex justify-between text-[12px]">
                        <span className="text-muted-foreground">UPS</span>
                        <span className="tabular-nums">{rigState.ups.toString()}</span>
                      </div>
                      <div className="flex justify-between text-[12px]">
                        <span className="text-muted-foreground">Next UPS</span>
                        <span className="tabular-nums">{rigState.nextUps.toString()}</span>
                      </div>
                      <div className="flex justify-between text-[12px]">
                        <span className="text-muted-foreground">UPS Multiplier</span>
                        <span className="tabular-nums">
                          {rigState.upsMultiplier.toString()}x
                        </span>
                      </div>
                      <div className="flex justify-between text-[12px]">
                        <span className="text-muted-foreground">Token Price</span>
                        <span className="tabular-nums">
                          {formatTokenAmount(rigState.unitPrice)} DONUT
                        </span>
                      </div>
                      {rigState.needsEntropy && (
                        <div className="flex justify-between text-[12px]">
                          <span className="text-muted-foreground">VRF Fee</span>
                          <span className="tabular-nums">
                            {formatEther(rigState.entropyFee)} ETH
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {isRigStateLoading && (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              )}

              {/* Transaction Status */}
              {isSuccess && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-green-500/10 border border-green-500/20 mb-4">
                  <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
                  <div className="text-[12px]">
                    <span className="text-green-400 font-medium">Transaction successful!</span>
                    {txHash && (
                      <a
                        href={`https://basescan.org/tx/${txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-1 text-green-400/70 hover:underline"
                      >
                        View
                      </a>
                    )}
                  </div>
                </div>
              )}

              {isError && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 mb-4">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                  <div className="text-[12px] text-red-400">
                    {txError?.message ?? "Transaction failed. Please try again."}
                  </div>
                </div>
              )}

              {/* Mine Button */}
              <button
                onClick={handleMine}
                disabled={isPending || !account || !rigState}
                className="w-full py-3.5 rounded-xl bg-white text-black font-semibold text-[15px] hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Confirming...
                  </>
                ) : isSlotEmpty ? (
                  `Mine Slot ${selectedSlotIndex + 1} - $${rigState ? formatUSDC(rigState.price) : "..."}`
                ) : isUserMiner ? (
                  `Re-mine Slot ${selectedSlotIndex + 1} - $${rigState ? formatUSDC(rigState.price) : "..."}`
                ) : (
                  `Overtake Slot ${selectedSlotIndex + 1} - $${rigState ? formatUSDC(rigState.price) : "..."}`
                )}
              </button>

              {!account && (
                <p className="text-[11px] text-muted-foreground text-center mt-2">
                  Connect your wallet to mine
                </p>
              )}

              {rigState && rigState.needsEntropy && (
                <p className="text-[11px] text-muted-foreground text-center mt-2">
                  Includes {formatEther(rigState.entropyFee)} ETH VRF fee
                </p>
              )}
            </div>
          )}

          {/* ============ LEADERBOARD TAB ============ */}
          {activeTab === "leaderboard" && (
            <div className="p-4">
              {isLeaderboardLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : !leaderboardEntries || leaderboardEntries.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-[13px]">
                  No mining activity yet
                </div>
              ) : (
                <div>
                  {/* User rank callout */}
                  {userRank !== undefined && userRank > 0 && (
                    <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-secondary/50 mb-3">
                      <span className="text-[12px] text-muted-foreground">Your rank</span>
                      <span className="text-[13px] font-semibold">#{userRank}</span>
                    </div>
                  )}

                  {/* Header */}
                  <div className="grid grid-cols-[2rem_1fr_4.5rem_4.5rem] gap-2 px-2 pb-2 text-[11px] text-muted-foreground">
                    <span>#</span>
                    <span>Miner</span>
                    <span className="text-right">Mined</span>
                    <span className="text-right">Earned</span>
                  </div>

                  {/* Entries */}
                  <div className="space-y-1">
                    {leaderboardEntries.map((entry, index) => {
                      const isUser =
                        account &&
                        entry.miner.toLowerCase() === account.toLowerCase();

                      return (
                        <div
                          key={entry.miner}
                          className={`grid grid-cols-[2rem_1fr_4.5rem_4.5rem] gap-2 px-2 py-2 rounded-lg text-[12px] ${
                            isUser ? "bg-white/5" : ""
                          }`}
                        >
                          <span className="text-muted-foreground tabular-nums">
                            {index + 1}
                          </span>
                          <span className="font-mono truncate">
                            {truncateAddress(entry.miner)}
                            {isUser && (
                              <span className="ml-1 text-[10px] text-muted-foreground">
                                (you)
                              </span>
                            )}
                          </span>
                          <span className="text-right tabular-nums">
                            {formatTokenAmount(entry.mined)}
                          </span>
                          <span className="text-right tabular-nums">
                            ${formatUSDC(entry.earned)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ============ HISTORY TAB ============ */}
          {activeTab === "history" && (
            <div className="p-4">
              {isHistoryLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : !mineHistory || mineHistory.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-[13px]">
                  No mine history yet
                </div>
              ) : (
                <div>
                  {/* Header */}
                  <div className="grid grid-cols-[1fr_4rem_4.5rem_4rem] gap-2 px-2 pb-2 text-[11px] text-muted-foreground">
                    <span>Miner</span>
                    <span className="text-right">Price</span>
                    <span className="text-right">Minted</span>
                    <span className="text-right">Time</span>
                  </div>

                  {/* Entries */}
                  <div className="space-y-1">
                    {mineHistory.map((mine, index) => {
                      const isUser =
                        account &&
                        mine.miner.toLowerCase() === account.toLowerCase();

                      return (
                        <div
                          key={`${mine.miner}-${mine.timestamp}-${index}`}
                          className={`grid grid-cols-[1fr_4rem_4.5rem_4rem] gap-2 px-2 py-2 rounded-lg text-[12px] ${
                            isUser ? "bg-white/5" : ""
                          }`}
                        >
                          <span className="font-mono truncate">
                            {truncateAddress(mine.miner)}
                            {isUser && (
                              <span className="ml-1 text-[10px] text-muted-foreground">
                                (you)
                              </span>
                            )}
                          </span>
                          <span className="text-right tabular-nums">
                            ${formatUSDC(mine.price)}
                          </span>
                          <span className="text-right tabular-nums">
                            {formatTokenAmount(mine.minted)}
                          </span>
                          <span className="text-right text-muted-foreground">
                            {timeAgo(Number(mine.timestamp))}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Safe area padding at bottom */}
        <div style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }} />
      </div>
    </div>
  );
}
