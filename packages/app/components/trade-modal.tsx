"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { X, ArrowDown, Loader2, Check, AlertCircle } from "lucide-react";
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
  const [inputValue, setInputValue] = useState("0");

  const { address: taker } = useFarcaster();
  const { execute, status, txHash, error: txError, reset } = useBatchedTransaction();

  // Reset input when modal opens / mode changes
  useEffect(() => {
    if (isOpen) {
      setInputValue("0");
      reset();
    }
  }, [isOpen, mode, reset]);

  // ---- Derived amounts ----------------------------------------------------
  const isBuy = mode === "buy";

  // For buy: inputValue is USD (USDC) amount
  // For sell: inputValue is Unit token amount
  const sellDecimals = isBuy ? QUOTE_TOKEN_DECIMALS : 18;
  const sellToken = isBuy
    ? (CONTRACT_ADDRESSES.usdc as `0x${string}`)
    : unitAddress;
  const buyToken = isBuy
    ? unitAddress
    : (CONTRACT_ADDRESSES.usdc as `0x${string}`);

  const parsedInput = useMemo(() => {
    try {
      if (!inputValue || inputValue === "0" || inputValue === "0.") return 0n;
      return parseUnits(inputValue, sellDecimals);
    } catch {
      return 0n;
    }
  }, [inputValue, sellDecimals]);

  const debouncedInput = useDebounced(parsedInput, 500);
  const debouncedInputStr = debouncedInput.toString();

  // ---- Balance display ----------------------------------------------------
  const displayBalance = isBuy
    ? formatUnits(userQuoteBalance, QUOTE_TOKEN_DECIMALS)
    : formatEther(userUnitBalance);

  const balanceLabel = isBuy ? "USDC" : tokenSymbol;

  const userBalanceWei = isBuy ? userQuoteBalance : userUnitBalance;
  const insufficientBalance = parsedInput > 0n && parsedInput > userBalanceWei;

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

  // ---- Swap quote (full, with tx data) - fetched on confirm ---------------
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
  const handleNumberPad = useCallback(
    (key: string) => {
      if (status === "pending") return;
      setInputValue((prev) => {
        if (key === "backspace") {
          if (prev.length <= 1) return "0";
          return prev.slice(0, -1);
        }
        if (key === ".") {
          if (prev.includes(".")) return prev;
          return prev + ".";
        }
        if (prev === "0" && key !== ".") return key;
        return prev + key;
      });
    },
    [status]
  );

  const handleMaxPress = useCallback(() => {
    if (status === "pending") return;
    if (isBuy) {
      setInputValue(formatUnits(userQuoteBalance, QUOTE_TOKEN_DECIMALS));
    } else {
      setInputValue(formatEther(userUnitBalance));
    }
  }, [isBuy, userQuoteBalance, userUnitBalance, status]);

  // ---- Execute swap -------------------------------------------------------
  const handleConfirm = useCallback(async () => {
    if (!quote?.transaction || !taker) return;

    try {
      const calls: Call[] = [];

      if (isBuy) {
        // Buy: USDC -> Unit (possibly via DONUT intermediate)
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
                CONTRACT_ADDRESSES.donut as `0x${string}`,
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
        // Sell: Unit -> USDC (possibly via DONUT intermediate)
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
                CONTRACT_ADDRESSES.donut as `0x${string}`,
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
    if (parsedInput === 0n) return "Enter an amount";
    if (!quote?.transaction) return "No route found";
    return isBuy ? `Buy ${tokenSymbol}` : `Sell ${tokenSymbol}`;
  }, [
    status,
    insufficientBalance,
    isQuoteLoading,
    parsedInput,
    quote,
    isBuy,
    tokenSymbol,
  ]);

  // ---- Render -------------------------------------------------------------
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-[520px] bg-background rounded-t-2xl pb-[env(safe-area-inset-bottom)] animate-in slide-in-from-bottom duration-300">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="text-[17px] font-semibold">
            {isBuy ? "Buy" : "Sell"} {tokenSymbol}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-secondary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Amount display */}
        <div className="px-5 pb-2">
          <div className="text-center mb-1">
            <div className="text-[36px] font-bold tabular-nums leading-tight">
              {isBuy ? "$" : ""}
              {inputValue}
              {!isBuy && (
                <span className="text-[18px] text-muted-foreground ml-1.5">
                  {tokenSymbol}
                </span>
              )}
            </div>
          </div>

          {/* Estimated output */}
          <div className="text-center text-[14px] text-muted-foreground mb-1">
            {isPriceLoading && parsedInput > 0n ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                Estimating...
              </span>
            ) : estimatedOutput ? (
              <span>
                <ArrowDown className="w-3 h-3 inline mr-1" />
                {isBuy
                  ? `~${formatCompact(Number(estimatedOutput))} ${tokenSymbol}`
                  : `~$${formatCompact(Number(estimatedOutput))}`}
              </span>
            ) : null}
          </div>

          {/* Price per token & min received */}
          {estimatedOutput && (
            <div className="flex justify-between text-[12px] text-muted-foreground px-1 mb-2">
              <span>
                1 {tokenSymbol} = ${formatCompact(pricePerToken, 4)}
              </span>
              {minReceived !== null && (
                <span>
                  Min:{" "}
                  {isBuy
                    ? `${formatCompact(minReceived)} ${tokenSymbol}`
                    : `$${formatCompact(minReceived)}`}
                </span>
              )}
            </div>
          )}

          {/* Balance */}
          <div className="flex items-center justify-between text-[13px] px-1 mb-4">
            <span className="text-muted-foreground">
              Balance: {formatCompact(Number(displayBalance))} {balanceLabel}
            </span>
            <button
              onClick={handleMaxPress}
              className="text-white font-medium hover:opacity-80 transition-opacity"
            >
              Max
            </button>
          </div>
        </div>

        {/* Error messages */}
        {(quoteError || txError) && (
          <div className="mx-5 mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
            <span className="text-[12px] text-red-400">
              {txError?.message || quoteError?.message || "Something went wrong"}
            </span>
          </div>
        )}

        {/* Transaction success */}
        {status === "success" && txHash && (
          <div className="mx-5 mb-3 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20 flex items-center gap-2">
            <Check className="w-4 h-4 text-green-400" />
            <span className="text-[12px] text-green-400">
              Transaction confirmed
            </span>
          </div>
        )}

        {/* Number pad */}
        <div className="grid grid-cols-3 gap-1 px-5 mb-4">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "backspace"].map(
            (key) => (
              <button
                key={key}
                onClick={() => handleNumberPad(key)}
                className="h-14 rounded-xl text-[20px] font-medium transition-colors hover:bg-secondary active:bg-secondary/80"
              >
                {key === "backspace" ? (
                  <span className="text-[18px]">&larr;</span>
                ) : (
                  key
                )}
              </button>
            )
          )}
        </div>

        {/* Confirm button */}
        <div className="px-5 pb-5">
          <button
            disabled={buttonDisabled}
            onClick={handleConfirm}
            className={`w-full h-12 rounded-xl text-[15px] font-semibold transition-all flex items-center justify-center gap-2 ${
              buttonDisabled
                ? "bg-secondary text-muted-foreground"
                : status === "success"
                ? "bg-green-600 text-white"
                : "bg-white text-black hover:bg-zinc-200"
            }`}
          >
            {status === "pending" && (
              <Loader2 className="w-4 h-4 animate-spin" />
            )}
            {status === "success" && <Check className="w-4 h-4" />}
            {buttonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
