"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { X } from "lucide-react";
import { NavBar } from "@/components/nav-bar";

type FundModalProps = {
  isOpen: boolean;
  onClose: () => void;
  tokenSymbol?: string;
  tokenName?: string;
  userBalance?: number;
};

export function FundModal({
  isOpen,
  onClose,
  tokenSymbol = "TOKEN",
  tokenName = "Token",
  userBalance = 0,
}: FundModalProps) {
  const params = useParams();
  const rigAddress = (params?.address as string) || "";

  // Mock data - will be replaced with real data
  const [donationAmount, setDonationAmount] = useState("");
  const [isDonating, setIsDonating] = useState(false);

  if (!isOpen) return null;

  const parsedAmount = parseFloat(donationAmount) || 0;

  return (
    <div className="fixed inset-0 z-[100] flex h-screen w-screen justify-center bg-zinc-800">
      <div
        className="relative flex h-full w-full max-w-[520px] flex-col bg-background"
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 8px)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 130px)",
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
          <span className="text-base font-semibold">Fund</span>
          <div className="w-9" />
        </div>

        {/* Scrollable Content - placeholder */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-4 pt-4">
          <div className="text-center text-zinc-500">
            Content coming in next tasks...
          </div>
        </div>

        {/* Bottom Action Bar */}
        <div
          className="fixed bottom-0 left-0 right-0 z-50 bg-background flex justify-center"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 60px)" }}
        >
          <div className="flex items-center justify-between w-full max-w-[520px] px-4 py-3">
            <div className="flex items-center gap-6">
              <div>
                <div className="text-muted-foreground text-[12px]">Balance</div>
                <div className="font-semibold text-[17px] tabular-nums">
                  ${userBalance.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px]">Amount</div>
                <div className="font-semibold text-[17px] tabular-nums">
                  ${parsedAmount.toFixed(2)}
                </div>
              </div>
            </div>
            <button
              disabled={isDonating || parsedAmount <= 0 || parsedAmount > userBalance}
              className={`
                w-32 h-10 text-[14px] font-semibold rounded-xl transition-all
                ${isDonating
                  ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
                  : parsedAmount > 0 && parsedAmount <= userBalance
                    ? "bg-white text-black hover:bg-zinc-200"
                    : "bg-zinc-700 text-zinc-500 cursor-not-allowed"
                }
              `}
            >
              {isDonating ? "Donating..." : "Fund"}
            </button>
          </div>
        </div>
      </div>
      <NavBar />
    </div>
  );
}
