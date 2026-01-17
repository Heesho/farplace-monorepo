"use client";

import { useState, useCallback, useEffect } from "react";
import { X, Delete } from "lucide-react";
import { NavBar } from "@/components/nav-bar";

type TradeMode = "buy" | "sell";

type TradeModalProps = {
  isOpen: boolean;
  onClose: () => void;
  mode: TradeMode;
  tokenSymbol?: string;
  tokenName?: string;
  marketPrice?: number;
  userBalance?: number; // USD balance for buy, token balance for sell
  priceImpact?: number; // percentage, e.g. 0.5 for 0.5%
};

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

export function TradeModal({
  isOpen,
  onClose,
  mode,
  tokenSymbol = "DONUT",
  tokenName = "Donut",
  marketPrice = 0.00234,
  userBalance = 45.73,
  priceImpact = 0.5,
}: TradeModalProps) {
  const [amount, setAmount] = useState("0");

  const isBuy = mode === "buy";

  // Reset amount when modal opens
  useEffect(() => {
    if (isOpen) {
      setAmount("0");
    }
  }, [isOpen]);

  // Handle number pad input
  // Buy: USD input, Sell: Coin input
  const handleNumPadPress = useCallback((value: string) => {
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
  }, [isBuy]);

  // Calculate values
  // Buy: input is USD, output is coins
  // Sell: input is coins, output is USD
  const inputAmount = parseFloat(amount) || 0;

  const usdAmount = isBuy ? inputAmount : inputAmount * marketPrice;
  const coinAmount = isBuy ? (marketPrice > 0 ? inputAmount / marketPrice : 0) : inputAmount;

  const minReceived = isBuy
    ? coinAmount * (1 - priceImpact / 100)
    : usdAmount * (1 - priceImpact / 100);

  // Format numbers
  const formatCoin = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(2)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(2)}K`;
    if (n < 1) return n.toFixed(6);
    return n.toFixed(2);
  };

  // Available balance display
  const availableDisplay = isBuy
    ? `$${userBalance.toFixed(2)} available`
    : `${formatCoin(userBalance)} ${tokenSymbol} available`;

  if (!isOpen) return null;

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
          <div className="w-9" /> {/* Spacer for balance */}
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
                ${marketPrice.toFixed(6)}
              </span>
            </div>
          </div>

          {/* Estimated output */}
          <div className="py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-muted-foreground">Est. received</span>
              <span className="text-[13px] font-medium tabular-nums">
                {isBuy ? `${formatCoin(coinAmount)} ${tokenSymbol}` : `$${usdAmount.toFixed(2)}`}
              </span>
            </div>
          </div>

          {/* Price impact and minimum - below the line */}
          <div className="flex items-center justify-end gap-3 py-3 text-[11px] text-muted-foreground">
            <span>{inputAmount > 0 ? priceImpact : 0}% slippage</span>
            <span>·</span>
            <span>
              {isBuy ? `${formatCoin(minReceived)} ${tokenSymbol}` : `$${minReceived.toFixed(2)}`} min
            </span>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Action button */}
          <button
            disabled={inputAmount === 0}
            className={`w-full h-11 rounded-xl font-semibold text-[14px] transition-all mb-4 ${
              inputAmount > 0
                ? "bg-white text-black hover:bg-zinc-200"
                : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
            }`}
          >
            {isBuy ? "Buy" : "Sell"}
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
