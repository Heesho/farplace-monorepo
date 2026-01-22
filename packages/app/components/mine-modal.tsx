"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { X, User } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { NavBar } from "@/components/nav-bar";
import { Leaderboard } from "@/components/leaderboard";
import { MineHistoryItem } from "@/components/mine-history-item";

type Slot = {
  index: number;
  miner: string;
  minerName?: string;
  minerAvatar?: string;
  price: number;
  startPrice?: number;
  lastMineTime?: number;
  multiplier: number;
  multiplierEndsAt?: number;
  mined: number;
  pnl?: number;
  total?: number;
  mineRate?: number;
  uri?: string;
  isOwned?: boolean;
};

// Generate mock slots for any count
function generateMockSlots(count: number): Slot[] {
  const names = ["King Glazer", "DiamondHands", "CryptoWhale", "SatoshiFan", "DonutLover", "BlockBuilder", "HashMaster", "TokenTitan", "ChainChamp", "MoonBoy", "GigaChad", "NightOwl", "DayTrader", "HODLer", "DegenKing", "AlphaHunter", "YieldFarmer", "GasGuzzler", "WhaleTales", "Rugpuller", "BasedDev", "AnonMiner", "TokenMaxi", "ChartWizard", "BagHolder"];
  const uris = ["Never Stop Glazing", "WAGMI", "To the moon!", "", "gm frens", "Building the future", "", "LFG!", "Stay humble, stack sats", "ngmi", "probably nothing", "this is the way", "wen lambo", "", "gn", ""];

  // Mark slots 2 and 7 as owned by the user for demo
  const ownedSlots = new Set([2, 7]);

  return Array.from({ length: count }, (_, i) => ({
    index: i + 1,
    miner: `0x${(i + 1).toString(16).padStart(4, "0")}...${(i + 1000).toString(16).padStart(4, "0")}`,
    minerName: names[i % names.length],
    minerAvatar: `https://api.dicebear.com/7.x/shapes/svg?seed=${i + 1000}`,
    price: 0.05 + Math.random() * 0.1,
    multiplier: Math.floor(Math.random() * 10) + 1,
    multiplierEndsAt: Date.now() + Math.floor(Math.random() * 60) * 60 * 1000,
    mined: Math.floor(Math.random() * 8000) + 1000,
    pnl: (Math.random() - 0.4) * 0.05,
    total: Math.random() * 100 + 10,
    mineRate: Math.floor(Math.random() * 3) + 1,
    uri: uris[i % uris.length],
    isOwned: ownedSlots.has(i + 1),
  }));
}

// Default 9 slots
const MOCK_SLOTS: Slot[] = generateMockSlots(9);

// Mock leaderboard (top 10 miners)
const MOCK_LEADERBOARD = [
  { rank: 1, address: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef", mined: BigInt(182500n * 10n**18n), minedFormatted: "182,500", spent: BigInt(0), spentFormatted: "0", earned: BigInt(0), earnedFormatted: "0", isCurrentUser: false, isFriend: false, profile: null },
  { rank: 2, address: "0x1234567890abcdef1234567890abcdef12345678", mined: BigInt(156200n * 10n**18n), minedFormatted: "156,200", spent: BigInt(0), spentFormatted: "0", earned: BigInt(0), earnedFormatted: "0", isCurrentUser: false, isFriend: false, profile: null },
  { rank: 3, address: "0xabcdef1234567890abcdef1234567890abcdef12", mined: BigInt(134800n * 10n**18n), minedFormatted: "134,800", spent: BigInt(0), spentFormatted: "0", earned: BigInt(0), earnedFormatted: "0", isCurrentUser: false, isFriend: false, profile: null },
  { rank: 4, address: "0x9876543210fedcba9876543210fedcba98765432", mined: BigInt(98400n * 10n**18n), minedFormatted: "98,400", spent: BigInt(0), spentFormatted: "0", earned: BigInt(0), earnedFormatted: "0", isCurrentUser: false, isFriend: false, profile: null },
  { rank: 5, address: "0xcafebabecafebabecafebabecafebabecafebabe", mined: BigInt(76500n * 10n**18n), minedFormatted: "76,500", spent: BigInt(0), spentFormatted: "0", earned: BigInt(0), earnedFormatted: "0", isCurrentUser: true, isFriend: false, profile: null },
  { rank: 6, address: "0xfeedfacefeedfacefeedfacefeedfacefeedface", mined: BigInt(54200n * 10n**18n), minedFormatted: "54,200", spent: BigInt(0), spentFormatted: "0", earned: BigInt(0), earnedFormatted: "0", isCurrentUser: false, isFriend: false, profile: null },
  { rank: 7, address: "0x1111222233334444555566667777888899990000", mined: BigInt(42100n * 10n**18n), minedFormatted: "42,100", spent: BigInt(0), spentFormatted: "0", earned: BigInt(0), earnedFormatted: "0", isCurrentUser: false, isFriend: false, profile: null },
  { rank: 8, address: "0xaaaa5555bbbb6666cccc7777dddd8888eeee9999", mined: BigInt(31800n * 10n**18n), minedFormatted: "31,800", spent: BigInt(0), spentFormatted: "0", earned: BigInt(0), earnedFormatted: "0", isCurrentUser: false, isFriend: false, profile: null },
  { rank: 9, address: "0x0000111122223333444455556666777788889999", mined: BigInt(24600n * 10n**18n), minedFormatted: "24,600", spent: BigInt(0), spentFormatted: "0", earned: BigInt(0), earnedFormatted: "0", isCurrentUser: false, isFriend: false, profile: null },
  { rank: 10, address: "0xbeef0000beef0000beef0000beef0000beef0000", mined: BigInt(18900n * 10n**18n), minedFormatted: "18,900", spent: BigInt(0), spentFormatted: "0", earned: BigInt(0), earnedFormatted: "0", isCurrentUser: false, isFriend: false, profile: null },
];

// Mock mine history (last 10 mines)
const MOCK_MINES = [
  { id: "1", miner: "0x1234567890abcdef1234567890abcdef12345678", uri: "gm frens", price: BigInt(2_500_000), spent: BigInt(2_500_000), earned: BigInt(1_200_000), mined: BigInt(4500n * 10n**18n), multiplier: 2, timestamp: Math.floor(Date.now() / 1000) - 120 },
  { id: "2", miner: "0xabcdef1234567890abcdef1234567890abcdef12", uri: "to the moon", price: BigInt(1_800_000), spent: BigInt(1_800_000), earned: BigInt(890_000), mined: BigInt(3200n * 10n**18n), multiplier: 1, timestamp: Math.floor(Date.now() / 1000) - 340 },
  { id: "3", miner: "0x9876543210fedcba9876543210fedcba98765432", uri: "", price: BigInt(3_200_000), spent: BigInt(3_200_000), earned: BigInt(1_580_000), mined: BigInt(5800n * 10n**18n), multiplier: 3, timestamp: Math.floor(Date.now() / 1000) - 890 },
  { id: "4", miner: "0x1111222233334444555566667777888899990000", uri: "wagmi", price: BigInt(950_000), spent: BigInt(950_000), earned: BigInt(420_000), mined: BigInt(1800n * 10n**18n), multiplier: 1, timestamp: Math.floor(Date.now() / 1000) - 1800 },
  { id: "5", miner: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef", uri: "lfg", price: BigInt(4_100_000), spent: BigInt(4_100_000), earned: BigInt(2_050_000), mined: BigInt(7200n * 10n**18n), multiplier: 4, timestamp: Math.floor(Date.now() / 1000) - 3600 },
  { id: "6", miner: "0x1234567890abcdef1234567890abcdef12345678", uri: "mining is fun", price: BigInt(2_100_000), spent: BigInt(2_100_000), earned: BigInt(980_000), mined: BigInt(3900n * 10n**18n), multiplier: 1, timestamp: Math.floor(Date.now() / 1000) - 7200 },
  { id: "7", miner: "0xfeedfacefeedfacefeedfacefeedfacefeedface", uri: "", price: BigInt(1_500_000), spent: BigInt(1_500_000), earned: BigInt(720_000), mined: BigInt(2800n * 10n**18n), multiplier: 2, timestamp: Math.floor(Date.now() / 1000) - 14400 },
  { id: "8", miner: "0xabcdef1234567890abcdef1234567890abcdef12", uri: "donut gang", price: BigInt(2_800_000), spent: BigInt(2_800_000), earned: BigInt(1_350_000), mined: BigInt(5100n * 10n**18n), multiplier: 1, timestamp: Math.floor(Date.now() / 1000) - 28800 },
  { id: "9", miner: "0xcafebabecafebabecafebabecafebabecafebabe", uri: "first mine!", price: BigInt(500_000), spent: BigInt(500_000), earned: BigInt(230_000), mined: BigInt(950n * 10n**18n), multiplier: 1, timestamp: Math.floor(Date.now() / 1000) - 43200 },
  { id: "10", miner: "0x9876543210fedcba9876543210fedcba98765432", uri: "", price: BigInt(1_200_000), spent: BigInt(1_200_000), earned: BigInt(580_000), mined: BigInt(2200n * 10n**18n), multiplier: 1, timestamp: Math.floor(Date.now() / 1000) - 86400 },
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

type MineModalProps = {
  isOpen: boolean;
  onClose: () => void;
  tokenSymbol?: string;
  tokenName?: string;
  userBalance?: number;
  testSlotCount?: number; // For testing different slot counts
};

// Countdown component for multiplier expiry
function MultiplierCountdown({ endsAt }: { endsAt: number }) {
  const [timeLeft, setTimeLeft] = useState("");

  useEffect(() => {
    const update = () => {
      const diff = Math.max(0, endsAt - Date.now());
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${mins}m ${secs}s`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [endsAt]);

  return <span className="text-zinc-300 font-medium tabular-nums">{timeLeft}</span>;
}

function SlotCard({
  slot,
  isSelected,
  onSelect,
  isFlashing,
  isSingleSlot
}: {
  slot: Slot;
  isSelected: boolean;
  onSelect: () => void;
  isFlashing?: boolean;
  isSingleSlot?: boolean;
}) {
  return (
    <button
      onClick={onSelect}
      className={`
        aspect-square rounded-xl p-3 flex flex-col justify-between
        transition-all duration-200 relative overflow-hidden
        ${isSelected
          ? "ring-2 ring-white"
          : "ring-1 ring-zinc-700 hover:ring-zinc-600"
        }
        ${isFlashing ? "bg-zinc-600/80" : ""}
      `}
    >
      {/* Slot number and multiplier */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-500">#{slot.index}</span>
        <div className="flex items-center gap-1">
          <span className="text-xs text-zinc-500">{slot.multiplier}x</span>
        </div>
      </div>

      {/* Avatar - bigger for single slot */}
      <div className="flex justify-center py-1">
        <Avatar className={isSingleSlot ? "h-20 w-20" : "h-10 w-10"}>
          <AvatarImage src={slot.minerAvatar} alt={slot.miner} />
          <AvatarFallback className={`bg-zinc-700 text-zinc-300 ${isSingleSlot ? "text-xl" : "text-xs"}`}>
            {slot.miner.slice(2, 4).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      </div>

      {/* Price and owned indicator */}
      <div className="flex items-end justify-between">
        {/* Owned indicator */}
        {slot.isOwned ? (
          <div className="w-6 h-6 rounded-md bg-zinc-700 flex items-center justify-center">
            <User className="w-3.5 h-3.5 text-zinc-300" />
          </div>
        ) : (
          <div className="w-6" />
        )}
        {/* Price */}
        <div className={`font-semibold tabular-nums ${isSingleSlot ? "text-lg" : "text-sm"}`}>
          ${slot.price.toFixed(4)}
        </div>
      </div>

      {/* Flash overlay when mined */}
      {isFlashing && (
        <div className="absolute inset-0 bg-white/20 animate-pulse" />
      )}
    </button>
  );
}

// Price decay: goes from startPrice to 0 over 1 hour (3600 seconds)
const DECAY_DURATION_MS = 3600 * 1000; // 1 hour
const TICK_INTERVAL_MS = 100; // Update every 100ms for smooth animation

export function MineModal({ isOpen, onClose, tokenSymbol = "DONUT", tokenName = "Donut", userBalance = 12.45, testSlotCount }: MineModalProps) {
  const params = useParams();
  const rigAddress = (params?.address as string) || "";
  const rigUrl = typeof window !== "undefined" ? `${window.location.origin}/rig/${rigAddress}` : "";
  const [slots, setSlots] = useState<Slot[]>(() => {
    const baseSlots = testSlotCount ? generateMockSlots(testSlotCount) : MOCK_SLOTS;
    return baseSlots.map(slot => ({
      ...slot,
      startPrice: slot.price, // Track the price after last mine (for decay calculation)
      lastMineTime: Date.now() - Math.random() * 30000, // Random start times for variety
    }));
  });

  // Auto-select the cheapest slot
  const [selectedSlot, setSelectedSlot] = useState<number>(() => {
    const baseSlots = testSlotCount ? generateMockSlots(testSlotCount) : MOCK_SLOTS;
    const cheapest = baseSlots.reduce((min, slot) => slot.price < min.price ? slot : min, baseSlots[0]);
    return cheapest.index;
  });
  const [flashingSlots, setFlashingSlots] = useState<Set<number>>(new Set());

  // Price decay tick - all prices decay toward 0
  useEffect(() => {
    if (!isOpen) return;

    const interval = setInterval(() => {
      const now = Date.now();

      setSlots(prev => prev.map(slot => {
        const elapsed = now - (slot.lastMineTime || now);
        const decayProgress = Math.min(elapsed / DECAY_DURATION_MS, 1);
        // Linear decay from startPrice to 0
        const decayedPrice = (slot.startPrice || slot.price) * (1 - decayProgress);

        return {
          ...slot,
          price: Math.max(0.0001, decayedPrice), // Floor at 0.0001
        };
      }));
    }, TICK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isOpen]);

  // Simulate random mines (flash + price double)
  useEffect(() => {
    if (!isOpen) return;

    const interval = setInterval(() => {
      // Random chance for a slot to get mined
      if (Math.random() > 0.85) {
        const slotIndex = Math.floor(Math.random() * slots.length) + 1;

        // Flash the slot
        setFlashingSlots(prev => new Set(prev).add(slotIndex));

        // Double the price and reset decay timer
        setSlots(prev => prev.map(slot => {
          if (slot.index === slotIndex) {
            const newPrice = slot.price * 2;
            return {
              ...slot,
              price: newPrice,
              startPrice: newPrice,
              lastMineTime: Date.now(),
              // Optionally change miner avatar on mine
              minerAvatar: `https://api.dicebear.com/7.x/shapes/svg?seed=${Date.now()}`,
            };
          }
          return slot;
        }));

        // Remove flash after animation
        setTimeout(() => {
          setFlashingSlots(prev => {
            const next = new Set(prev);
            next.delete(slotIndex);
            return next;
          });
        }, 500);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [isOpen, slots.length]);

  const selectedSlotData = slots.find(s => s.index === selectedSlot);

  // Calculate grid columns - 1 col for single, 2 cols for 2, 3 cols for 3+
  const getGridCols = (count: number) => {
    if (count === 1) return "grid-cols-1 max-w-[200px]";
    if (count === 2) return "grid-cols-2";
    return "grid-cols-3"; // 3+ slots
  };

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
        {/* Header - X on left, Mine centered */}
        <div className="flex items-center justify-between px-4 pb-2">
          <button
            onClick={onClose}
            className="p-2 -ml-2 rounded-xl hover:bg-secondary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          <span className="text-base font-semibold">Mine</span>
          <div className="w-9" /> {/* Spacer for balance */}
        </div>

        {/* Sticky selected slot info */}
        {selectedSlotData && (
          <div className="px-4 pb-4 bg-background">
            {/* Header: Avatar, Name, Address, Multiplier */}
            <div className="flex items-start gap-3 mb-3">
              <Avatar className="h-14 w-14 flex-shrink-0">
                <AvatarImage src={selectedSlotData.minerAvatar} />
                <AvatarFallback className="bg-zinc-700 text-sm">
                  {selectedSlotData.miner.slice(2, 4).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold truncate">
                    {selectedSlotData.minerName || `Slot #${selectedSlotData.index}`}
                  </span>
                  <span className="text-xs font-semibold text-zinc-300 bg-zinc-700 px-1.5 py-0.5 rounded flex-shrink-0">
                    {selectedSlotData.multiplier}x
                  </span>
                  {selectedSlotData.multiplierEndsAt && (
                    <span className="text-[10px] text-zinc-500 flex-shrink-0">
                      <MultiplierCountdown endsAt={selectedSlotData.multiplierEndsAt} />
                    </span>
                  )}
                </div>
                <div className="text-xs text-zinc-500 mt-0.5">{selectedSlotData.miner}</div>
                <div className="text-xs text-zinc-400 mt-1 truncate italic">
                  "{selectedSlotData.uri || "No message"}"
                </div>
              </div>
            </div>

            {/* Stats Grid - Rate, Mined, PnL, Total */}
            <div className="grid grid-cols-4 gap-3">
              <div>
                <div className="text-[12px] text-muted-foreground">Rate</div>
                <div className="text-[13px] font-medium tabular-nums mt-0.5 flex items-center gap-1">
                  <span className="w-4 h-4 rounded-full bg-zinc-700 flex items-center justify-center text-[8px]">
                    {tokenSymbol.charAt(0)}
                  </span>
                  {selectedSlotData.mineRate ?? 1}/s
                </div>
              </div>
              <div>
                <div className="text-[12px] text-muted-foreground">Mined</div>
                <div className="text-[13px] font-medium tabular-nums mt-0.5 flex items-center gap-1">
                  +
                  <span className="w-4 h-4 rounded-full bg-zinc-700 flex items-center justify-center text-[8px]">
                    {tokenSymbol.charAt(0)}
                  </span>
                  {selectedSlotData.mined.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-[12px] text-muted-foreground">PnL</div>
                <div className="text-[13px] font-medium tabular-nums mt-0.5">
                  {(selectedSlotData.pnl ?? 0) >= 0 ? "+$" : "-$"}{Math.abs(selectedSlotData.pnl ?? 0).toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-[12px] text-muted-foreground">Total</div>
                <div className="text-[13px] font-medium tabular-nums mt-0.5">
                  {(selectedSlotData.total ?? 0) >= 0 ? "+$" : "-$"}{Math.abs(selectedSlotData.total ?? 0).toFixed(2)}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Scrollable Content */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-4 pt-4">
          {/* Slots Grid */}
          <div className={`grid ${getGridCols(slots.length)} gap-2 mx-auto`}>
            {slots.map((slot) => (
              <SlotCard
                key={slot.index}
                slot={slot}
                isSelected={selectedSlot === slot.index}
                onSelect={() => setSelectedSlot(slot.index)}
                isFlashing={flashingSlots.has(slot.index)}
                isSingleSlot={slots.length === 1}
              />
            ))}
          </div>

          {/* Your Position */}
          <div className="mt-6 px-2">
            <div className="font-semibold text-[18px] mb-3">Your position</div>
            <div className="grid grid-cols-2 gap-y-4 gap-x-8">
              <div>
                <div className="text-muted-foreground text-[12px] mb-1">Mined</div>
                <div className="font-semibold text-[15px] tabular-nums flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-[10px] text-white font-semibold">
                    {tokenName.charAt(0)}
                  </span>
                  <span>183.5K</span>
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-1">Value</div>
                <div className="font-semibold text-[15px] tabular-nums text-white">
                  $2.24
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-1">Spent</div>
                <div className="font-semibold text-[15px] tabular-nums text-white">
                  $564.68
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-1">Earned</div>
                <div className="font-semibold text-[15px] tabular-nums text-white">
                  $267.52
                </div>
              </div>
            </div>
          </div>

          {/* Leaderboard Section */}
          <Leaderboard
            entries={MOCK_LEADERBOARD}
            userRank={5}
            tokenSymbol={tokenSymbol}
            tokenName={tokenName}
            rigUrl={rigUrl}
            isLoading={false}
          />

          {/* Recent Mines */}
          <div className="mt-6 mb-6">
            <div className="font-semibold text-[18px] mb-3 px-2">Recent Mines</div>
            <div className="px-2">
              {MOCK_MINES.map((mine) => (
                <MineHistoryItem
                  key={mine.id}
                  mine={mine}
                  timeAgo={timeAgo}
                  tokenSymbol={tokenSymbol}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Bottom Action Bar - no border */}
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-background flex justify-center" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 60px)" }}>
          <div className="flex items-center justify-between w-full max-w-[520px] px-4 py-3">
            <div className="flex items-center gap-6">
              <div>
                <div className="text-muted-foreground text-[12px]">Price</div>
                <div className="font-semibold text-[17px] tabular-nums">
                  ${selectedSlotData?.price.toFixed(4) ?? "—"}
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
              disabled={!selectedSlot}
              className={`
                w-32 h-10 text-[14px] font-semibold rounded-xl transition-all
                ${selectedSlot
                  ? "bg-white text-black hover:bg-zinc-200"
                  : "bg-zinc-700 text-zinc-500 cursor-not-allowed"
                }
              `}
            >
              Mine
            </button>
          </div>
        </div>
      </div>
      <NavBar />
    </div>
  );
}
