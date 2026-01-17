"use client";

import { useState, useCallback, useEffect } from "react";
import { X, Delete } from "lucide-react";
import { NavBar } from "@/components/nav-bar";

type LiquidityModalProps = {
  isOpen: boolean;
  onClose: () => void;
  tokenSymbol?: string;
  tokenName?: string;
  tokenBalance?: number;
  donutBalance?: number;
  tokenPrice?: number; // Token price in USD
  donutPrice?: number; // DONUT price in USD
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

export function LiquidityModal({
  isOpen,
  onClose,
  tokenSymbol = "DONUT",
  tokenName = "Donut",
  tokenBalance = 25000,
  donutBalance = 1186.38,
  tokenPrice = 0.00234,
  donutPrice = 0.001,
}: LiquidityModalProps) {
  const [tokenAmount, setTokenAmount] = useState("0");

  // Reset when modal opens
  useEffect(() => {
    if (isOpen) {
      setTokenAmount("0");
    }
  }, [isOpen]);

  // Handle number pad input
  const handleNumPadPress = useCallback((value: string) => {
    setTokenAmount((prev) => {
      if (value === "backspace") {
        if (prev.length <= 1) return "0";
        return prev.slice(0, -1);
      }

      if (value === ".") {
        if (prev.includes(".")) return prev;
        return prev + ".";
      }

      // Limit decimal places
      const decimalIndex = prev.indexOf(".");
      if (decimalIndex !== -1) {
        const decimals = prev.length - decimalIndex - 1;
        if (decimals >= 6) return prev;
      }

      // Replace initial 0
      if (prev === "0" && value !== ".") {
        return value;
      }

      // Limit total length
      if (prev.length >= 12) return prev;

      return prev + value;
    });
  }, []);

  // Calculate values
  const tokenInputAmount = parseFloat(tokenAmount) || 0;

  // Required DONUT is calculated based on token amount and price ratio
  const requiredDonut = (tokenInputAmount * tokenPrice) / donutPrice;

  // LP tokens received (simplified calculation)
  const lpTokensReceived = Math.sqrt(tokenInputAmount * requiredDonut);

  // Check if user has enough balance
  const hasEnoughToken = tokenInputAmount <= tokenBalance;
  const hasEnoughDonut = requiredDonut <= donutBalance;
  const canCreate = tokenInputAmount > 0 && hasEnoughToken && hasEnoughDonut;

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
          <span className="text-base font-semibold">Liquidity</span>
          <div className="w-9" />
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col px-4">
          {/* Title */}
          <div className="mt-4 mb-6">
            <h1 className="text-2xl font-semibold tracking-tight">Add Liquidity</h1>
            <p className="text-[13px] text-muted-foreground mt-1">
              Provide {tokenSymbol} and DONUT to get LP tokens
            </p>
          </div>

          {/* Token Input */}
          <div className="py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[13px] text-muted-foreground">You provide</span>
              <button
                onClick={() => setTokenAmount(tokenBalance.toString())}
                className="text-[11px] text-muted-foreground hover:text-zinc-300 transition-colors"
              >
                Balance: {tokenBalance.toLocaleString()}
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-semibold tabular-nums">
                {tokenAmount}
              </span>
              <div className="flex items-center gap-2 bg-zinc-800 rounded-full px-3 py-1.5">
                <div className="w-5 h-5 rounded-full bg-zinc-600 flex items-center justify-center text-[10px] font-semibold">
                  {tokenSymbol.charAt(0)}
                </div>
                <span className="text-sm font-medium">{tokenSymbol}</span>
              </div>
            </div>
          </div>

          {/* Required DONUT */}
          <div className="py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[13px] text-muted-foreground">Required DONUT</span>
              <button
                onClick={() => {
                  // Calculate max token amount based on donut balance
                  const maxTokenFromDonut = (donutBalance * donutPrice) / tokenPrice;
                  setTokenAmount(Math.min(tokenBalance, maxTokenFromDonut).toFixed(2));
                }}
                className="text-[11px] text-muted-foreground hover:text-zinc-300 transition-colors"
              >
                Balance: {donutBalance.toLocaleString()}
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-semibold tabular-nums">
                {requiredDonut.toFixed(2)}
              </span>
              <div className="flex items-center gap-2 bg-zinc-800 rounded-full px-3 py-1.5">
                <div className="w-5 h-5 rounded-full bg-zinc-600 flex items-center justify-center text-[10px] font-semibold">
                  D
                </div>
                <span className="text-sm font-medium">DONUT</span>
              </div>
            </div>
          </div>

          {/* LP Output */}
          <div className="flex items-center justify-end gap-3 py-3 text-[11px] text-muted-foreground">
            <span className="tabular-nums">
              You receive ~ {lpTokensReceived.toFixed(2)} LP tokens
            </span>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Action button */}
          <button
            disabled={!canCreate}
            className={`w-full h-11 rounded-xl font-semibold text-[14px] transition-all mb-4 ${
              canCreate
                ? "bg-white text-black hover:bg-zinc-200"
                : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
            }`}
          >
            {!hasEnoughDonut && tokenInputAmount > 0 ? "Insufficient DONUT" : "Create LP"}
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
