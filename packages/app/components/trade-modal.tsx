"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { X, Delete, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { useReadContract } from "wagmi";
import { formatUnits, formatEther, parseUnits } from "viem";
import { useSwapQuote } from "@/hooks/useSwapQuote";
import {
  useBatchedTransaction,
  encodeApproveCall,
  encodeContractCall,
  type Call,
} from "@/hooks/useBatchedTransaction";
import { useFarcaster } from "@/hooks/useFarcaster";
import {
  CONTRACT_ADDRESSES,
  QUOTE_TOKEN_DECIMALS,
  UNIV2_ROUTER_ABI,
  UNIV2_FACTORY_ABI,
  UNIV2_PAIR_ABI,
} from "@/lib/contracts";
import { formatCoin } from "@/lib/format";

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

// Buffer added on top of price impact for auto slippage (0.1%)
const SLIPPAGE_BUFFER_BPS = 10;

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

function addCommas(s: string): string {
  const [whole, dec] = s.split(".");
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return dec !== undefined ? `${withCommas}.${dec}` : withCommas;
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
  const usdcAddress = CONTRACT_ADDRESSES.usdc as `0x${string}`;

  // Reset input when modal opens / mode changes
  useEffect(() => {
    if (isOpen) {
      setAmount("0");
      reset();
    }
  }, [isOpen, mode, reset]);

  // ---- Derived amounts ----------------------------------------------------
  const sellDecimals = isBuy ? QUOTE_TOKEN_DECIMALS : 18;
  const outDecimals = isBuy ? 18 : QUOTE_TOKEN_DECIMALS;
  const sellToken = isBuy ? usdcAddress : unitAddress;
  const buyToken = isBuy ? unitAddress : usdcAddress;

  const parsedInput = useMemo(() => {
    try {
      if (!amount || amount === "0" || amount === "0.") return 0n;
      return parseUnits(amount, sellDecimals);
    } catch {
      return 0n;
    }
  }, [amount, sellDecimals]);

  const debouncedInput = useDebounced(parsedInput, 500);

  // ---- Balance display ----------------------------------------------------
  const displayBalance = isBuy
    ? formatUnits(userQuoteBalance, QUOTE_TOKEN_DECIMALS)
    : formatEther(userUnitBalance);

  const userBalanceWei = isBuy ? userQuoteBalance : userUnitBalance;
  const insufficientBalance = parsedInput > 0n && parsedInput > userBalanceWei;

  const availableDisplay = isBuy
    ? `$${Number(displayBalance).toFixed(2)} available`
    : `${formatCoin(Number(displayBalance))} ${tokenSymbol} available`;

  // ---- LP reserves for spot price -----------------------------------------
  const { data: pairAddress } = useReadContract({
    address: CONTRACT_ADDRESSES.uniV2Factory as `0x${string}`,
    abi: UNIV2_FACTORY_ABI,
    functionName: "getPair",
    args: [usdcAddress, unitAddress],
  });

  const hasPair =
    !!pairAddress &&
    pairAddress !== "0x0000000000000000000000000000000000000000";

  const { data: reserves } = useReadContract({
    address: pairAddress as `0x${string}`,
    abi: UNIV2_PAIR_ABI,
    functionName: "getReserves",
    query: {
      enabled: hasPair,
      refetchInterval: 10_000,
      staleTime: 5_000,
    },
  });

  const { data: token0 } = useReadContract({
    address: pairAddress as `0x${string}`,
    abi: UNIV2_PAIR_ABI,
    functionName: "token0",
    query: { enabled: hasPair },
  });

  // Spot price from LP reserves (USDC per Unit)
  const { spotPrice, reserveIn, reserveOut } = useMemo(() => {
    if (!reserves || !token0) return { spotPrice: null, reserveIn: 0n, reserveOut: 0n };
    const [reserve0, reserve1] = reserves;
    const isToken0Usdc = token0.toLowerCase() === usdcAddress.toLowerCase();
    const reserveUsdc = isToken0Usdc ? reserve0 : reserve1;
    const reserveUnit = isToken0Usdc ? reserve1 : reserve0;
    if (reserveUnit === 0n) return { spotPrice: 0, reserveIn: 0n, reserveOut: 0n };
    // USDC per Unit = (reserveUsdc / 1e6) / (reserveUnit / 1e18)
    const price = (Number(reserveUsdc) * 1e12) / Number(reserveUnit);
    // reserveIn/Out relative to the trade direction
    const rIn = isBuy ? reserveUsdc : reserveUnit;
    const rOut = isBuy ? reserveUnit : reserveUsdc;
    return { spotPrice: price, reserveIn: rIn, reserveOut: rOut };
  }, [reserves, token0, usdcAddress, isBuy]);

  // ---- Swap quote (V2 Router getAmountsOut) --------------------------------
  const {
    data: buyAmountWei,
    isLoading: isQuoteLoading,
    error: quoteError,
  } = useSwapQuote({
    sellToken,
    buyToken,
    sellAmountWei: debouncedInput,
  });

  // ---- Spot output, price impact, auto slippage ----------------------------
  // Spot output = theoretical output at spot price (no fee, no impact)
  const spotOutputWei = useMemo(() => {
    if (!reserveIn || reserveIn === 0n || !reserveOut || debouncedInput === 0n) return null;
    return (debouncedInput * reserveOut) / reserveIn;
  }, [debouncedInput, reserveIn, reserveOut]);

  // Price impact = (spotOutput - actualOutput) / spotOutput
  const priceImpactBps = useMemo(() => {
    if (!spotOutputWei || spotOutputWei === 0n || !buyAmountWei) return null;
    // Basis points: (spot - actual) * 10000 / spot
    const diff = spotOutputWei - buyAmountWei;
    if (diff <= 0n) return 0;
    return Number((diff * 10000n) / spotOutputWei);
  }, [spotOutputWei, buyAmountWei]);

  // Auto slippage = price impact + buffer
  const autoSlippageBps = useMemo(() => {
    if (priceImpactBps === null) return SLIPPAGE_BUFFER_BPS;
    return priceImpactBps + SLIPPAGE_BUFFER_BPS;
  }, [priceImpactBps]);

  // Minimum output: spot output * (1 - autoSlippage)
  const amountOutMin = useMemo(() => {
    if (!spotOutputWei || spotOutputWei === 0n) return null;
    return (spotOutputWei * BigInt(10000 - autoSlippageBps)) / 10000n;
  }, [spotOutputWei, autoSlippageBps]);

  // ---- Display values -----------------------------------------------------
  const estimatedOutput = useMemo(() => {
    if (buyAmountWei) return formatUnits(buyAmountWei, outDecimals);
    return null;
  }, [buyAmountWei, outDecimals]);

  const pricePerToken = spotPrice ?? marketPrice;

  const minReceivedDisplay = useMemo(() => {
    if (!amountOutMin) return null;
    return Number(formatUnits(amountOutMin, outDecimals));
  }, [amountOutMin, outDecimals]);

  const priceImpactDisplay = useMemo(() => {
    if (priceImpactBps === null || debouncedInput === 0n) return null;
    return (priceImpactBps / 100).toFixed(2);
  }, [priceImpactBps, debouncedInput]);

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
    if (!buyAmountWei || !amountOutMin || !taker) return;

    const routerAddress = CONTRACT_ADDRESSES.uniV2Router as `0x${string}`;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200); // 20 min
    const path = [sellToken, buyToken] as readonly `0x${string}`[];

    const calls: Call[] = [];

    // 1. Approve sell token to router
    calls.push(
      encodeApproveCall(sellToken, routerAddress, parsedInput)
    );

    // 2. Swap via V2 Router
    calls.push(
      encodeContractCall(
        routerAddress,
        UNIV2_ROUTER_ABI,
        "swapExactTokensForTokens",
        [parsedInput, amountOutMin, path, taker, deadline],
      )
    );

    try {
      await execute(calls);
    } catch {
      // Error is captured by useBatchedTransaction
    }
  }, [buyAmountWei, amountOutMin, taker, sellToken, buyToken, parsedInput, execute]);

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
    !buyAmountWei ||
    !amountOutMin ||
    isQuoteLoading ||
    status === "pending";

  const buttonLabel = useMemo(() => {
    if (status === "pending") return "Confirming...";
    if (status === "success") return "Success!";
    if (status === "error") return "Try Again";
    if (insufficientBalance) return "Insufficient balance";
    if (isQuoteLoading && parsedInput > 0n) return "Fetching quote...";
    if (parsedInput === 0n) return isBuy ? "Buy" : "Sell";
    if (!buyAmountWei) return "No liquidity";
    return isBuy ? "Buy" : "Sell";
  }, [
    status,
    insufficientBalance,
    isQuoteLoading,
    parsedInput,
    buyAmountWei,
    isBuy,
  ]);

  // ---- Render -------------------------------------------------------------
  if (!isOpen) return null;

  const isPending = status === "pending";
  const isSuccess = status === "success";

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
          <div className="py-4 border-b border-border">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-muted-foreground">Pay</span>
              <span className="text-lg font-semibold tabular-nums">
                {isBuy ? `$${addCommas(amount)}` : addCommas(amount)}
              </span>
            </div>
          </div>

          {/* Market price */}
          <div className="py-4 border-b border-border">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-muted-foreground">Market price</span>
              <span className="text-[13px] font-medium tabular-nums">
                ${pricePerToken.toFixed(6)}
              </span>
            </div>
          </div>

          {/* Estimated output */}
          <div className="py-4 border-b border-border">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-muted-foreground">Est. received</span>
              <span className="text-[13px] font-medium tabular-nums">
                {isQuoteLoading && parsedInput > 0n ? (
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

          {/* Price impact and minimum received */}
          <div className="flex items-center justify-end gap-3 py-3 text-[11px] text-muted-foreground">
            <span>
              {priceImpactDisplay !== null
                ? `~${priceImpactDisplay}% price impact`
                : "—"}
            </span>
            <span>·</span>
            <span>
              {minReceivedDisplay !== null
                ? isBuy
                  ? `${formatCoin(minReceivedDisplay)} ${tokenSymbol}`
                  : `$${minReceivedDisplay.toFixed(2)}`
                : "—"}{" "}
              min
            </span>
          </div>

          {/* Error messages */}
          {(quoteError || txError) && (
            <div className="px-3 py-2 rounded-lg bg-zinc-500/10 border border-zinc-500/20 flex items-start gap-2 mb-3">
              <AlertCircle className="w-4 h-4 text-zinc-400 mt-0.5 flex-shrink-0" />
              <span className="text-[12px] text-zinc-400">
                {(() => {
                  const msg = txError?.message || quoteError?.message || "";
                  if (msg.includes("rejected") || msg.includes("denied")) return "Transaction cancelled";
                  if (msg.includes("insufficient")) return "Insufficient balance";
                  if (msg.includes("INSUFFICIENT_OUTPUT_AMOUNT")) return "Price moved too much, try again";
                  return "Something went wrong";
                })()}
              </span>
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
                ? "bg-zinc-700 text-zinc-500 cursor-not-allowed"
                : isSuccess
                ? "bg-zinc-300 text-black"
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
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 32px)" }}
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
    </div>
  );
}
