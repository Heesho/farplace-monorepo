"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { X, User, Image as ImageIcon } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { NavBar } from "@/components/nav-bar";
import { Leaderboard } from "@/components/leaderboard";

type ContentItem = {
  index: number;
  tokenId: number;
  owner: string;
  ownerName?: string;
  ownerAvatar?: string;
  creator: string;
  creatorName?: string;
  price: number;
  startPrice?: number;
  lastCollectTime?: number;
  stake: number;
  earned: number;
  imageUrl?: string;
  title?: string;
  isOwned?: boolean;
};

// Generate mock content items
function generateMockContent(count: number): ContentItem[] {
  const ownerNames = ["King Glazer", "DiamondHands", "CryptoWhale", "SatoshiFan", "DonutLover", "BlockBuilder", "HashMaster", "TokenTitan", "ChainChamp", "MoonBoy", "GigaChad", "NightOwl"];
  const creatorNames = ["ArtistOne", "CreatorPro", "PixelMaster", "DigitalDreams"];
  const titles = ["Sunset Dreams", "Cyber Punk", "Abstract Flow", "Digital Soul", "Neon Nights", "Crystal Clear", "Shadow Play", "Color Burst", "Mind Melt", "Future Vision", "Retro Wave", "Deep Space"];

  // Mark items 1 and 4 as owned by the user for demo
  const ownedItems = new Set([1, 4]);

  return Array.from({ length: count }, (_, i) => ({
    index: i + 1,
    tokenId: i + 1,
    owner: `0x${(i + 1).toString(16).padStart(4, "0")}...${(i + 1000).toString(16).padStart(4, "0")}`,
    ownerName: ownerNames[i % ownerNames.length],
    ownerAvatar: `https://api.dicebear.com/7.x/shapes/svg?seed=${i + 1000}`,
    creator: `0x${(i + 100).toString(16).padStart(4, "0")}...${(i + 2000).toString(16).padStart(4, "0")}`,
    creatorName: creatorNames[i % creatorNames.length],
    price: 0.05 + Math.random() * 0.1,
    stake: Math.random() * 0.5 + 0.1,
    earned: Math.floor(Math.random() * 5000) + 500,
    imageUrl: `https://picsum.photos/seed/${i + 100}/400/400`,
    title: titles[i % titles.length],
    isOwned: ownedItems.has(i + 1),
  }));
}

// Default 9 content items
const MOCK_CONTENT: ContentItem[] = generateMockContent(9);

// Mock leaderboard (top collectors by stake)
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

// Mock collect history
const MOCK_COLLECTS = [
  { id: "1", collector: "0x1234567890abcdef1234567890abcdef12345678", tokenId: 3, title: "Cyber Punk", price: BigInt(2_500_000), stake: BigInt(2_500_000), earned: BigInt(1_200_000), timestamp: Math.floor(Date.now() / 1000) - 120 },
  { id: "2", collector: "0xabcdef1234567890abcdef1234567890abcdef12", tokenId: 7, title: "Neon Nights", price: BigInt(1_800_000), stake: BigInt(1_800_000), earned: BigInt(890_000), timestamp: Math.floor(Date.now() / 1000) - 340 },
  { id: "3", collector: "0x9876543210fedcba9876543210fedcba98765432", tokenId: 1, title: "Sunset Dreams", price: BigInt(3_200_000), stake: BigInt(3_200_000), earned: BigInt(1_580_000), timestamp: Math.floor(Date.now() / 1000) - 890 },
  { id: "4", collector: "0x1111222233334444555566667777888899990000", tokenId: 5, title: "Digital Soul", price: BigInt(950_000), stake: BigInt(950_000), earned: BigInt(420_000), timestamp: Math.floor(Date.now() / 1000) - 1800 },
  { id: "5", collector: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef", tokenId: 2, title: "Abstract Flow", price: BigInt(4_100_000), stake: BigInt(4_100_000), earned: BigInt(2_050_000), timestamp: Math.floor(Date.now() / 1000) - 3600 },
  { id: "6", collector: "0x1234567890abcdef1234567890abcdef12345678", tokenId: 8, title: "Crystal Clear", price: BigInt(2_100_000), stake: BigInt(2_100_000), earned: BigInt(980_000), timestamp: Math.floor(Date.now() / 1000) - 7200 },
  { id: "7", collector: "0xfeedfacefeedfacefeedfacefeedfacefeedface", tokenId: 4, title: "Shadow Play", price: BigInt(1_500_000), stake: BigInt(1_500_000), earned: BigInt(720_000), timestamp: Math.floor(Date.now() / 1000) - 14400 },
  { id: "8", collector: "0xabcdef1234567890abcdef1234567890abcdef12", tokenId: 9, title: "Color Burst", price: BigInt(2_800_000), stake: BigInt(2_800_000), earned: BigInt(1_350_000), timestamp: Math.floor(Date.now() / 1000) - 28800 },
  { id: "9", collector: "0xcafebabecafebabecafebabecafebabecafebabe", tokenId: 6, title: "Mind Melt", price: BigInt(500_000), stake: BigInt(500_000), earned: BigInt(230_000), timestamp: Math.floor(Date.now() / 1000) - 43200 },
  { id: "10", collector: "0x9876543210fedcba9876543210fedcba98765432", tokenId: 3, title: "Cyber Punk", price: BigInt(1_200_000), stake: BigInt(1_200_000), earned: BigInt(580_000), timestamp: Math.floor(Date.now() / 1000) - 86400 },
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

type ContentModalProps = {
  isOpen: boolean;
  onClose: () => void;
  tokenSymbol?: string;
  tokenName?: string;
  userBalance?: number;
  testItemCount?: number;
};

function ContentCard({
  item,
  isSelected,
  onSelect,
  isFlashing,
  isSingleItem
}: {
  item: ContentItem;
  isSelected: boolean;
  onSelect: () => void;
  isFlashing?: boolean;
  isSingleItem?: boolean;
}) {
  return (
    <button
      onClick={onSelect}
      className={`
        aspect-square rounded-xl overflow-hidden flex flex-col
        transition-all duration-200 relative
        ${isSelected
          ? "ring-2 ring-white"
          : "ring-1 ring-zinc-700 hover:ring-zinc-600"
        }
        ${isFlashing ? "bg-zinc-600/80" : ""}
      `}
    >
      {/* Content image */}
      <div className="flex-1 relative bg-zinc-800">
        {item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt={item.title || `#${item.tokenId}`}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageIcon className="w-8 h-8 text-zinc-600" />
          </div>
        )}
        {/* Token ID badge */}
        <div className="absolute top-1.5 left-1.5 bg-black/60 backdrop-blur-sm px-1.5 py-0.5 rounded text-[10px] text-zinc-300">
          #{item.tokenId}
        </div>
        {/* Owned indicator */}
        {item.isOwned && (
          <div className="absolute bottom-1.5 left-1.5 w-6 h-6 rounded-md bg-zinc-800/80 backdrop-blur-sm flex items-center justify-center">
            <User className="w-3.5 h-3.5 text-zinc-300" />
          </div>
        )}
        {/* Price */}
        <div className={`absolute bottom-1.5 right-1.5 bg-black/60 backdrop-blur-sm px-1.5 py-0.5 rounded font-semibold tabular-nums ${isSingleItem ? "text-sm" : "text-xs"}`}>
          ${item.price.toFixed(4)}
        </div>
      </div>

      {/* Flash overlay when collected */}
      {isFlashing && (
        <div className="absolute inset-0 bg-white/20 animate-pulse" />
      )}
    </button>
  );
}

// Collect history item component
function CollectHistoryItem({
  collect,
  timeAgo: timeAgoFn,
  tokenSymbol
}: {
  collect: typeof MOCK_COLLECTS[0];
  timeAgo: (timestamp: number) => string;
  tokenSymbol: string;
}) {
  return (
    <div className="flex items-center gap-3 py-3 border-b border-zinc-800 last:border-0">
      <Avatar className="h-9 w-9 flex-shrink-0">
        <AvatarImage src={`https://api.dicebear.com/7.x/shapes/svg?seed=${collect.collector}`} />
        <AvatarFallback className="bg-zinc-700 text-xs">
          {collect.collector.slice(2, 4).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">
            {collect.collector.slice(0, 6)}...{collect.collector.slice(-4)}
          </span>
          <span className="text-xs text-zinc-500">{timeAgoFn(collect.timestamp)}</span>
        </div>
        <div className="text-xs text-zinc-400 truncate">
          Mined "{collect.title}"
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="text-sm font-medium tabular-nums">
          ${(Number(collect.price) / 1_000_000).toFixed(2)}
        </div>
        <div className="text-[10px] text-zinc-500">stake</div>
      </div>
    </div>
  );
}

// Price decay: goes from startPrice to 0 over 1 day (86400 seconds)
const DECAY_DURATION_MS = 86400 * 1000; // 1 day
const TICK_INTERVAL_MS = 100;

export function ContentModal({ isOpen, onClose, tokenSymbol = "DONUT", tokenName = "Donut", userBalance = 12.45, testItemCount }: ContentModalProps) {
  const params = useParams();
  const rigAddress = (params?.address as string) || "";
  const rigUrl = typeof window !== "undefined" ? `${window.location.origin}/rig/${rigAddress}` : "";
  const [content, setContent] = useState<ContentItem[]>(() => {
    const baseContent = testItemCount ? generateMockContent(testItemCount) : MOCK_CONTENT;
    return baseContent.map(item => ({
      ...item,
      startPrice: item.price,
      lastCollectTime: Date.now() - Math.random() * 3600000, // Random start times
    }));
  });

  // Auto-select the cheapest item
  const [selectedItem, setSelectedItem] = useState<number>(() => {
    const baseContent = testItemCount ? generateMockContent(testItemCount) : MOCK_CONTENT;
    const cheapest = baseContent.reduce((min, item) => item.price < min.price ? item : min, baseContent[0]);
    return cheapest.tokenId;
  });
  const [flashingItems, setFlashingItems] = useState<Set<number>>(new Set());

  // Price decay tick
  useEffect(() => {
    if (!isOpen) return;

    const interval = setInterval(() => {
      const now = Date.now();

      setContent(prev => prev.map(item => {
        const elapsed = now - (item.lastCollectTime || now);
        const decayProgress = Math.min(elapsed / DECAY_DURATION_MS, 1);
        const decayedPrice = (item.startPrice || item.price) * (1 - decayProgress);

        return {
          ...item,
          price: Math.max(0.0001, decayedPrice),
        };
      }));
    }, TICK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isOpen]);

  // Simulate random collects (flash + price double)
  useEffect(() => {
    if (!isOpen) return;

    const interval = setInterval(() => {
      if (Math.random() > 0.9) { // Less frequent than mining
        const itemIndex = Math.floor(Math.random() * content.length);
        const tokenId = content[itemIndex].tokenId;

        setFlashingItems(prev => new Set(prev).add(tokenId));

        // Double the price and reset decay timer
        setContent(prev => prev.map(item => {
          if (item.tokenId === tokenId) {
            const newPrice = item.price * 2;
            return {
              ...item,
              price: newPrice,
              startPrice: newPrice,
              lastCollectTime: Date.now(),
              ownerAvatar: `https://api.dicebear.com/7.x/shapes/svg?seed=${Date.now()}`,
            };
          }
          return item;
        }));

        setTimeout(() => {
          setFlashingItems(prev => {
            const next = new Set(prev);
            next.delete(tokenId);
            return next;
          });
        }, 500);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [isOpen, content.length]);

  const selectedItemData = content.find(c => c.tokenId === selectedItem);

  const getGridCols = (count: number) => {
    if (count === 1) return "grid-cols-1 max-w-[200px]";
    if (count === 2) return "grid-cols-2";
    return "grid-cols-3";
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

        {/* Sticky selected item info */}
        {selectedItemData && (
          <div className="px-4 pb-4 bg-background">
            {/* Header: Image, Title, Owner */}
            <div className="flex items-start gap-3 mb-3">
              <div className="h-14 w-14 flex-shrink-0 rounded-lg overflow-hidden bg-zinc-800">
                {selectedItemData.imageUrl ? (
                  <img
                    src={selectedItemData.imageUrl}
                    alt={selectedItemData.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <ImageIcon className="w-6 h-6 text-zinc-600" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold truncate">
                    {selectedItemData.title || `#${selectedItemData.tokenId}`}
                  </span>
                  <span className="text-xs font-semibold text-zinc-300 bg-zinc-700 px-1.5 py-0.5 rounded flex-shrink-0">
                    #{selectedItemData.tokenId}
                  </span>
                </div>
                <div className="text-xs text-zinc-500 mt-0.5 flex items-center gap-1">
                  <span>Owned by</span>
                  <button className="flex items-center gap-1 hover:opacity-80 transition-opacity">
                    <img
                      src={selectedItemData.ownerAvatar || `https://api.dicebear.com/7.x/shapes/svg?seed=${selectedItemData.owner}`}
                      alt=""
                      className="w-4 h-4 rounded-full"
                    />
                    <span className="text-zinc-300">{selectedItemData.ownerName || selectedItemData.owner}</span>
                  </button>
                </div>
                <div className="text-xs text-zinc-500 mt-0.5 flex items-center gap-1">
                  <span>Created by</span>
                  <button className="flex items-center gap-1 hover:opacity-80 transition-opacity">
                    <img
                      src={`https://api.dicebear.com/7.x/shapes/svg?seed=${selectedItemData.creator}`}
                      alt=""
                      className="w-4 h-4 rounded-full"
                    />
                    <span className="text-zinc-300">{selectedItemData.creatorName || selectedItemData.creator}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Stats Grid - Stake, Earned, Owner Payout */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <div className="text-[12px] text-muted-foreground">Stake</div>
                <div className="text-[13px] font-medium tabular-nums mt-0.5">
                  ${selectedItemData.stake.toFixed(4)}
                </div>
              </div>
              <div>
                <div className="text-[12px] text-muted-foreground">Earned</div>
                <div className="text-[13px] font-medium tabular-nums mt-0.5 flex items-center gap-1">
                  +
                  <span className="w-4 h-4 rounded-full bg-zinc-700 flex items-center justify-center text-[8px]">
                    {tokenSymbol.charAt(0)}
                  </span>
                  {selectedItemData.earned.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-[12px] text-muted-foreground">Payout</div>
                <div className="text-[13px] font-medium tabular-nums mt-0.5 text-green-400">
                  +${(selectedItemData.price * 0.8).toFixed(4)}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Scrollable Content */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-4 pt-4">
          {/* Content Grid */}
          <div className={`grid ${getGridCols(content.length)} gap-2 mx-auto`}>
            {content.map((item) => (
              <ContentCard
                key={item.tokenId}
                item={item}
                isSelected={selectedItem === item.tokenId}
                onSelect={() => setSelectedItem(item.tokenId)}
                isFlashing={flashingItems.has(item.tokenId)}
                isSingleItem={content.length === 1}
              />
            ))}
          </div>

          {/* Your Position */}
          <div className="mt-6 px-2">
            <div className="font-semibold text-[18px] mb-3">Your position</div>
            <div className="grid grid-cols-2 gap-y-4 gap-x-8">
              <div>
                <div className="text-muted-foreground text-[12px] mb-1">Earned</div>
                <div className="font-semibold text-[15px] tabular-nums flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-[10px] text-white font-semibold">
                    {tokenName.charAt(0)}
                  </span>
                  <span>24.5K</span>
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-1">Value</div>
                <div className="font-semibold text-[15px] tabular-nums text-white">
                  $1.84
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-1">Spent</div>
                <div className="font-semibold text-[15px] tabular-nums text-white">
                  $124.50
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[12px] mb-1">Received</div>
                <div className="font-semibold text-[15px] tabular-nums text-white">
                  $98.20
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

          {/* Recent Collects */}
          <div className="mt-6 mb-6">
            <div className="font-semibold text-[18px] mb-3 px-2">Recent Mines</div>
            <div className="px-2">
              {MOCK_COLLECTS.map((collect) => (
                <CollectHistoryItem
                  key={collect.id}
                  collect={collect}
                  timeAgo={timeAgo}
                  tokenSymbol={tokenSymbol}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Bottom Action Bar */}
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-background flex justify-center" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 60px)" }}>
          <div className="flex items-center justify-between w-full max-w-[520px] px-4 py-3">
            <div className="flex items-center gap-6">
              <div>
                <div className="text-muted-foreground text-[12px]">Price</div>
                <div className="font-semibold text-[17px] tabular-nums">
                  ${selectedItemData?.price.toFixed(4) ?? "—"}
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
              disabled={!selectedItem}
              className={`
                w-32 h-10 text-[14px] font-semibold rounded-xl transition-all
                ${selectedItem
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
