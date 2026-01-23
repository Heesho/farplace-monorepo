"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { NavBar } from "@/components/nav-bar";
import { Leaderboard } from "@/components/leaderboard";

type SpinModalProps = {
  isOpen: boolean;
  onClose: () => void;
  tokenSymbol?: string;
  tokenName?: string;
  userBalance?: number;
};

export function SpinModal({
  isOpen,
  onClose,
  tokenSymbol = "TOKEN",
  tokenName = "Token",
  userBalance = 0,
}: SpinModalProps) {
  const params = useParams();
  const rigAddress = (params?.address as string) || "";

  // Mock data - will be replaced with real data
  const [currentPrice, setCurrentPrice] = useState(0.0234);
  const [isSpinning, setIsSpinning] = useState(false);
  const [prizePool, setPrizePool] = useState(124532.45);
  const [lastWinner, setLastWinner] = useState({
    address: "0x1234567890abcdef1234567890abcdef12345678",
    name: "DiamondHands",
    avatar: "https://api.dicebear.com/7.x/shapes/svg?seed=winner",
    payoutPercent: 12,
    won: 14943,
  });

  const odds = [
    { chance: 50, payout: 1 },
    { chance: 25, payout: 5 },
    { chance: 15, payout: 15 },
    { chance: 8, payout: 35 },
    { chance: 2, payout: 100 },
  ];

  const userStats = {
    spent: 564.68,
    won: 45230,
    wonUsd: 123.45,
    spins: 47,
    net: -441.23,
  };

  const rigUrl = typeof window !== "undefined" ? `${window.location.origin}/rig/${rigAddress}` : "";

  const mockLeaderboard = [
    { rank: 1, address: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef", mined: BigInt(892000n * 10n**18n), minedFormatted: "892K", spent: BigInt(0), spentFormatted: "0", earned: BigInt(0), earnedFormatted: "0", isCurrentUser: false, isFriend: false, profile: null },
    { rank: 2, address: "0x1234567890abcdef1234567890abcdef12345678", mined: BigInt(654000n * 10n**18n), minedFormatted: "654K", spent: BigInt(0), spentFormatted: "0", earned: BigInt(0), earnedFormatted: "0", isCurrentUser: false, isFriend: false, profile: null },
    { rank: 3, address: "0xabcdef1234567890abcdef1234567890abcdef12", mined: BigInt(421000n * 10n**18n), minedFormatted: "421K", spent: BigInt(0), spentFormatted: "0", earned: BigInt(0), earnedFormatted: "0", isCurrentUser: false, isFriend: false, profile: null },
    { rank: 4, address: "0x9876543210fedcba9876543210fedcba98765432", mined: BigInt(287000n * 10n**18n), minedFormatted: "287K", spent: BigInt(0), spentFormatted: "0", earned: BigInt(0), earnedFormatted: "0", isCurrentUser: false, isFriend: false, profile: null },
    { rank: 5, address: "0xcafebabecafebabecafebabecafebabecafebabe", mined: BigInt(156000n * 10n**18n), minedFormatted: "156K", spent: BigInt(0), spentFormatted: "0", earned: BigInt(0), earnedFormatted: "0", isCurrentUser: true, isFriend: false, profile: null },
  ];

  // Prize pool ticking effect
  useEffect(() => {
    if (!isOpen) return;

    const interval = setInterval(() => {
      setPrizePool(prev => prev + 0.1); // Simulate emissions
    }, 100);

    return () => clearInterval(interval);
  }, [isOpen]);

  // Price decay effect
  useEffect(() => {
    if (!isOpen || isSpinning) return;

    const interval = setInterval(() => {
      setCurrentPrice(prev => Math.max(0.001, prev * 0.9995));
    }, 100);

    return () => clearInterval(interval);
  }, [isOpen, isSpinning]);

  if (!isOpen) return null;

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
          <span className="text-base font-semibold">Spin</span>
          <div className="w-9" />
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-4">
          {/* Prize Pool Hero */}
          <div className="text-center py-4">
            <div className="text-sm text-zinc-500 mb-1">PRIZE POOL</div>
            <div className="flex items-center justify-center gap-2 mb-1">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white text-sm font-semibold">
                {tokenSymbol.charAt(0)}
              </div>
              <span className="text-3xl font-bold tabular-nums">
                {prizePool.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <div className="text-sm text-zinc-500">
              ${(prizePool * 0.01).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>

          {/* Spinner Area */}
          <div className="bg-zinc-900 rounded-xl p-4 mb-4">
            {isSpinning ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin w-12 h-12 border-4 border-zinc-700 border-t-white rounded-full" />
              </div>
            ) : (
              <div className="flex items-center gap-3 py-2">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={lastWinner.avatar} alt={lastWinner.name} />
                  <AvatarFallback className="bg-zinc-700 text-sm">
                    {lastWinner.address.slice(2, 4).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{lastWinner.name}</div>
                  <div className="text-xs text-zinc-400">
                    Won {lastWinner.payoutPercent}% → {lastWinner.won.toLocaleString()} {tokenSymbol}
                  </div>
                </div>
                <div className="text-xs text-zinc-500">Last spin</div>
              </div>
            )}
          </div>

          {/* Current Price */}
          <div className="text-center mb-6">
            <span className="text-sm text-zinc-500">Current price: </span>
            <span className="text-sm font-medium">${currentPrice.toFixed(4)}</span>
          </div>

          {/* Odds Breakdown */}
          <div className="mb-6">
            <div className="font-semibold text-[18px] mb-3">Odds</div>
            <div className="bg-zinc-900 rounded-xl overflow-hidden">
              {/* Header */}
              <div className="grid grid-cols-3 px-4 py-2 text-xs text-zinc-500 border-b border-zinc-800">
                <div>Chance</div>
                <div>Payout</div>
                <div className="text-right">Win</div>
              </div>
              {/* Rows */}
              {odds.map((odd, i) => {
                const winAmount = (prizePool * odd.payout) / 100;
                const isJackpot = odd.payout === 100;
                return (
                  <div
                    key={i}
                    className={`grid grid-cols-3 px-4 py-3 text-sm ${
                      isJackpot ? "bg-zinc-800/50" : ""
                    } ${i < odds.length - 1 ? "border-b border-zinc-800/50" : ""}`}
                  >
                    <div className="font-medium">{odd.chance}%</div>
                    <div className="text-zinc-400">{odd.payout}%</div>
                    <div className="text-right font-medium tabular-nums flex items-center justify-end gap-1">
                      <span className="w-4 h-4 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-[8px] text-white font-bold">
                        {tokenSymbol.charAt(0)}
                      </span>
                      {winAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Your Position */}
          <div className="mb-6">
            <div className="font-semibold text-[18px] mb-3">Your position</div>
            <div className="grid grid-cols-2 gap-y-4 gap-x-8">
              <div>
                <div className="text-muted-foreground text-[12px] mb-1">Spent</div>
                <div className="font-semibold text-[15px] tabular-nums">
                  ${userStats.spent.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-1">Won</div>
                <div className="font-semibold text-[15px] tabular-nums flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-[10px] text-white font-semibold">
                    {tokenSymbol.charAt(0)}
                  </span>
                  {userStats.won.toLocaleString()}
                </div>
                <div className="text-[12px] text-zinc-500">${userStats.wonUsd.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-1">Spins</div>
                <div className="font-semibold text-[15px] tabular-nums">
                  {userStats.spins}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-1">Net</div>
                <div className={`font-semibold text-[15px] tabular-nums ${
                  userStats.net >= 0 ? "text-white" : "text-zinc-400"
                }`}>
                  {userStats.net >= 0 ? "+" : ""}${userStats.net.toFixed(2)}
                </div>
              </div>
            </div>
          </div>

          {/* Leaderboard */}
          <Leaderboard
            entries={mockLeaderboard}
            userRank={5}
            tokenSymbol={tokenSymbol}
            tokenName={tokenName}
            rigUrl={rigUrl}
            isLoading={false}
          />

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
                <div className="text-muted-foreground text-[12px]">Price</div>
                <div className="font-semibold text-[17px] tabular-nums">
                  ${currentPrice.toFixed(4)}
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
              disabled={isSpinning || userBalance < currentPrice}
              className={`
                w-32 h-10 text-[14px] font-semibold rounded-xl transition-all
                ${isSpinning
                  ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
                  : userBalance >= currentPrice
                    ? "bg-white text-black hover:bg-zinc-200"
                    : "bg-zinc-700 text-zinc-500 cursor-not-allowed"
                }
              `}
            >
              {isSpinning ? "Spinning..." : "Spin"}
            </button>
          </div>
        </div>
      </div>
      <NavBar />
    </div>
  );
}
