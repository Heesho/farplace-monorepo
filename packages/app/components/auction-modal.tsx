"use client";

import { useState, useCallback, useEffect } from "react";
import { X, Loader2, ExternalLink, AlertCircle, CheckCircle2 } from "lucide-react";
import { formatEther, formatUnits } from "viem";
import { useAuctionState } from "@/hooks/useAuctionState";
import {
  useBatchedTransaction,
  encodeApproveCall,
  encodeContractCall,
  type Call,
} from "@/hooks/useBatchedTransaction";
import { useFarcaster } from "@/hooks/useFarcaster";
import {
  CONTRACT_ADDRESSES,
  MULTICALL_ABI,
  DEADLINE_BUFFER_SECONDS,
  QUOTE_TOKEN_DECIMALS,
} from "@/lib/contracts";

type AuctionModalProps = {
  isOpen: boolean;
  onClose: () => void;
  rigAddress: `0x${string}`;
  tokenSymbol: string;
  tokenName: string;
  multicallAddress?: `0x${string}`;
};

export function AuctionModal({
  isOpen,
  onClose,
  rigAddress,
  tokenSymbol,
  tokenName,
  multicallAddress,
}: AuctionModalProps) {
  const { address: account } = useFarcaster();
  const multicallAddr =
    multicallAddress ?? (CONTRACT_ADDRESSES.mineMulticall as `0x${string}`);

  const { auctionState, isLoading, refetch: refetchAuction } = useAuctionState(
    rigAddress,
    account,
    multicallAddr
  );

  const { execute, status, txHash, error, reset } = useBatchedTransaction();

  // Reset transaction state when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      reset();
    }
  }, [isOpen, reset]);

  // Auto-refetch after successful tx
  useEffect(() => {
    if (status === "success") {
      const timer = setTimeout(() => {
        refetchAuction();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [status, refetchAuction]);

  // Derived display values
  const lpPriceFormatted = auctionState
    ? formatEther(auctionState.price)
    : "0";

  const userLpBalance = auctionState
    ? formatEther(auctionState.accountPaymentTokenBalance)
    : "0";

  const treasuryUsdc = auctionState
    ? formatUnits(auctionState.quoteAccumulated, QUOTE_TOKEN_DECIMALS)
    : "0";

  const hasEnoughLp = auctionState
    ? auctionState.accountPaymentTokenBalance >= auctionState.price
    : false;

  const isAuctionActive = auctionState
    ? auctionState.price > 0n && auctionState.startTime > 0n
    : false;

  // Buy handler -- approve LP token then call buy on multicall
  const handleBuy = useCallback(async () => {
    if (!auctionState || !account) return;

    const calls: Call[] = [];
    const deadline = BigInt(
      Math.floor(Date.now() / 1000) + DEADLINE_BUFFER_SECONDS
    );

    // Approve LP token spending for the multicall contract
    calls.push(
      encodeApproveCall(
        auctionState.paymentToken,
        multicallAddr,
        auctionState.price
      )
    );

    // Buy call: buy(rig, epochId, deadline, maxPaymentTokenAmount)
    calls.push(
      encodeContractCall(
        multicallAddr,
        MULTICALL_ABI,
        "buy",
        [rigAddress, auctionState.epochId, deadline, auctionState.price],
        0n
      )
    );

    await execute(calls);
  }, [auctionState, account, multicallAddr, rigAddress, execute]);

  if (!isOpen) return null;

  // Button state/label based on transaction status
  const getButtonContent = () => {
    if (status === "pending") {
      return (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Confirming...</span>
        </>
      );
    }
    if (status === "success") {
      return (
        <>
          <CheckCircle2 className="w-4 h-4" />
          <span>Purchased!</span>
        </>
      );
    }
    if (!account) return <span>Connect wallet</span>;
    if (isLoading) return <span>Loading...</span>;
    if (!isAuctionActive) return <span>No active auction</span>;
    if (!hasEnoughLp) return <span>Insufficient LP balance</span>;
    return <span>Buy 1 {tokenSymbol}</span>;
  };

  const isButtonDisabled =
    !account ||
    isLoading ||
    !isAuctionActive ||
    !hasEnoughLp ||
    status === "pending" ||
    status === "success";

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-[520px] bg-background rounded-t-2xl p-5 pb-8 animate-in slide-in-from-bottom duration-300">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[18px] font-semibold">
            Auction &middot; {tokenSymbol}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-secondary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Auction data */}
        {!isLoading && (
          <>
            {/* Auction info card */}
            <div className="bg-secondary/50 rounded-xl p-4 mb-4">
              <div className="text-muted-foreground text-[12px] mb-1">
                Current price for 1 {tokenSymbol}
              </div>
              <div className="text-[22px] font-semibold tabular-nums">
                {isAuctionActive
                  ? `${Number(lpPriceFormatted).toFixed(6)} LP`
                  : "No active auction"}
              </div>
              {isAuctionActive && auctionState && (
                <div className="text-muted-foreground text-[12px] mt-1">
                  Epoch #{auctionState.epochId.toString()}
                </div>
              )}
            </div>

            {/* User balance + treasury info */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-secondary/50 rounded-xl p-3">
                <div className="text-muted-foreground text-[12px] mb-0.5">
                  Your LP balance
                </div>
                <div className="font-semibold text-[15px] tabular-nums">
                  {Number(userLpBalance).toFixed(6)}
                </div>
              </div>
              <div className="bg-secondary/50 rounded-xl p-3">
                <div className="text-muted-foreground text-[12px] mb-0.5">
                  Treasury (USDC)
                </div>
                <div className="font-semibold text-[15px] tabular-nums">
                  ${Number(treasuryUsdc).toFixed(2)}
                </div>
              </div>
            </div>

            {/* Insufficient balance warning */}
            {account && isAuctionActive && !hasEnoughLp && (
              <div className="flex items-center gap-2 text-[13px] text-zinc-400 bg-secondary/30 rounded-lg px-3 py-2 mb-4">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>
                  You need{" "}
                  {Number(lpPriceFormatted).toFixed(6)} LP tokens to buy.
                  You have {Number(userLpBalance).toFixed(6)}.
                </span>
              </div>
            )}

            {/* Error message */}
            {status === "error" && error && (
              <div className="flex items-center gap-2 text-[13px] text-red-400 bg-red-500/10 rounded-lg px-3 py-2 mb-4">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error.message ?? "Transaction failed"}</span>
              </div>
            )}

            {/* Success message with tx link */}
            {status === "success" && txHash && (
              <div className="flex items-center gap-2 text-[13px] text-zinc-300 bg-zinc-700/50 rounded-lg px-3 py-2 mb-4">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-white" />
                <span>Transaction confirmed</span>
                <a
                  href={`https://basescan.org/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto flex items-center gap-1 text-zinc-400 hover:text-white transition-colors"
                >
                  View
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}

            {/* Buy button */}
            <button
              onClick={handleBuy}
              disabled={isButtonDisabled}
              className={`w-full py-3 rounded-xl font-semibold text-[15px] flex items-center justify-center gap-2 transition-all ${
                isButtonDisabled
                  ? "bg-secondary text-muted-foreground cursor-not-allowed"
                  : "bg-white text-black hover:bg-zinc-200 active:scale-[0.98]"
              }`}
            >
              {getButtonContent()}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
