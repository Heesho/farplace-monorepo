"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { X } from "lucide-react";
import { NavBar } from "@/components/nav-bar";
import { Leaderboard } from "@/components/leaderboard";
import { LeaderboardEntry } from "@/hooks/useRigLeaderboard";
import { DonationHistoryItem } from "@/components/donation-history-item";

// Preset funding amounts
const PRESET_AMOUNTS = [5, 10, 25, 50];

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
  userBalance = 45.73,
}: FundModalProps) {
  const params = useParams();
  const rigAddress = (params?.address as string) || "";

  // Mock data - will be replaced with real data
  // Pre-select $5 by default so rate always shows
  const [fundAmount, setFundAmount] = useState("5");
  const [selectedPreset, setSelectedPreset] = useState<number | null>(5);
  const [isCustom, setIsCustom] = useState(false);
  const [message, setMessage] = useState("");
  const [isFunding, setIsFunding] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const defaultMessage = "for the cause"; // Default message set by rig owner

  // Handle preset selection
  const handlePresetSelect = (amount: number) => {
    setSelectedPreset(amount);
    setFundAmount(amount.toString());
    setIsCustom(false);
  };

  // Handle custom selection
  const handleCustomSelect = () => {
    setSelectedPreset(null);
    setIsCustom(true);
    setFundAmount("");
  };

  // Handle custom input change
  const handleCustomChange = (value: string) => {
    setFundAmount(value);
    setSelectedPreset(null);
  };

  const pendingClaims = {
    totalTokens: 12456.78,
    totalUsd: 124.56,
    unclaimedDays: 3,
  };

  // Mock user stats
  const userStats = {
    totalFunded: 2456.78,
    todayFunding: 50.00,
    pendingTokens: 12456,
    pendingUsd: 124.56,
    claimedTokens: 45230,
    claimedUsd: 452.30,
  };

  // Mock leaderboard data
  const leaderboardEntries: LeaderboardEntry[] = [
    { rank: 1, address: "0x1234567890abcdef1234567890abcdef12345678", mined: BigInt(892000e18), minedFormatted: "892K", spent: BigInt(0), spentFormatted: "0", earned: BigInt(892000e18), earnedFormatted: "892K", isCurrentUser: false, isFriend: false },
    { rank: 2, address: "0xabcdef1234567890abcdef1234567890abcdef12", mined: BigInt(654000e18), minedFormatted: "654K", spent: BigInt(0), spentFormatted: "0", earned: BigInt(654000e18), earnedFormatted: "654K", isCurrentUser: false, isFriend: true },
    { rank: 3, address: "0x9876543210fedcba9876543210fedcba98765432", mined: BigInt(421000e18), minedFormatted: "421K", spent: BigInt(0), spentFormatted: "0", earned: BigInt(421000e18), earnedFormatted: "421K", isCurrentUser: false, isFriend: false },
    { rank: 4, address: "0xfedcba9876543210fedcba9876543210fedcba98", mined: BigInt(312000e18), minedFormatted: "312K", spent: BigInt(0), spentFormatted: "0", earned: BigInt(312000e18), earnedFormatted: "312K", isCurrentUser: true, isFriend: false },
    { rank: 5, address: "0x5678901234abcdef5678901234abcdef56789012", mined: BigInt(198000e18), minedFormatted: "198K", spent: BigInt(0), spentFormatted: "0", earned: BigInt(198000e18), earnedFormatted: "198K", isCurrentUser: false, isFriend: false },
  ];
  const userRank = 4;

  // Mock recent donations
  const now = Math.floor(Date.now() / 1000);
  const recentDonations = [
    { id: "1", donor: "0x1234567890abcdef1234567890abcdef12345678", uri: "for the oceans", amount: BigInt(50e6), estimatedTokens: BigInt(2500e18), timestamp: now - 120 },
    { id: "2", donor: "0xabcdef1234567890abcdef1234567890abcdef12", uri: "every bit helps", amount: BigInt(25e6), estimatedTokens: BigInt(1250e18), timestamp: now - 300 },
    { id: "3", donor: "0x9876543210fedcba9876543210fedcba98765432", uri: "", amount: BigInt(100e6), estimatedTokens: BigInt(4800e18), timestamp: now - 600 },
    { id: "4", donor: "0xfedcba9876543210fedcba9876543210fedcba98", uri: "love this project", amount: BigInt(10e6), estimatedTokens: BigInt(500e18), timestamp: now - 1800 },
    { id: "5", donor: "0x5678901234abcdef5678901234abcdef56789012", uri: "wagmi", amount: BigInt(75e6), estimatedTokens: BigInt(3600e18), timestamp: now - 3600 },
  ];

  // Time ago helper
  function timeAgo(timestamp: number): string {
    const seconds = now - timestamp;
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  // Mock recipient data - from rig URI, not Farcaster
  const recipient = {
    address: "0xcharity1234567890abcdef1234567890abcdef",
    name: "Ocean Cleanup Foundation",
  };

  // Mock today's pool data
  const [todayFunded, setTodayFunded] = useState(1234.56);
  const [todayEmission, setTodayEmission] = useState(50000);
  const [dayEndsIn, setDayEndsIn] = useState(4 * 3600 + 32 * 60); // seconds

  // Calculate current price per token
  const currentPricePerToken = todayFunded > 0 ? todayFunded / todayEmission : 0;

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

  const parsedAmount = parseFloat(fundAmount) || 0;

  // Calculate estimated tokens for current input
  const estimatedTokens = parsedAmount > 0 && todayEmission > 0
    ? (parsedAmount / (todayFunded + parsedAmount)) * todayEmission
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
          <span className="text-base font-semibold">Mine</span>
          <div className="w-9" />
        </div>

        {/* Sticky Top Section - Compact */}
        <div className="px-4 pb-3 bg-background">
          {/* Recipient - single line */}
          <div className="flex items-center justify-between py-2">
            <div className="text-[15px] font-semibold">{recipient.name}</div>
            <a
              href={`https://basescan.org/address/${recipient.address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-muted-foreground font-mono hover:text-white transition-colors underline underline-offset-2"
            >
              {recipient.address.slice(0, 6)}...{recipient.address.slice(-4)}
            </a>
          </div>

          {/* Pool Stats - compact 2x2 grid */}
          <div className="grid grid-cols-4 gap-2 py-2 mb-2">
            <div>
              <div className="text-muted-foreground text-[10px]">Pool</div>
              <div className="font-semibold text-[13px] tabular-nums">
                ${todayFunded.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-[10px]">Emission</div>
              <div className="font-semibold text-[13px] tabular-nums flex items-center gap-1">
                <span className="w-4 h-4 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-[8px] text-white font-semibold">
                  {tokenSymbol.charAt(0)}
                </span>
                {(todayEmission / 1000).toFixed(0)}K
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-[10px]">Price</div>
              <div className="font-semibold text-[13px] tabular-nums">
                ${currentPricePerToken.toFixed(4)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-[10px]">Ends in</div>
              <div className="font-semibold text-[13px] tabular-nums">
                {formatCountdown(dayEndsIn)}
              </div>
            </div>
          </div>

          {/* Fund Preset Amounts - no header */}
          <div className="mb-1">
            {!isCustom ? (
              <div className="flex gap-1.5">
                {PRESET_AMOUNTS.map((amount) => (
                  <button
                    key={amount}
                    onClick={() => handlePresetSelect(amount)}
                    className={`
                      flex-1 py-2 rounded-lg text-[13px] font-semibold transition-all
                      ${selectedPreset === amount
                        ? "bg-white text-black"
                        : "bg-zinc-800 text-white hover:bg-zinc-700"
                      }
                    `}
                  >
                    ${amount}
                  </button>
                ))}
                <button
                  onClick={handleCustomSelect}
                  className="flex-1 py-2 rounded-lg text-[13px] font-semibold transition-all bg-zinc-800 text-white hover:bg-zinc-700"
                >
                  Other
                </button>
              </div>
            ) : (
              <div className="flex gap-1.5 items-center">
                <button
                  onClick={() => {
                    setIsCustom(false);
                    setFundAmount("5");
                    setSelectedPreset(5);
                  }}
                  className="px-3 py-2 rounded-lg text-[13px] font-semibold bg-zinc-800 text-white hover:bg-zinc-700 transition-all"
                >
                  ✕
                </button>
                <div className="flex-1 flex items-center gap-2 bg-zinc-800 rounded-lg px-3 py-1.5">
                  <span className="text-base text-muted-foreground">$</span>
                  <input
                    type="number"
                    value={fundAmount}
                    onChange={(e) => handleCustomChange(e.target.value)}
                    placeholder="0.00"
                    autoFocus
                    className="flex-1 bg-transparent text-base font-semibold outline-none placeholder:text-zinc-600 tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
              </div>
            )}
            {/* Estimate - always show */}
            <div className="text-[12px] text-muted-foreground mt-1.5 text-center">
              ≈ {estimatedTokens.toLocaleString(undefined, { maximumFractionDigits: 0 })} {tokenSymbol}
              <span className="text-zinc-600 ml-1">@ current rate</span>
            </div>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-4">

          {/* Your Position */}
          <div className="mb-6">
            <div className="font-semibold text-[18px] mb-3">Your position</div>

            {/* Pending Claims */}
            {pendingClaims.unclaimedDays > 0 && (
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-muted-foreground text-[12px] mb-1">Pending</div>
                  <div className="font-semibold text-[15px] tabular-nums flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-[10px] text-white font-semibold">
                      {tokenSymbol.charAt(0)}
                    </span>
                    {(pendingClaims.totalTokens / 1000).toFixed(1)}K
                    <span className="text-[12px] text-muted-foreground font-normal">
                      ${pendingClaims.totalUsd.toFixed(2)} · {pendingClaims.unclaimedDays}d
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setIsClaiming(true)}
                  disabled={isClaiming}
                  className={`
                    px-5 py-2 text-[13px] font-semibold rounded-xl transition-all
                    ${isClaiming
                      ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
                      : "bg-white text-black hover:bg-zinc-200"
                    }
                  `}
                >
                  {isClaiming ? "Claiming..." : "Claim"}
                </button>
              </div>
            )}

            {/* Today + Est. */}
            <div className="grid grid-cols-2 gap-y-4 gap-x-8 mb-4">
              <div>
                <div className="text-muted-foreground text-[12px] mb-1">Today</div>
                <div className="font-semibold text-[15px] tabular-nums">
                  ${userStats.todayFunding.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-1">Est.</div>
                <div className="font-semibold text-[15px] tabular-nums flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-[10px] text-white font-semibold">
                    {tokenSymbol.charAt(0)}
                  </span>
                  ~{((userStats.todayFunding / (todayFunded + 0.01)) * todayEmission / 1000).toFixed(1)}K
                </div>
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-y-4 gap-x-8">
              <div>
                <div className="text-muted-foreground text-[12px] mb-1">Mined</div>
                <div className="font-semibold text-[15px] tabular-nums flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-[10px] text-white font-semibold">
                    {tokenSymbol.charAt(0)}
                  </span>
                  {((userStats.pendingTokens + userStats.claimedTokens) / 1000).toFixed(1)}K
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-1">Value</div>
                <div className="font-semibold text-[15px] tabular-nums">
                  ${(userStats.pendingUsd + userStats.claimedUsd).toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-1">Claimed</div>
                <div className="font-semibold text-[15px] tabular-nums flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-[10px] text-white font-semibold">
                    {tokenSymbol.charAt(0)}
                  </span>
                  {(userStats.claimedTokens / 1000).toFixed(1)}K
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-1">Funded</div>
                <div className="font-semibold text-[15px] tabular-nums">
                  ${userStats.totalFunded.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            </div>
          </div>

          {/* Recent Mines */}
          <div className="mt-6">
            <h2 className="text-[18px] font-semibold mb-3">Recent Mines</h2>
            <div>
              {recentDonations.map((donation) => (
                <DonationHistoryItem
                  key={donation.id}
                  donation={donation}
                  timeAgo={timeAgo}
                  tokenSymbol={tokenSymbol}
                />
              ))}
            </div>
          </div>

          {/* Leaderboard */}
          <Leaderboard
            entries={leaderboardEntries}
            userRank={userRank}
            tokenSymbol={tokenSymbol}
            tokenName={tokenName}
            rigUrl={`https://mineport.xyz/rig/${rigAddress}`}
          />
        </div>

        {/* Bottom Action Bar */}
        <div
          className="fixed bottom-0 left-0 right-0 z-50 bg-background flex justify-center"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 60px)" }}
        >
          <div className="w-full max-w-[520px] px-4 pt-3 pb-3">
            {/* Message Input */}
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={defaultMessage}
              maxLength={100}
              className="w-full bg-zinc-800 rounded-xl px-4 py-3 text-[15px] outline-none placeholder:text-zinc-500 mb-3"
            />
            {/* Amount, Balance, Mine Button */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6">
                <div>
                  <div className="text-muted-foreground text-[12px]">Amount</div>
                  <div className="font-semibold text-[17px] tabular-nums">
                    ${parsedAmount.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[12px]">Balance</div>
                  <div className="font-semibold text-[17px] tabular-nums">
                    ${userBalance.toFixed(2)}
                  </div>
                </div>
              </div>
              <button
                disabled={isFunding || parsedAmount <= 0 || parsedAmount > userBalance}
                className={`
                  w-32 h-10 text-[14px] font-semibold rounded-xl transition-all
                  ${isFunding
                    ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
                    : parsedAmount > 0 && parsedAmount <= userBalance
                      ? "bg-white text-black hover:bg-zinc-200"
                      : "bg-zinc-700 text-zinc-500 cursor-not-allowed"
                  }
                `}
              >
                {isFunding ? "Mining..." : "Mine"}
              </button>
            </div>
          </div>
        </div>
      </div>
      <NavBar />
    </div>
  );
}
