"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { X, Loader2, CheckCircle, User } from "lucide-react";
import { formatUnits, formatEther, zeroAddress } from "viem";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useFarcaster } from "@/hooks/useFarcaster";
import { useRigState } from "@/hooks/useRigState";
import { useMultiSlotState } from "@/hooks/useMultiSlotState";
import { useRigLeaderboard } from "@/hooks/useRigLeaderboard";
import { useMineHistory } from "@/hooks/useMineHistory";
import { useTokenMetadata } from "@/hooks/useMetadata";
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
} from "@/lib/contracts";
import { DEADLINE_BUFFER_SECONDS } from "@/lib/constants";
import { truncateAddress, timeAgo, formatUSDC, formatUSDC4, formatCompactToken } from "@/lib/format";
import { TokenLogo } from "@/components/token-logo";
import { Leaderboard } from "@/components/leaderboard";
import { MineHistoryItem } from "@/components/mine-history-item";
import { type LeaderboardEntry } from "@/hooks/useRigLeaderboard";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MineModalProps = {
  isOpen: boolean;
  onClose: () => void;
  rigAddress: `0x${string}`;
  tokenSymbol: string;
  tokenName: string;
  tokenLogoUrl?: string | null;
  multicallAddress?: `0x${string}`;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Multiplier Countdown
// ---------------------------------------------------------------------------

function MultiplierCountdown({ endsAt }: { endsAt: number }) {
  const [timeLeft, setTimeLeft] = useState("");

  useEffect(() => {
    const update = () => {
      const diff = Math.max(0, endsAt - Date.now());
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${mins}m ${secs}s`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [endsAt]);

  return <span className="text-zinc-300 font-medium tabular-nums">{timeLeft}</span>;
}

// ---------------------------------------------------------------------------
// Slot Card
// ---------------------------------------------------------------------------

type SlotCardProps = {
  slotIndex: number;
  miner: string;
  price: bigint;
  multiplier: number;
  isSelected: boolean;
  onSelect: () => void;
  isUserSlot: boolean;
  isSingleSlot: boolean;
  isFlashing?: boolean;
};

function SlotCard({
  slotIndex,
  miner,
  price,
  multiplier,
  isSelected,
  onSelect,
  isUserSlot,
  isSingleSlot,
  isFlashing,
}: SlotCardProps) {
  const isEmpty = miner === zeroAddress;
  const avatarSeed = miner === zeroAddress ? "empty" : miner;

  return (
    <button
      onClick={onSelect}
      className={`
        ${isSingleSlot ? "aspect-[2.5/1]" : "aspect-square"} rounded-xl p-3 flex flex-col justify-between
        transition-all duration-200 relative overflow-hidden
        ${isSelected
          ? "ring-2 ring-white"
          : "ring-1 ring-zinc-700 hover:ring-zinc-600"
        }
        ${isFlashing ? "bg-zinc-600/80" : ""}
      `}
    >
      {/* Slot number and multiplier */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-500">#{slotIndex + 1}</span>
        <span className="text-xs text-zinc-500">{multiplier}x</span>
      </div>

      {/* Avatar */}
      <div className="flex justify-center py-1">
        <Avatar className={isSingleSlot ? "h-20 w-20" : "h-10 w-10"}>
          {!isEmpty && (
            <AvatarImage
              src={`https://api.dicebear.com/7.x/shapes/svg?seed=${avatarSeed}`}
              alt={miner}
            />
          )}
          <AvatarFallback className={`bg-zinc-700 text-zinc-300 ${isSingleSlot ? "text-xl" : "text-xs"}`}>
            {isEmpty ? "?" : miner.slice(2, 4).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      </div>

      {/* Price and owned indicator */}
      <div className="flex items-end justify-between">
        {isUserSlot ? (
          <div className="w-6 h-6 rounded-md bg-zinc-700 flex items-center justify-center">
            <User className="w-3.5 h-3.5 text-zinc-300" />
          </div>
        ) : (
          <div className="w-6" />
        )}
        <div className={`font-semibold tabular-nums ${isSingleSlot ? "text-lg" : "text-sm"}`}>
          ${formatUSDC4(price)}
        </div>
      </div>

      {/* Flash overlay when mined */}
      {isFlashing && (
        <div className="absolute inset-0 bg-white/20 animate-pulse" />
      )}
    </button>
  );
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
  tokenLogoUrl,
  multicallAddress: multicallAddressProp,
}: MineModalProps) {
  const multicallAddr =
    (multicallAddressProp ?? CONTRACT_ADDRESSES.multicall) as `0x${string}`;

  // ---------- State ----------
  const [selectedSlotIndex, setSelectedSlotIndex] = useState(0);
  const [message, setMessage] = useState("");

  // ---------- Hooks ----------
  const queryClient = useQueryClient();
  const { address: account } = useFarcaster();

  // Fetch slot 0 to get capacity
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
    slotStates: slots,
    isLoading: isSlotsLoading,
  } = useMultiSlotState(rigAddress, Number(capacity), account);

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

  // Rig metadata (for default message from IPFS)
  const { metadata } = useTokenMetadata(rigState?.rigUri);
  const defaultMessage = metadata?.defaultMessage || "gm";

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
  const selectedSlot = slots[selectedSlotIndex];

  // ---------- Real-time emission ticker ----------
  const [tickElapsed, setTickElapsed] = useState(0);
  const tickBaseTime = useRef(Date.now());

  // Reset tick base whenever slot data refreshes
  useEffect(() => {
    tickBaseTime.current = Date.now();
    setTickElapsed(0);
  }, [selectedSlot?.glazed, rigState?.accountUnitBalance]);

  // Tick every second
  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => {
      setTickElapsed(Math.floor((Date.now() - tickBaseTime.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [isOpen]);

  // Compute real-time values
  const slotUps = selectedSlot?.ups || 0n;
  const slotMultiplier = selectedSlot?.upsMultiplier || BigInt(1e18);
  const emissionPerSec = (slotUps * slotMultiplier) / BigInt(1e18);
  const tickedGlazed = (selectedSlot?.glazed || 0n) + emissionPerSec * BigInt(tickElapsed);
  const isUserOnSelectedSlot = account && selectedSlot && selectedSlot.miner.toLowerCase() === account.toLowerCase();
  const tickedBalance = (rigState?.accountUnitBalance || 0n) + (isUserOnSelectedSlot ? emissionPerSec * BigInt(tickElapsed) : 0n);

  // Client-side price decay: price decays linearly from initPrice to 0 over epochPeriod
  // Compute decay rate from known data: decayPerSec = initPrice / epochPeriod
  // We derive epochPeriod from: elapsed = now - epochStartTime, price = initPrice - decayPerSec * elapsed
  // So decayPerSec = (initPrice - price) / elapsed
  const computeTickedPrice = (slot: typeof selectedSlot) => {
    if (!slot || slot.initPrice === 0n) return slot?.price || 0n;
    const elapsed = BigInt(Math.floor(Date.now() / 1000)) - slot.epochStartTime;
    if (elapsed <= 0n) return slot.initPrice;
    const decayPerSec = (slot.initPrice - slot.price) / elapsed;
    if (decayPerSec <= 0n) return slot.price;
    const tickDecay = decayPerSec * BigInt(tickElapsed);
    const result = slot.price - tickDecay;
    return result > 0n ? result : 0n;
  };
  const tickedPrice = computeTickedPrice(selectedSlot);

  // Compute PnL for the selected slot's current miner
  // Find what the current miner paid (spent) from mine history
  const currentMinerSpent = (() => {
    if (!mineHistory || !selectedSlot) return 0n;
    const entry = mineHistory.find(
      m => m.slotIndex === selectedSlotIndex &&
           m.miner.toLowerCase() === selectedSlot.miner.toLowerCase()
    );
    return entry?.price ?? 0n;
  })();
  // Earned = ticked price * 80% (what they'd get if displaced now)
  const currentMinerEarned = (tickedPrice * 80n) / 100n;
  // Mined USD value in USDC 6-decimal format: tokens_18 * unitPrice / 10^30
  const minedUsdValue = rigState ? (tickedGlazed * rigState.unitPrice) / (10n ** 30n) : 0n;
  // PnL = earned - spent (all in USDC 6 decimals)
  const slotPnl = currentMinerEarned - currentMinerSpent;
  // Total = mined USD + PnL
  const slotTotal = minedUsdValue + slotPnl;

  // Rig URL for sharing
  const rigUrl = typeof window !== "undefined" ? `${window.location.origin}/rig/${rigAddress}` : "";

  // Map leaderboard entries to expected format
  const formattedLeaderboard: LeaderboardEntry[] = (leaderboardEntries || []).map((entry, index) => ({
    rank: index + 1,
    miner: entry.miner,
    address: entry.miner,
    mined: entry.mined,
    minedFormatted: formatCompactToken(entry.mined),
    spent: entry.spent,
    spentFormatted: `$${formatUSDC(entry.spent)}`,
    earned: entry.earned,
    earnedFormatted: `$${formatUSDC(entry.earned)}`,
    isCurrentUser: account ? entry.miner.toLowerCase() === account.toLowerCase() : false,
    isFriend: false,
    profile: null,
  }));

  // ---------- Reset tx status on modal close ----------
  useEffect(() => {
    if (!isOpen) {
      resetTx();
      setSelectedSlotIndex(0);
      setMessage("");
    }
  }, [isOpen, resetTx]);

  // ---------- Auto-select cheapest slot on load ----------
  useEffect(() => {
    if (isOpen && slots.length > 0) {
      let cheapestIdx = 0;
      let cheapestPrice = slots[0].price;
      for (let i = 1; i < slots.length; i++) {
        if (slots[i].price < cheapestPrice) {
          cheapestPrice = slots[i].price;
          cheapestIdx = i;
        }
      }
      setSelectedSlotIndex(cheapestIdx);
    }
  // Only run once when slots first load after modal opens
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, slots.length > 0]);

  useEffect(() => {
    resetTx();
  }, [selectedSlotIndex, resetTx]);

  // Auto-refetch after successful tx — invalidate all related queries
  useEffect(() => {
    if (txStatus === "success") {
      const timer = setTimeout(() => {
        refetchRigState();
        queryClient.invalidateQueries({ queryKey: ["mineHistory", rigAddress] });
        queryClient.invalidateQueries({ queryKey: ["rigLeaderboard", rigAddress] });
        resetTx();
      }, 3000);
      return () => clearTimeout(timer);
    }
    if (txStatus === "error") {
      const timer = setTimeout(() => resetTx(), 2000);
      return () => clearTimeout(timer);
    }
  }, [txStatus, refetchRigState, resetTx, queryClient, rigAddress]);

  // ---------- Handlers ----------
  const handleMine = useCallback(async () => {
    if (!account || !rigState) return;

    const slotState = rigState;
    const maxPrice = slotState.price + (slotState.price * 5n / 100n); // 5% slippage
    const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_BUFFER_SECONDS);
    const slotUri = message || defaultMessage;

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
  }, [account, rigState, multicallAddr, rigAddress, selectedSlotIndex, message, execute]);

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
  const isLoading = isSlot0Loading || isSlotsLoading;

  // Calculate grid columns based on slot count
  const getGridCols = (count: number) => {
    if (count === 1) return "grid-cols-1";
    if (count === 2) return "grid-cols-2";
    return "grid-cols-3";
  };

  return (
    <div className="fixed inset-0 z-[100] flex h-screen w-screen justify-center bg-zinc-800">
      <div
        className="relative flex h-full w-full max-w-[520px] flex-col bg-background"
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 8px)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 80px)",
        }}
      >
        {/* Header - X on left, Mine centered */}
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

        {/* Sticky selected slot info */}
        {selectedSlot && !isLoading && (
          <div className="px-4 pb-4 bg-background">
            {/* Header: Avatar, Name, Address, Multiplier */}
            <div className="flex items-start gap-3 mb-3">
              <Avatar className="h-14 w-14 flex-shrink-0">
                {selectedSlot.miner !== zeroAddress && (
                  <AvatarImage src={`https://api.dicebear.com/7.x/shapes/svg?seed=${selectedSlot.miner}`} />
                )}
                <AvatarFallback className="bg-zinc-700 text-sm">
                  {selectedSlot.miner === zeroAddress ? "?" : selectedSlot.miner.slice(2, 4).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold truncate">
                    {selectedSlot.miner === zeroAddress ? "Empty Slot" : `Slot #${selectedSlotIndex + 1}`}
                  </span>
                  <span className="text-xs font-semibold text-zinc-300 bg-zinc-700 px-1.5 py-0.5 rounded flex-shrink-0">
                    {Number((selectedSlot.upsMultiplier || BigInt(1e18)) / BigInt(1e18))}x
                  </span>
                </div>
                <div className="text-xs text-zinc-500 mt-0.5">
                  {selectedSlot.miner === zeroAddress ? "Available to mine" : truncateAddress(selectedSlot.miner)}
                </div>
                <div className="text-xs text-zinc-400 mt-1 truncate italic">
                  &quot;{selectedSlot.slotUri || "No message"}&quot;
                </div>
              </div>
            </div>

            {/* Stats Grid - Rate, Mined, PnL, Total */}
            <div className="grid grid-cols-4 gap-3">
              <div>
                <div className="text-[12px] text-muted-foreground">Rate</div>
                <div className="text-[13px] font-medium tabular-nums mt-0.5 flex items-center gap-1">
                  <TokenLogo name={tokenSymbol} logoUrl={tokenLogoUrl} size="xs" />
                  {Number(formatEther(selectedSlot.ups || 0n)).toFixed(0)}/s
                </div>
              </div>
              <div>
                <div className="text-[12px] text-muted-foreground">Mined</div>
                <div className="text-[13px] font-medium tabular-nums mt-0.5 flex items-center gap-1">
                  +
                  <TokenLogo name={tokenSymbol} logoUrl={tokenLogoUrl} size="xs" />
                  {Number(formatEther(tickedGlazed)).toFixed(0)}
                </div>
              </div>
              <div>
                <div className="text-[12px] text-muted-foreground">Return</div>
                <div className="text-[13px] font-medium tabular-nums mt-0.5">
                  {(() => {
                    const pnl = Number(formatUnits(slotPnl, QUOTE_TOKEN_DECIMALS));
                    return `${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toFixed(2)}`;
                  })()}
                </div>
              </div>
              <div>
                <div className="text-[12px] text-muted-foreground">Total</div>
                <div className="text-[13px] font-medium tabular-nums mt-0.5">
                  {(() => {
                    const total = Number(formatUnits(slotTotal, QUOTE_TOKEN_DECIMALS));
                    return `${total >= 0 ? "+" : "-"}$${Math.abs(total).toFixed(2)}`;
                  })()}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Scrollable Content */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-4 pt-4">
          {/* Loading state */}
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Slots Grid */}
          {!isLoading && slots.length > 0 && (
            <div className={`grid ${getGridCols(slots.length)} gap-2 mx-auto`}>
              {slots.map((slot, index) => {
                const isUser = account && slot.miner.toLowerCase() === account.toLowerCase();
                const slotTickedPrice = computeTickedPrice(slot);
                return (
                  <SlotCard
                    key={index}
                    slotIndex={index}
                    miner={slot.miner}
                    price={slotTickedPrice}
                    multiplier={Number((slot.upsMultiplier || BigInt(1e18)) / BigInt(1e18))}
                    isSelected={selectedSlotIndex === index}
                    onSelect={() => setSelectedSlotIndex(index)}
                    isUserSlot={isUser || false}
                    isSingleSlot={slots.length === 1}
                  />
                );
              })}
            </div>
          )}

          {/* Claimable Miner Fees */}
          {hasClaimable && (
            <div className="mt-4 flex items-center justify-between px-3 py-2 bg-zinc-700/40 rounded-xl">
              <div>
                <span className="text-[12px] text-muted-foreground">Claimable miner fees</span>
                <span className="text-[13px] font-semibold tabular-nums ml-2">
                  ${formatUSDC(claimable)}
                </span>
              </div>
              <button
                onClick={handleClaim}
                disabled={isPending || !account}
                className="px-4 py-2 rounded-xl bg-white text-black text-[12px] font-semibold hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  "Claim"
                )}
              </button>
            </div>
          )}

          {/* Your Position */}
          {account && rigState && (
            <div className="mt-6">
              <div className="font-semibold text-[18px] mb-3">Your position</div>
              <div className="grid grid-cols-2 gap-y-4 gap-x-8">
                <div>
                  <div className="text-muted-foreground text-[12px] mb-1">Mined</div>
                  <div className="font-semibold text-[15px] tabular-nums flex items-center gap-1.5">
                    <TokenLogo name={tokenSymbol} logoUrl={tokenLogoUrl} size="sm" />
                    <span>{Number(formatEther(rigState.accountUnitBalance)).toFixed(0)}</span>
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[12px] mb-1">Value</div>
                  <div className="font-semibold text-[15px] tabular-nums text-white">
                    ${Number(formatEther((rigState.accountUnitBalance * rigState.unitPrice) / BigInt(1e18))).toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[12px] mb-1">Spent</div>
                  <div className="font-semibold text-[15px] tabular-nums text-white">
                    {formattedLeaderboard.find(e => e.isCurrentUser)?.spentFormatted || "$0.00"}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[12px] mb-1">Earned</div>
                  <div className="font-semibold text-[15px] tabular-nums text-white">
                    {formattedLeaderboard.find(e => e.isCurrentUser)?.earnedFormatted || "$0.00"}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Recent Mines */}
          <div className="mt-6">
            <div className="font-semibold text-[18px] mb-3">Recent Mines</div>
            {isHistoryLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            ) : !mineHistory || mineHistory.length === 0 ? (
              <div className="text-center py-4 text-muted-foreground text-[13px]">
                No mines yet
              </div>
            ) : (
              <div>
                {(() => {
                  // Track which slots already have their live (current) entry rendered
                  const liveSlotsClaimed = new Set<number>();
                  return mineHistory.map((mine, index) => {
                  // Only the most recent mine per slot gets live values
                  const slot = slots[mine.slotIndex];
                  const isCurrentMiner = slot
                    && slot.miner.toLowerCase() === mine.miner.toLowerCase()
                    && !liveSlotsClaimed.has(mine.slotIndex);

                  let earned = mine.earned;
                  let minted = mine.minted;
                  if (isCurrentMiner) {
                    liveSlotsClaimed.add(mine.slotIndex);
                    const slotLivePrice = computeTickedPrice(slot);
                    earned = (slotLivePrice * 80n) / 100n;
                    const slotEmission = (slot.ups * (slot.upsMultiplier || BigInt(1e18))) / BigInt(1e18);
                    minted = slot.glazed + slotEmission * BigInt(tickElapsed);
                  }

                  return (
                    <MineHistoryItem
                      key={`${mine.miner}-${mine.timestamp}-${index}`}
                      mine={{
                        id: index.toString(),
                        miner: mine.miner,
                        uri: mine.uri,
                        price: mine.price,
                        spent: mine.price,
                        earned,
                        mined: minted,
                        multiplier: mine.multiplier,
                        timestamp: Number(mine.timestamp),
                      }}
                      timeAgo={timeAgo}
                      tokenSymbol={tokenSymbol}
                    />
                  );
                });
                })()}
              </div>
            )}
          </div>

          {/* Leaderboard Section */}
          <Leaderboard
            entries={formattedLeaderboard}
            userRank={userRank ?? null}
            tokenSymbol={tokenSymbol}
            tokenName={tokenName}
            rigUrl={rigUrl}
            isLoading={isLeaderboardLoading}
          />

          {/* Bottom spacer for fixed action bar */}
          <div className="h-4" />
        </div>

        {/* Bottom Action Bar */}
        <div
          className="fixed bottom-0 left-0 right-0 z-50 bg-zinc-800 flex justify-center"
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

            {/* Price, Balance, Mine Button */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6">
                <div>
                  <div className="text-muted-foreground text-[12px]">Pay</div>
                  <div className="font-semibold text-[17px] tabular-nums">
                    ${rigState ? formatUSDC4(tickedPrice) : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[12px]">Balance</div>
                  <div className="font-semibold text-[17px] tabular-nums">
                    ${formatUSDC(userQuoteBalance)}
                  </div>
                </div>
              </div>
              <button
                onClick={handleMine}
                disabled={isPending || isSuccess || !account || !rigState}
                className={`
                  w-32 h-10 text-[14px] font-semibold rounded-xl transition-all flex items-center justify-center gap-2
                  ${isSuccess
                    ? "bg-zinc-300 text-black"
                    : isError
                    ? "bg-zinc-600 text-white"
                    : account && rigState
                    ? "bg-white text-black hover:bg-zinc-200"
                    : "bg-zinc-700 text-zinc-500 cursor-not-allowed"
                  }
                `}
              >
                {isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Mining...
                  </>
                ) : isSuccess ? (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    Success
                  </>
                ) : isError ? (
                  txError?.message?.includes("cancelled") ? "Rejected" : "Failed"
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
