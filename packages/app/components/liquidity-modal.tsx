"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { X, Delete, Loader2, CheckCircle } from "lucide-react";
import { parseUnits, parseEther, formatEther, formatUnits } from "viem";
import { useReadContract } from "wagmi";
import { useFarcaster } from "@/hooks/useFarcaster";
import {
  useBatchedTransaction,
  encodeApproveCall,
  encodeContractCall,
  type Call,
} from "@/hooks/useBatchedTransaction";
import {
  CONTRACT_ADDRESSES,
  ERC20_ABI,
  UNIV2_ROUTER_ABI,
  QUOTE_TOKEN_DECIMALS,
} from "@/lib/contracts";
import { DEADLINE_BUFFER_SECONDS } from "@/lib/constants";

type LiquidityModalProps = {
  isOpen: boolean;
  onClose: () => void;
  unitAddress: `0x${string}`;
  tokenSymbol?: string;
  tokenName?: string;
  tokenBalance?: number;
  usdcBalance?: number;
  tokenPrice?: number; // Token price in USDC
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
  unitAddress,
  tokenSymbol = "TOKEN",
  tokenName = "Token",
  tokenBalance = 0,
  usdcBalance = 0,
  tokenPrice = 0,
}: LiquidityModalProps) {
  const { address: account } = useFarcaster();
  const { execute, status: txStatus, txHash, error: txError, reset: resetTx } = useBatchedTransaction();
  const [tokenAmount, setTokenAmount] = useState("0");

  // Reset when modal opens/closes
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (isOpen) {
      setTokenAmount("0");
      resetTx();
    }
  }, [isOpen, resetTx]);
  /* eslint-enable react-hooks/set-state-in-effect */

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
  const requiredUsdc = tokenInputAmount * tokenPrice;
  const lpTokensReceived = Math.sqrt(tokenInputAmount * requiredUsdc);

  // Validation
  const hasEnoughToken = tokenInputAmount <= tokenBalance;
  const hasEnoughUsdc = requiredUsdc <= usdcBalance;
  const canCreate = tokenInputAmount > 0 && hasEnoughToken && hasEnoughUsdc && !!account;

  const isPending = txStatus === "pending" || txStatus === "confirming";
  const isSuccess = txStatus === "success";
  const isError = txStatus === "error";

  // Pre-compute amounts for allowance checks
  const routerAddress = CONTRACT_ADDRESSES.uniV2Router as `0x${string}`;
  const usdcAddress = CONTRACT_ADDRESSES.usdc as `0x${string}`;
  const tokenAmountWei = useMemo(() => {
    try {
      return tokenInputAmount > 0 ? parseEther(tokenInputAmount.toString()) : 0n;
    } catch { return 0n; }
  }, [tokenInputAmount]);
  const usdcAmountWei = useMemo(() => {
    try {
      return requiredUsdc > 0 ? parseUnits(requiredUsdc.toFixed(QUOTE_TOKEN_DECIMALS), QUOTE_TOKEN_DECIMALS) : 0n;
    } catch { return 0n; }
  }, [requiredUsdc]);

  // Allowance checks — skip approve when sufficient
  const { data: unitAllowance } = useReadContract({
    address: unitAddress,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [account!, routerAddress],
    query: { enabled: !!account && tokenAmountWei > 0n },
  });
  const { data: usdcAllowance } = useReadContract({
    address: usdcAddress,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [account!, routerAddress],
    query: { enabled: !!account && usdcAmountWei > 0n },
  });

  // Add liquidity handler
  const handleAddLiquidity = useCallback(async () => {
    if (!account || !canCreate) return;

    // 1% slippage tolerance
    const tokenAmountMin = (tokenAmountWei * 99n) / 100n;
    const usdcAmountMin = (usdcAmountWei * 99n) / 100n;

    const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_BUFFER_SECONDS);

    const calls: Call[] = [];

    // Approve unit token for router (skip if allowance is sufficient)
    if (unitAllowance === undefined || unitAllowance < tokenAmountWei) {
      calls.push(encodeApproveCall(unitAddress, routerAddress, tokenAmountWei));
    }

    // Approve USDC for router (skip if allowance is sufficient)
    if (usdcAllowance === undefined || usdcAllowance < usdcAmountWei) {
      calls.push(encodeApproveCall(usdcAddress, routerAddress, usdcAmountWei));
    }

    // Call addLiquidity on Uniswap V2 Router
    calls.push(
      encodeContractCall(
        routerAddress,
        UNIV2_ROUTER_ABI,
        "addLiquidity",
        [
          unitAddress,
          usdcAddress,
          tokenAmountWei,
          usdcAmountWei,
          tokenAmountMin,
          usdcAmountMin,
          account,
          deadline,
        ],
        0n
      )
    );

    await execute(calls);
  }, [account, canCreate, tokenAmountWei, usdcAmountWei, unitAddress, execute, unitAllowance, usdcAllowance, routerAddress, usdcAddress]);

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
              Provide {tokenSymbol} and USDC to get LP tokens
            </p>
          </div>

          {/* Token Input */}
          <div className="py-4 border-b border-border">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-muted-foreground">You provide</span>
              <span className="text-lg font-semibold tabular-nums">
                {tokenAmount} {tokenSymbol}
              </span>
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-[11px] text-muted-foreground">{tokenSymbol}</span>
              <button
                onClick={() => setTokenAmount(tokenBalance.toFixed(2))}
                className="text-[11px] text-muted-foreground hover:text-zinc-300 transition-colors"
              >
                Balance: {tokenBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </button>
            </div>
          </div>

          {/* Required USDC */}
          <div className="py-4 border-b border-border">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-muted-foreground">Required USDC</span>
              <span className="text-lg font-semibold tabular-nums">
                {requiredUsdc.toFixed(2)} USDC
              </span>
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-[11px] text-muted-foreground">USDC</span>
              <button
                onClick={() => {
                  if (tokenPrice <= 0) return;
                  const maxTokenFromUsdc = usdcBalance / tokenPrice;
                  setTokenAmount(Math.min(tokenBalance, maxTokenFromUsdc).toFixed(2));
                }}
                className="text-[11px] text-muted-foreground hover:text-zinc-300 transition-colors"
              >
                Balance: {usdcBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </button>
            </div>
          </div>

          {/* LP Output */}
          {tokenInputAmount > 0 && (
            <div className="flex items-center justify-end gap-3 py-3 text-[11px] text-muted-foreground">
              <span className="tabular-nums">
                You receive ~ {lpTokensReceived.toFixed(2)} LP tokens
              </span>
            </div>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Action button */}
          <button
            onClick={handleAddLiquidity}
            disabled={!canCreate || isPending || isSuccess}
            className={`w-full h-11 rounded-xl font-semibold text-[14px] transition-all mb-4 flex items-center justify-center gap-2 ${
              isSuccess
                ? "bg-zinc-300 text-black"
                : isError
                ? "bg-zinc-600 text-white"
                : !canCreate || isPending
                ? "bg-zinc-700 text-zinc-500 cursor-not-allowed"
                : "bg-white text-black hover:bg-zinc-200"
            }`}
          >
            {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            {isSuccess && <CheckCircle className="w-4 h-4" />}
            {isPending
              ? "Adding Liquidity..."
              : isSuccess
              ? "Liquidity Added!"
              : isError
              ? "Failed"
              : !account
              ? "Connect wallet"
              : tokenInputAmount === 0
              ? "Enter amount"
              : !hasEnoughToken
              ? `Insufficient ${tokenSymbol}`
              : !hasEnoughUsdc
              ? "Insufficient USDC"
              : "Add Liquidity"}
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
