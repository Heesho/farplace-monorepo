"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
  const [isClaiming, setIsClaiming] = useState(false);

  const pendingClaims = {
    totalTokens: 12456.78,
    totalUsd: 124.56,
    unclaimedDays: 3,
  };

  // Mock user stats
  const userStats = {
    totalDonated: 2456.78,
    todayDonation: 50.00,
    pendingTokens: 12456,
    pendingUsd: 124.56,
    claimedTokens: 45230,
    claimedUsd: 452.30,
  };

  // Mock recipient data
  const recipient = {
    address: "0xcharity1234567890abcdef1234567890abcdef",
    name: "Ocean Cleanup Foundation",
    avatar: "https://api.dicebear.com/7.x/shapes/svg?seed=ocean",
    handle: "@oceancleanup",
  };

  // Mock today's pool data
  const [todayDonated, setTodayDonated] = useState(1234.56);
  const [todayEmission, setTodayEmission] = useState(50000);
  const [dayEndsIn, setDayEndsIn] = useState(4 * 3600 + 32 * 60); // seconds

  // Calculate current price per token
  const currentPricePerToken = todayDonated > 0 ? todayDonated / todayEmission : 0;

  // Countdown timer effect
  useEffect(() => {
    if (!isOpen) return;

    const interval = setInterval(() => {
      setDayEndsIn(prev => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(interval);
  }, [isOpen]);

  // Format countdown
  function formatCountdown(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  if (!isOpen) return null;

  const parsedAmount = parseFloat(donationAmount) || 0;

  // Calculate estimated tokens for current input
  const estimatedTokens = parsedAmount > 0 && todayEmission > 0
    ? (parsedAmount / (todayDonated + parsedAmount)) * todayEmission
    : 0;

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

        {/* Scrollable Content */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-4">
          {/* Hero: Current Recipient */}
          <div className="text-center py-4">
            <div className="text-sm text-zinc-500 mb-2">CURRENT RECIPIENT</div>
            <div className="flex items-center justify-center gap-3 mb-1">
              <Avatar className="h-12 w-12">
                <AvatarImage src={recipient.avatar} alt={recipient.name} />
                <AvatarFallback className="bg-zinc-700 text-sm">
                  {recipient.name.charAt(0)}
                </AvatarFallback>
              </Avatar>
              <div className="text-left">
                <div className="text-lg font-semibold">{recipient.name}</div>
                <div className="text-sm text-zinc-500">{recipient.handle}</div>
              </div>
            </div>
          </div>

          {/* Hero: Today's Pool */}
          <div className="bg-zinc-900 rounded-xl p-4 mb-4">
            <div className="text-sm text-zinc-500 mb-3">Today's Pool</div>
            <div className="grid grid-cols-2 gap-4 mb-3">
              <div>
                <div className="text-xs text-zinc-500 mb-1">Donated</div>
                <div className="text-xl font-bold tabular-nums">
                  ${todayDonated.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div>
                <div className="text-xs text-zinc-500 mb-1">Emission</div>
                <div className="text-xl font-bold tabular-nums flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-[10px] text-white font-semibold">
                    {tokenSymbol.charAt(0)}
                  </span>
                  {todayEmission.toLocaleString()}
                </div>
              </div>
            </div>
            <div className="text-sm text-zinc-400 mb-2">
              Current price: {currentPricePerToken > 0 ? `$${currentPricePerToken.toFixed(6)}/token` : "Be first!"}
            </div>
            <div className="text-sm text-zinc-500">
              Day ends in <span className="text-white font-medium">{formatCountdown(dayEndsIn)}</span>
            </div>
          </div>

          {/* Donate Section */}
          <div className="mb-6">
            <div className="font-semibold text-[18px] mb-3">Donate</div>
            <div className="bg-zinc-900 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xl text-zinc-400">$</span>
                <input
                  type="number"
                  value={donationAmount}
                  onChange={(e) => setDonationAmount(e.target.value)}
                  placeholder="0.00"
                  className="flex-1 bg-transparent text-2xl font-semibold outline-none placeholder:text-zinc-600 tabular-nums"
                />
              </div>
              <div className="text-sm text-zinc-500 mb-2">
                Balance: ${userBalance.toFixed(2)}
              </div>
              {parsedAmount > 0 && (
                <div className="text-sm text-zinc-400">
                  You'll receive ~{estimatedTokens.toLocaleString(undefined, { maximumFractionDigits: 0 })} {tokenSymbol}
                  <span className="text-zinc-600 ml-1">(based on current pool)</span>
                </div>
              )}
            </div>
          </div>

          {/* Pending Claims */}
          {pendingClaims.unclaimedDays > 0 && (
            <div className="mb-6">
              <div className="font-semibold text-[18px] mb-3">Pending Claims</div>
              <div className="bg-zinc-900 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xl font-bold tabular-nums flex items-center gap-1.5">
                      <span className="w-5 h-5 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-[10px] text-white font-semibold">
                        {tokenSymbol.charAt(0)}
                      </span>
                      {pendingClaims.totalTokens.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div className="text-sm text-zinc-500">${pendingClaims.totalUsd.toFixed(2)}</div>
                    <div className="text-xs text-zinc-600 mt-1">From {pendingClaims.unclaimedDays} days</div>
                  </div>
                  <button
                    onClick={() => setIsClaiming(true)}
                    disabled={isClaiming}
                    className={`
                      px-6 py-2.5 text-[14px] font-semibold rounded-xl transition-all
                      ${isClaiming
                        ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
                        : "bg-white text-black hover:bg-zinc-200"
                      }
                    `}
                  >
                    {isClaiming ? "Claiming..." : "Claim All"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Your Position */}
          <div className="mb-6">
            <div className="font-semibold text-[18px] mb-3">Your Position</div>
            <div className="bg-zinc-900 rounded-xl p-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-zinc-500 mb-1">Total Donated</div>
                  <div className="text-lg font-bold tabular-nums">
                    ${userStats.totalDonated.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 mb-1">Today</div>
                  <div className="text-lg font-bold tabular-nums">
                    ${userStats.todayDonation.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 mb-1">Pending</div>
                  <div className="text-lg font-bold tabular-nums flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-[8px] text-white font-semibold">
                      {tokenSymbol.charAt(0)}
                    </span>
                    {userStats.pendingTokens.toLocaleString()}
                  </div>
                  <div className="text-xs text-zinc-500">${userStats.pendingUsd.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 mb-1">Claimed</div>
                  <div className="text-lg font-bold tabular-nums flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-[8px] text-white font-semibold">
                      {tokenSymbol.charAt(0)}
                    </span>
                    {userStats.claimedTokens.toLocaleString()}
                  </div>
                  <div className="text-xs text-zinc-500">${userStats.claimedUsd.toFixed(2)}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Placeholder for remaining sections */}
          <div className="text-center text-zinc-600 py-4">
            More sections coming...
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
