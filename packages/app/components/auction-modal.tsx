"use client";

import { useState, useCallback, useEffect } from "react";
import { X, Loader2, CheckCircle } from "lucide-react";
import { formatEther, formatUnits } from "viem";
import { useReadContract } from "wagmi";
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
  ERC20_ABI,
  MULTICALL_ABI,
  QUOTE_TOKEN_DECIMALS,
} from "@/lib/contracts";
import { DEADLINE_BUFFER_SECONDS } from "@/lib/constants";

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
    multicallAddress ?? (CONTRACT_ADDRESSES.multicall as `0x${string}`);

  const { auctionState, isLoading, refetch: refetchAuction } = useAuctionState(
    rigAddress,
    account,
    multicallAddr
  );

  const { execute, status, txHash, error, reset } = useBatchedTransaction();

  // Allowance check — skip approve when sufficient
  const lpTokenAddress = auctionState?.lpToken;
  const auctionPrice = auctionState?.price ?? 0n;
  const { data: currentAllowance } = useReadContract({
    address: lpTokenAddress!,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [account!, multicallAddr],
    query: {
      enabled: !!account && !!lpTokenAddress && auctionPrice > 0n,
    },
  });

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
    ? formatEther(auctionState.accountLpTokenBalance)
    : "0";

  const treasuryUsdc = auctionState
    ? formatUnits(auctionState.quoteAccumulated, QUOTE_TOKEN_DECIMALS)
    : "0";

  const hasEnoughLp = auctionState
    ? auctionState.accountLpTokenBalance >= auctionState.price
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

    // Approve LP token spending (skip if allowance is sufficient)
    const needsApproval = currentAllowance === undefined || currentAllowance < auctionState.price;
    if (needsApproval) {
      calls.push(
        encodeApproveCall(
          auctionState.lpToken,
          multicallAddr,
          auctionState.price
        )
      );
    }

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
  }, [auctionState, account, multicallAddr, rigAddress, execute, currentAllowance]);

  if (!isOpen) return null;

  const isPending = status === "pending";
  const isSuccess = status === "success";
  const isError = status === "error";

  return (
    <div className="fixed inset-0 z-[100] flex h-screen w-screen justify-center bg-zinc-800">
      <div
        className="relative flex h-full w-full max-w-[520px] flex-col bg-background"
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 8px)",
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
          <span className="text-base font-semibold">Auction</span>
          <div className="w-9" />
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col px-4">
          {/* Loading state */}
          {isLoading && (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {!isLoading && (
            <>
              {/* Title */}
              <div className="mt-4 mb-6">
                <h1 className="text-2xl font-semibold tracking-tight">
                  Buy USDC
                </h1>
                <p className="text-[13px] text-muted-foreground mt-1">
                  {Number(userLpBalance).toFixed(3)} {tokenSymbol}-USDC LP available
                </p>
              </div>

              {/* You Pay */}
              <div className="py-4 border-b border-border">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] text-muted-foreground">You pay</span>
                  <span className="text-lg font-semibold tabular-nums">
                    {isAuctionActive ? `${Number(lpPriceFormatted).toFixed(3)} LP` : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[11px] text-muted-foreground">{tokenSymbol}-USDC LP</span>
                  {isAuctionActive && auctionState && (
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      ~${(Number(lpPriceFormatted) * Number(formatUnits(auctionState.lpTokenPrice, 18))).toFixed(2)}
                    </span>
                  )}
                </div>
              </div>

              {/* You Receive */}
              <div className="py-4 border-b border-border">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] text-muted-foreground">You receive</span>
                  <span className="text-lg font-semibold tabular-nums">
                    {isAuctionActive ? `$${Number(treasuryUsdc).toFixed(2)}` : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[11px] text-muted-foreground">USDC</span>
                </div>
              </div>

              {/* Profit indicator */}
              {isAuctionActive && auctionState && (
                <div className="flex items-center justify-end gap-3 py-3 text-[11px] text-muted-foreground">
                  <span className="tabular-nums">
                    {(() => {
                      const lpCost = Number(lpPriceFormatted) * Number(formatUnits(auctionState.lpTokenPrice, 18));
                      const usdcReceive = Number(treasuryUsdc);
                      const profit = usdcReceive - lpCost;
                      return `${profit >= 0 ? "+" : ""}${profit.toFixed(2)} ${profit >= 0 ? "profit" : "loss"}`;
                    })()}
                  </span>
                </div>
              )}

              {/* Spacer */}
              <div className="flex-1" />

              {/* Info text */}
              <p className="text-[11px] text-muted-foreground text-center mb-4">
                Auction price decays over time. Buy when profitable.
              </p>

              {/* Action button */}
              <div
                className="pb-4"
                style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 32px)" }}
              >
                <button
                  onClick={handleBuy}
                  disabled={!account || !isAuctionActive || !hasEnoughLp || isPending || isSuccess}
                  className={`w-full h-11 rounded-xl font-semibold text-[14px] transition-all flex items-center justify-center gap-2 ${
                    isSuccess
                      ? "bg-zinc-300 text-black"
                      : isError
                      ? "bg-zinc-600 text-white"
                      : !account || !isAuctionActive || !hasEnoughLp || isPending
                      ? "bg-zinc-700 text-zinc-500 cursor-not-allowed"
                      : "bg-white text-black hover:bg-zinc-200"
                  }`}
                >
                  {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  {isSuccess && <CheckCircle className="w-4 h-4" />}
                  {isPending
                    ? "Selling..."
                    : isSuccess
                    ? "Sold!"
                    : isError
                    ? "Failed"
                    : !account
                    ? "Connect wallet"
                    : !isAuctionActive
                    ? "No active auction"
                    : !hasEnoughLp
                    ? "Insufficient LP"
                    : "Sell LP"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
