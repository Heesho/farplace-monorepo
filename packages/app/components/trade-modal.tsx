"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { X, Delete, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { NavBar } from "@/components/nav-bar";
import { formatUnits, formatEther, parseUnits } from "viem";
import { useSwapPrice, useSwapQuote } from "@/hooks/useSwapQuote";
import {
  useBatchedTransaction,
  encodeApproveCall,
  type Call,
} from "@/hooks/useBatchedTransaction";
import { useFarcaster } from "@/hooks/useFarcaster";
import { CONTRACT_ADDRESSES, QUOTE_TOKEN_DECIMALS } from "@/lib/contracts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TradeModalProps = {
  isOpen: boolean;
  onClose: () => void;
  mode: "buy" | "sell";
  tokenSymbol: string;
  tokenName: string;
  unitAddress: `0x${string}`;
  marketPrice: number;
  userQuoteBalance: bigint;
  userUnitBalance: bigint;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SLIPPAGE_BPS = 100; // 1 %

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

function formatCompact(n: number, decimals = 2): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(decimals)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(decimals)}K`;
  if (n >= 1) return n.toFixed(decimals);
  if (n >= 0.0001) return n.toFixed(6);
  if (n === 0) return "0";
  return n.toExponential(2);
}

function formatCoin(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(2)}K`;
  if (n < 1) return n.toFixed(6);
  return n.toFixed(2);
}

// Number pad button component
function NumPadButton({
  value,
  onClick,
  children,
}: {
  value: string;
  onClick: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={() => onClick(value)}
      className="flex-1 h-14 flex items-center justify-center text-xl font-medium text-white hover:bg-zinc-800/50 active:bg-zinc-700/50 rounded-xl transition-colors"
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TradeModal({
  isOpen,
  onClose,
  mode,
  tokenSymbol,
  tokenName,
  unitAddress,
  marketPrice,
  userQuoteBalance,
  userUnitBalance,
}: TradeModalProps) {
  // ---- Local state --------------------------------------------------------
  const [amount, setAmount] = useState("0");

  const { address: taker } = useFarcaster();
  const { execute, status, txHash, error: txError, reset } = useBatchedTransaction();

  const isBuy = mode === "buy";

  // Reset input when modal opens / mode changes
  useEffect(() => {
    if (isOpen) {
      setAmount("0");
      reset();
    }
  }, [isOpen, mode, reset]);

  // ---- Derived amounts ----------------------------------------------------
  // For buy: amount is USD (USDC) amount
  // For sell: amount is Unit token amount
  const sellDecimals = isBuy ? QUOTE_TOKEN_DECIMALS : 18;
  const sellToken = isBuy
    ? (CONTRACT_ADDRESSES.usdc as `0x${string}`)
    : unitAddress;
  const buyToken = isBuy
    ? unitAddress
    : (CONTRACT_ADDRESSES.usdc as `0x${string}`);

  const parsedInput = useMemo(() => {
    try {
      if (!amount || amount === "0" || amount === "0.") return 0n;
      return parseUnits(amount, sellDecimals);
    } catch {
      return 0n;
    }
  }, [amount, sellDecimals]);

  const debouncedInput = useDebounced(parsedInput, 500);
  const debouncedInputStr = debouncedInput.toString();

  // ---- Balance display ----------------------------------------------------
  const displayBalance = isBuy
    ? formatUnits(userQuoteBalance, QUOTE_TOKEN_DECIMALS)
    : formatEther(userUnitBalance);

  const userBalanceWei = isBuy ? userQuoteBalance : userUnitBalance;
  const insufficientBalance = parsedInput > 0n && parsedInput > userBalanceWei;

  // Available balance display
  const availableDisplay = isBuy
    ? `$${Number(displayBalance).toFixed(2)} available`
    : `${formatCoin(Number(displayBalance))} ${tokenSymbol} available`;

  // ---- Swap price (lightweight, real-time) --------------------------------
  const {
    data: priceData,
    isLoading: isPriceLoading,
  } = useSwapPrice({
    sellToken,
    buyToken,
    sellAmount: debouncedInputStr,
    sellTokenDecimals: sellDecimals,
  });

  // ---- Swap quote (full, with tx data) ------------------------------------
  const {
    data: quote,
    isLoading: isQuoteLoading,
    error: quoteError,
  } = useSwapQuote({
    sellToken,
    buyToken,
    sellAmount: debouncedInputStr,
    sellTokenDecimals: sellDecimals,
    taker: taker as `0x${string}` | undefined,
    slippageBps: SLIPPAGE_BPS,
  });

  // ---- Estimated output ---------------------------------------------------
  const estimatedOutput = useMemo(() => {
    if (priceData?.buyAmount) {
      const outDecimals = isBuy ? 18 : QUOTE_TOKEN_DECIMALS;
      return formatUnits(BigInt(priceData.buyAmount), outDecimals);
    }
    return null;
  }, [priceData, isBuy]);

  const pricePerToken = useMemo(() => {
    if (priceData?.price) return Number(priceData.price);
    return marketPrice;
  }, [priceData, marketPrice]);

  const minReceived = useMemo(() => {
    if (!estimatedOutput) return null;
    const out = Number(estimatedOutput);
    return out * (1 - SLIPPAGE_BPS / 10_000);
  }, [estimatedOutput]);

  // ---- Number pad ---------------------------------------------------------
  const handleNumPadPress = useCallback(
    (value: string) => {
      if (status === "pending") return;
      setAmount((prev) => {
        if (value === "backspace") {
          if (prev.length <= 1) return "0";
          return prev.slice(0, -1);
        }

        if (value === ".") {
          if (prev.includes(".")) return prev;
          return prev + ".";
        }

        // Limit decimal places: 2 for USD (buy), 6 for coins (sell)
        const maxDecimals = isBuy ? 2 : 6;
        const decimalIndex = prev.indexOf(".");
        if (decimalIndex !== -1) {
          const decimals = prev.length - decimalIndex - 1;
          if (decimals >= maxDecimals) return prev;
        }

        // Replace initial 0
        if (prev === "0" && value !== ".") {
          return value;
        }

        // Limit total length
        if (prev.length >= 12) return prev;

        return prev + value;
      });
    },
    [status, isBuy]
  );

  // ---- Execute swap -------------------------------------------------------
  const handleConfirm = useCallback(async () => {
    if (!quote?.transaction || !taker) return;

    try {
      const calls: Call[] = [];

      if (isBuy) {
        // Buy: USDC -> Unit
        if (quote.issues?.allowance) {
          calls.push(
            encodeApproveCall(
              CONTRACT_ADDRESSES.usdc as `0x${string}`,
              quote.issues.allowance.spender as `0x${string}`,
              BigInt(quote.issues.allowance.expected)
            )
          );
        }

        calls.push({
          to: quote.transaction.to as `0x${string}`,
          data: quote.transaction.data as `0x${string}`,
          value: BigInt(quote.transaction.value || "0"),
        });

        if (quote.transaction2) {
          if (quote.issues?.allowance2) {
            calls.push(
              encodeApproveCall(
                CONTRACT_ADDRESSES.usdc as `0x${string}`,
                quote.issues.allowance2.spender as `0x${string}`,
                BigInt(quote.intermediateAmount || "0")
              )
            );
          }
          calls.push({
            to: quote.transaction2.to as `0x${string}`,
            data: quote.transaction2.data as `0x${string}`,
            value: BigInt(quote.transaction2.value || "0"),
          });
        }
      } else {
        // Sell: Unit -> USDC
        if (quote.issues?.allowance) {
          calls.push(
            encodeApproveCall(
              unitAddress,
              quote.issues.allowance.spender as `0x${string}`,
              BigInt(quote.issues.allowance.expected)
            )
          );
        }

        calls.push({
          to: quote.transaction.to as `0x${string}`,
          data: quote.transaction.data as `0x${string}`,
          value: BigInt(quote.transaction.value || "0"),
        });

        if (quote.transaction2) {
          if (quote.issues?.allowance2) {
            calls.push(
              encodeApproveCall(
                CONTRACT_ADDRESSES.usdc as `0x${string}`,
                quote.issues.allowance2.spender as `0x${string}`,
                BigInt(quote.intermediateAmount || "0")
              )
            );
          }
          calls.push({
            to: quote.transaction2.to as `0x${string}`,
            data: quote.transaction2.data as `0x${string}`,
            value: BigInt(quote.transaction2.value || "0"),
          });
        }
      }

      await execute(calls);
    } catch {
      // Error is captured by useBatchedTransaction
    }
  }, [quote, taker, isBuy, unitAddress, execute]);

  // Auto-close on success after a short delay
  useEffect(() => {
    if (status === "success") {
      const id = setTimeout(() => onClose(), 2000);
      return () => clearTimeout(id);
    }
  }, [status, onClose]);

  // ---- Button state -------------------------------------------------------
  const inputAmount = parseFloat(amount) || 0;
  const buttonDisabled =
    parsedInput === 0n ||
    insufficientBalance ||
    !quote?.transaction ||
    isQuoteLoading ||
    status === "pending";

  const buttonLabel = useMemo(() => {
    if (status === "pending") return "Confirming...";
    if (status === "success") return "Success!";
    if (status === "error") return "Try Again";
    if (insufficientBalance) return "Insufficient balance";
    if (isQuoteLoading) return "Fetching quote...";
    if (parsedInput === 0n) return isBuy ? "Buy" : "Sell";
    if (!quote?.transaction) return "No route found";
    return isBuy ? "Buy" : "Sell";
  }, [
    status,
    insufficientBalance,
    isQuoteLoading,
    parsedInput,
    quote,
    isBuy,
  ]);

  // ---- Render -------------------------------------------------------------
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
          <span className="text-base font-semibold">{isBuy ? "Buy" : "Sell"}</span>
          <div className="w-9" />
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col px-4">
          {/* Title */}
          <div className="mt-4 mb-6">
            <h1 className="text-2xl font-semibold tracking-tight">
              {isBuy ? "Buy" : "Sell"} {tokenSymbol}
            </h1>
            <p className="text-[13px] text-muted-foreground mt-1">
              {availableDisplay}
            </p>
          </div>

          {/* Amount input display */}
          <div className="py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-muted-foreground">Amount</span>
              <span className="text-lg font-semibold tabular-nums">
                {isBuy ? `$${amount}` : amount}
              </span>
            </div>
          </div>

          {/* Market price */}
          <div className="py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-muted-foreground">Market price</span>
              <span className="text-[13px] font-medium tabular-nums">
                ${pricePerToken.toFixed(6)}
              </span>
            </div>
          </div>

          {/* Estimated output */}
          <div className="py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-muted-foreground">Est. received</span>
              <span className="text-[13px] font-medium tabular-nums">
                {isPriceLoading && parsedInput > 0n ? (
                  <Loader2 className="w-4 h-4 animate-spin inline" />
                ) : estimatedOutput ? (
                  isBuy
                    ? `${formatCoin(Number(estimatedOutput))} ${tokenSymbol}`
                    : `$${Number(estimatedOutput).toFixed(2)}`
                ) : (
                  "—"
                )}
              </span>
            </div>
          </div>

          {/* Price impact and minimum */}
          <div className="flex items-center justify-end gap-3 py-3 text-[11px] text-muted-foreground">
            <span>{inputAmount > 0 ? SLIPPAGE_BPS / 100 : 0}% slippage</span>
            <span>·</span>
            <span>
              {minReceived !== null
                ? isBuy
                  ? `${formatCoin(minReceived)} ${tokenSymbol}`
                  : `$${minReceived.toFixed(2)}`
                : "—"}{" "}
              min
            </span>
          </div>

          {/* Error messages */}
          {(quoteError || txError) && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2 mb-3">
              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
              <span className="text-[12px] text-red-400">
                {txError?.message || quoteError?.message || "Something went wrong"}
              </span>
            </div>
          )}

          {/* Transaction success */}
          {isSuccess && txHash && (
            <div className="px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20 flex items-center gap-2 mb-3">
              <CheckCircle className="w-4 h-4 text-green-400" />
              <span className="text-[12px] text-green-400">
                Transaction confirmed
              </span>
              <a
                href={`https://basescan.org/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto text-[11px] text-green-400/70 hover:underline"
              >
                View
              </a>
            </div>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Action button */}
          <button
            disabled={buttonDisabled}
            onClick={handleConfirm}
            className={`w-full h-11 rounded-xl font-semibold text-[14px] transition-all mb-4 flex items-center justify-center gap-2 ${
              buttonDisabled
                ? "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                : isSuccess
                ? "bg-green-600 text-white"
                : "bg-white text-black hover:bg-zinc-200"
            }`}
          >
            {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            {isSuccess && <CheckCircle className="w-4 h-4" />}
            {buttonLabel}
          </button>

          {/* Number pad */}
          <div
            className="pb-4"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 70px)" }}
          >
            <div className="grid grid-cols-3 gap-2">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "backspace"].map(
                (key) => (
                  <NumPadButton key={key} value={key} onClick={handleNumPadPress}>
                    {key === "backspace" ? (
                      <Delete className="w-6 h-6" />
                    ) : (
                      key
                    )}
                  </NumPadButton>
                )
              )}
            </div>
          </div>
        </div>
      </div>
      <NavBar />
    </div>
  );
}
