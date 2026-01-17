"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { NavBar } from "@/components/nav-bar";

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
};

// Generate mock slots for any count
function generateMockSlots(count: number): Slot[] {
  const names = ["King Glazer", "DiamondHands", "CryptoWhale", "SatoshiFan", "DonutLover", "BlockBuilder", "HashMaster", "TokenTitan", "ChainChamp", "MoonBoy", "GigaChad", "NightOwl", "DayTrader", "HODLer", "DegenKing", "AlphaHunter", "YieldFarmer", "GasGuzzler", "WhaleTales", "Rugpuller", "BasedDev", "AnonMiner", "TokenMaxi", "ChartWizard", "BagHolder"];
  const uris = ["Never Stop Glazing", "WAGMI", "To the moon!", "", "gm frens", "Building the future", "", "LFG!", "Stay humble, stack sats", "ngmi", "probably nothing", "this is the way", "wen lambo", "", "gn", ""];

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
  }));
}

// Default 9 slots
const MOCK_SLOTS: Slot[] = generateMockSlots(9);

type MineModalProps = {
  isOpen: boolean;
  onClose: () => void;
  tokenSymbol?: string;
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

      {/* Price */}
      <div className="text-right">
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

export function MineModal({ isOpen, onClose, tokenSymbol = "DONUT", userBalance = 12.45, testSlotCount }: MineModalProps) {
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

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-4">
          {/* Selected slot info at top */}
          {selectedSlotData && (
            <div className="mb-6">
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
              <div className="grid grid-cols-4 gap-3 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
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
        </div>

        {/* Bottom Action Bar - no border */}
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-background flex justify-center" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 60px)" }}>
          <div className="flex items-center justify-between w-full max-w-[520px] px-4 py-3">
            <div className="flex items-center gap-6">
              <div>
                <div className="text-muted-foreground text-[12px]">Mine Price</div>
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
