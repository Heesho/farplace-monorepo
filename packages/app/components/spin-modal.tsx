"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { NavBar } from "@/components/nav-bar";
import { Leaderboard } from "@/components/leaderboard";
import { SpinHistoryItem } from "@/components/spin-history-item";

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
  const [miningState, setMiningState] = useState<"idle" | "mining" | "revealing" | "complete">("idle");
  const [prizePool, setPrizePool] = useState(124532.45);
  const [minedAmount, setMinedAmount] = useState(0);
  const [displayedAmount, setDisplayedAmount] = useState(0);
  const [minedPayoutPercent, setMinedPayoutPercent] = useState(0);
  const [message, setMessage] = useState("");
  const tokenPrice = 0.01; // USD price per token
  const defaultMessage = "gm"; // Default message set by rig owner

  // Odds in basis points (e.g., 10 = 0.1%, 8000 = 80%)
  const odds = [10, 10, 10, 50, 50, 100, 500, 1000, 8000];
  const minPayoutBps = Math.min(...odds);
  const maxPayoutBps = Math.max(...odds);

  const maxMine = prizePool * maxPayoutBps / 10000;
  const minMine = prizePool * minPayoutBps / 10000;

  // Last mine result (shown when idle)
  const [lastMine, setLastMine] = useState({
    name: "DiamondHands",
    avatar: "https://api.dicebear.com/7.x/shapes/svg?seed=diamond",
    amount: 6227,
    payoutPercent: 5,
  });


  // Handle the spin/mine action
  const handleMine = () => {
    if (miningState !== "idle" || userBalance < currentPrice) return;

    setMiningState("mining");
    setDisplayedAmount(0);

    // Simulate mining delay
    setTimeout(() => {
      // Pick a random odds outcome
      const randomOdds = odds[Math.floor(Math.random() * odds.length)];
      const result = Math.floor(prizePool * randomOdds / 10000);
      setMinedAmount(result);
      setMinedPayoutPercent(randomOdds / 100);
      setMiningState("revealing");
    }, 1500);
  };

  // Tick-up animation for revealing mined amount
  useEffect(() => {
    if (miningState !== "revealing") return;

    const duration = 1000; // 1 second tick-up
    const steps = 30;
    const increment = minedAmount / steps;
    let current = 0;
    let step = 0;

    const interval = setInterval(() => {
      step++;
      current = Math.min(minedAmount, Math.floor(increment * step));
      setDisplayedAmount(current);

      if (step >= steps) {
        clearInterval(interval);
        setDisplayedAmount(minedAmount);
        setMiningState("complete");

        // After showing result, save as last mine and go back to idle
        setTimeout(() => {
          setLastMine({
            name: "heesho.eth",
            avatar: "https://api.dicebear.com/7.x/shapes/svg?seed=heesho",
            amount: minedAmount,
            payoutPercent: minedPayoutPercent,
          });
          setMiningState("idle");
        }, 2000);
      }
    }, duration / steps);

    return () => clearInterval(interval);
  }, [miningState, minedAmount, minedPayoutPercent]);

  const userStats = {
    mined: 45230,
    minedUsd: 452.30,
    spins: 47,
    spent: 564.68,
  };

  const rigUrl = typeof window !== "undefined" ? `${window.location.origin}/rig/${rigAddress}` : "";

  const mockLeaderboard = [
    { rank: 1, address: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef", mined: BigInt(892000n * 10n**18n), minedFormatted: "892K", spent: BigInt(0), spentFormatted: "0", earned: BigInt(0), earnedFormatted: "0", isCurrentUser: false, isFriend: false, profile: null },
    { rank: 2, address: "0x1234567890abcdef1234567890abcdef12345678", mined: BigInt(654000n * 10n**18n), minedFormatted: "654K", spent: BigInt(0), spentFormatted: "0", earned: BigInt(0), earnedFormatted: "0", isCurrentUser: false, isFriend: false, profile: null },
    { rank: 3, address: "0xabcdef1234567890abcdef1234567890abcdef12", mined: BigInt(421000n * 10n**18n), minedFormatted: "421K", spent: BigInt(0), spentFormatted: "0", earned: BigInt(0), earnedFormatted: "0", isCurrentUser: false, isFriend: false, profile: null },
    { rank: 4, address: "0x9876543210fedcba9876543210fedcba98765432", mined: BigInt(287000n * 10n**18n), minedFormatted: "287K", spent: BigInt(0), spentFormatted: "0", earned: BigInt(0), earnedFormatted: "0", isCurrentUser: false, isFriend: false, profile: null },
    { rank: 5, address: "0xcafebabecafebabecafebabecafebabecafebabe", mined: BigInt(156000n * 10n**18n), minedFormatted: "156K", spent: BigInt(0), spentFormatted: "0", earned: BigInt(0), earnedFormatted: "0", isCurrentUser: true, isFriend: false, profile: null },
  ];

  function timeAgo(timestamp: number): string {
    const seconds = Math.floor(Date.now() / 1000 - timestamp);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  const mockSpins = [
    { id: "1", spinner: "0x1234567890abcdef1234567890abcdef12345678", uri: "gm frens", price: BigInt(2_340_000), payoutPercent: 12, won: BigInt(14943n * 10n**18n), timestamp: Math.floor(Date.now() / 1000) - 120 },
    { id: "2", spinner: "0xabcdef1234567890abcdef1234567890abcdef12", uri: "to the moon", price: BigInt(1_800_000), payoutPercent: 1, won: BigInt(1203n * 10n**18n), timestamp: Math.floor(Date.now() / 1000) - 340 },
    { id: "3", spinner: "0x9876543210fedcba9876543210fedcba98765432", uri: "", price: BigInt(3_200_000), payoutPercent: 35, won: BigInt(41234n * 10n**18n), timestamp: Math.floor(Date.now() / 1000) - 890 },
    { id: "4", spinner: "0x1111222233334444555566667777888899990000", uri: "wagmi", price: BigInt(950_000), payoutPercent: 5, won: BigInt(5800n * 10n**18n), timestamp: Math.floor(Date.now() / 1000) - 1800 },
    { id: "5", spinner: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef", uri: "lfg", price: BigInt(4_100_000), payoutPercent: 15, won: BigInt(18200n * 10n**18n), timestamp: Math.floor(Date.now() / 1000) - 3600 },
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
    if (!isOpen || miningState !== "idle") return;

    const interval = setInterval(() => {
      setCurrentPrice(prev => Math.max(0.001, prev * 0.9995));
    }, 100);

    return () => clearInterval(interval);
  }, [isOpen, miningState]);

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
          <span className="text-base font-semibold">Mine</span>
          <div className="w-9" />
        </div>

        {/* Sticky Top Section */}
        <div className="px-4 pb-4">
          {/* Max Mine & Min Mine */}
          <div className="flex items-start justify-between mb-4">
            {/* Max Mine */}
            <div>
              <div className="text-[11px] text-muted-foreground mb-0.5">MAX MINE</div>
              <div className="flex items-center gap-1.5">
                <div className="w-5 h-5 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white text-[10px] font-semibold">
                  {tokenSymbol.charAt(0)}
                </div>
                <span className="text-lg font-bold tabular-nums">
                  {maxMine.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
              </div>
              <div className="text-[12px] text-muted-foreground tabular-nums">
                ${(maxMine * tokenPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>

            {/* Min Mine */}
            <div className="text-right">
              <div className="text-[11px] text-muted-foreground mb-0.5">MIN MINE</div>
              <div className="flex items-center justify-end gap-1.5">
                <span className="text-lg font-bold tabular-nums">
                  {minMine.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
                <div className="w-5 h-5 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white text-[10px] font-semibold">
                  {tokenSymbol.charAt(0)}
                </div>
              </div>
              <div className="text-[12px] text-muted-foreground tabular-nums">
                ${(minMine * tokenPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
          </div>

          {/* Mining Result Area */}
          <div className="py-4">
            {miningState === "mining" && (
              <div className="grid grid-cols-[1fr_60px_120px] items-center gap-2">
                <div className="flex items-center gap-2">
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarImage src="https://api.dicebear.com/7.x/shapes/svg?seed=heesho" alt="heesho.eth" />
                    <AvatarFallback className="bg-zinc-700 text-[10px]">HE</AvatarFallback>
                  </Avatar>
                  <div className="text-[14px] font-medium truncate">heesho.eth</div>
                </div>
                <div className="text-xl font-bold text-center text-transparent">
                  --%
                </div>
                <div className="text-right">
                  <div className="flex items-center justify-end gap-2 h-8">
                    <div className="w-6 h-6 border-2 border-zinc-700 border-t-white rounded-full animate-spin" />
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                      {tokenSymbol.charAt(0)}
                    </div>
                  </div>
                  <div className="text-[12px] text-muted-foreground h-4">
                    &nbsp;
                  </div>
                </div>
              </div>
            )}

            {miningState === "revealing" && (
              <div className="grid grid-cols-[1fr_60px_120px] items-center gap-2">
                <div className="flex items-center gap-2">
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarImage src="https://api.dicebear.com/7.x/shapes/svg?seed=heesho" alt="heesho.eth" />
                    <AvatarFallback className="bg-zinc-700 text-[10px]">HE</AvatarFallback>
                  </Avatar>
                  <div className="text-[14px] font-medium truncate">heesho.eth</div>
                </div>
                <div className="text-xl font-bold text-center text-transparent">
                  --%
                </div>
                <div className="text-right">
                  <div className="flex items-center justify-end gap-2 h-8">
                    <span className="text-2xl font-bold tabular-nums">
                      {displayedAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                      {tokenSymbol.charAt(0)}
                    </div>
                  </div>
                  <div className="text-[12px] text-muted-foreground tabular-nums h-4">
                    ${(displayedAmount * tokenPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
              </div>
            )}

            {miningState === "complete" && (
              <div className="grid grid-cols-[1fr_60px_120px] items-center gap-2">
                <div className="flex items-center gap-2">
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarImage src="https://api.dicebear.com/7.x/shapes/svg?seed=heesho" alt="heesho.eth" />
                    <AvatarFallback className="bg-zinc-700 text-[10px]">HE</AvatarFallback>
                  </Avatar>
                  <div className="text-[14px] font-medium truncate">heesho.eth</div>
                </div>
                <div className="text-xl font-bold text-center">
                  {minedPayoutPercent}%
                </div>
                <div className="text-right">
                  <div className="flex items-center justify-end gap-2 h-8">
                    <span className="text-2xl font-bold tabular-nums">
                      {displayedAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                      {tokenSymbol.charAt(0)}
                    </div>
                  </div>
                  <div className="text-[12px] text-muted-foreground tabular-nums h-4">
                    ${(displayedAmount * tokenPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
              </div>
            )}

            {miningState === "idle" && (
              <div className="grid grid-cols-[1fr_60px_120px] items-center gap-2">
                <div className="flex items-center gap-2">
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarImage src={lastMine.avatar} alt={lastMine.name} />
                    <AvatarFallback className="bg-zinc-700 text-[10px]">
                      {lastMine.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="text-[14px] font-medium truncate">{lastMine.name}</div>
                </div>
                <div className="text-xl font-bold text-center">
                  {lastMine.payoutPercent}%
                </div>
                <div className="text-right">
                  <div className="flex items-center justify-end gap-2 h-8">
                    <span className="text-2xl font-bold tabular-nums">
                      {lastMine.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                      {tokenSymbol.charAt(0)}
                    </div>
                  </div>
                  <div className="text-[12px] text-muted-foreground tabular-nums h-4">
                    ${(lastMine.amount * tokenPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-4">

          {/* Your Position */}
          <div className="mb-6">
            <div className="font-semibold text-[18px] mb-3">Your position</div>
            <div className="grid grid-cols-2 gap-y-4 gap-x-8">
              <div>
                <div className="text-muted-foreground text-[12px] mb-1">Mined</div>
                <div className="font-semibold text-[15px] tabular-nums flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-[10px] text-white font-semibold">
                    {tokenSymbol.charAt(0)}
                  </span>
                  {userStats.mined.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-1">Value</div>
                <div className="font-semibold text-[15px] tabular-nums">
                  ${userStats.minedUsd.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-1">Mines</div>
                <div className="font-semibold text-[15px] tabular-nums">
                  {userStats.spins}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-1">Spent</div>
                <div className="font-semibold text-[15px] tabular-nums">
                  ${userStats.spent.toFixed(2)}
                </div>
              </div>
            </div>
          </div>

          {/* Recent Mines */}
          <div className="mb-6">
            <div className="font-semibold text-[18px] mb-3">Recent Mines</div>
            <div>
              {mockSpins.map((spin) => (
                <SpinHistoryItem
                  key={spin.id}
                  spin={spin}
                  timeAgo={timeAgo}
                  tokenSymbol={tokenSymbol}
                />
              ))}
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
        </div>

        {/* Bottom Action Bar */}
        <div
          className="fixed bottom-0 left-0 right-0 z-50 bg-zinc-800 flex justify-center"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 60px)" }}
        >
          <div className="w-full max-w-[520px] px-4 pt-3 pb-3 bg-background">
            {/* Message Input */}
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={defaultMessage}
              maxLength={100}
              className="w-full bg-zinc-800 rounded-xl px-4 py-3 text-[15px] outline-none placeholder:text-zinc-500 mb-3"
            />
            {/* Price, Balance, Mine Button */}
            <div className="flex items-center justify-between">
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
                onClick={handleMine}
                disabled={miningState !== "idle" || userBalance < currentPrice}
                className={`
                  w-32 h-10 text-[14px] font-semibold rounded-xl transition-all
                  ${miningState !== "idle"
                    ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
                    : userBalance >= currentPrice
                      ? "bg-white text-black hover:bg-zinc-200"
                      : "bg-zinc-700 text-zinc-500 cursor-not-allowed"
                  }
                `}
              >
                {miningState !== "idle" ? "Mining..." : "Mine"}
              </button>
            </div>
          </div>
        </div>
      </div>
      <NavBar />
    </div>
  );
}
