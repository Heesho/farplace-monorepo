"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { formatUnits, parseUnits } from "viem";
import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { NavBar } from "@/components/nav-bar";
import { useFarcaster } from "@/hooks/useFarcaster";
import { useUserProfile } from "@/hooks/useUserProfile";
import { useTokenMetadata } from "@/hooks/useMetadata";
import { CONTRACT_ADDRESSES, ERC20_ABI, MOCK_MINT_ABI, QUOTE_TOKEN_DECIMALS } from "@/lib/contracts";
import type { UserHolding, UserLaunchedRig } from "@/hooks/useUserProfile";

type Tab = "holdings" | "launched";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toFixed(2);
}

function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  if (value >= 0.01) return `$${value.toFixed(2)}`;
  if (value > 0) return `<$0.01`;
  return "$0.00";
}

// ---------------------------------------------------------------------------
// TokenLogo
// ---------------------------------------------------------------------------

function TokenLogo({
  name,
  logoUrl,
  size = "md",
}: {
  name: string;
  logoUrl?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const sizeClasses = {
    sm: "w-5 h-5 text-[9px]",
    md: "w-10 h-10 text-sm",
    lg: "w-12 h-12 text-base",
  };

  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={name}
        className={`${sizeClasses[size]} rounded-full object-cover`}
      />
    );
  }

  return (
    <div
      className={`${sizeClasses[size]} rounded-full flex items-center justify-center font-semibold bg-gradient-to-br from-zinc-500 to-zinc-700 text-white`}
    >
      {name.charAt(0)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// HoldingRow
// ---------------------------------------------------------------------------

function HoldingRow({ holding }: { holding: UserHolding }) {
  const { logoUrl } = useTokenMetadata(holding.rigUri);

  return (
    <Link href={`/rig/${holding.address}`} className="block">
      <div className="flex items-center justify-between py-3 hover:bg-secondary/30 -mx-4 px-4 transition-colors rounded-lg">
        <div className="flex items-center gap-3 min-w-0">
          <TokenLogo name={holding.tokenName} logoUrl={logoUrl} size="md" />
          <div className="min-w-0">
            <div className="text-[15px] font-medium truncate">
              {holding.tokenName}
            </div>
            <div className="text-[12px] text-muted-foreground">
              {formatNumber(holding.balanceNum)} {holding.tokenSymbol}
            </div>
          </div>
        </div>
        <div className="text-right shrink-0 ml-3">
          <div className="text-[15px] font-semibold tabular-nums">
            {holding.valueUsd > 0 ? formatUsd(holding.valueUsd) : "--"}
          </div>
          <div className="text-[12px] text-muted-foreground tabular-nums">
            {holding.priceUsd > 0
              ? `$${holding.priceUsd >= 0.01 ? holding.priceUsd.toFixed(4) : holding.priceUsd.toFixed(6)}`
              : "--"}
          </div>
        </div>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// LaunchedRow
// ---------------------------------------------------------------------------

function LaunchedRow({ rig }: { rig: UserLaunchedRig }) {
  const { logoUrl } = useTokenMetadata(rig.rigUri);

  return (
    <Link href={`/rig/${rig.address}`} className="block">
      <div className="flex items-center justify-between py-3 hover:bg-secondary/30 -mx-4 px-4 transition-colors rounded-lg">
        <div className="flex items-center gap-3 min-w-0">
          <TokenLogo name={rig.tokenName} logoUrl={logoUrl} size="md" />
          <div className="min-w-0">
            <div className="text-[15px] font-medium truncate">
              {rig.tokenName}
            </div>
            <div className="text-[12px] text-muted-foreground">
              {rig.tokenSymbol}
            </div>
          </div>
        </div>
        <div className="text-right shrink-0 ml-3">
          <div className="text-[15px] font-semibold tabular-nums">
            {rig.marketCapUsd > 0 ? formatUsd(rig.marketCapUsd) : "--"}
          </div>
          <div className="text-[12px] text-muted-foreground tabular-nums">
            Mcap
          </div>
        </div>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function ProfileSkeleton() {
  return (
    <main className="flex h-screen w-screen justify-center bg-zinc-800">
      <div
        className="relative flex h-full w-full max-w-[520px] flex-col bg-background"
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 8px)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 80px)",
        }}
      >
        <div className="px-4 pb-4">
          <div className="flex items-center gap-3 py-4">
            <div className="w-12 h-12 rounded-full bg-secondary animate-pulse" />
            <div>
              <div className="w-28 h-5 bg-secondary rounded animate-pulse mb-1" />
              <div className="w-20 h-4 bg-secondary rounded animate-pulse" />
            </div>
          </div>
        </div>
        <div className="flex border-b border-secondary mx-4 mb-4">
          <div className="w-24 h-8 bg-secondary rounded animate-pulse mr-4" />
          <div className="w-24 h-8 bg-secondary rounded animate-pulse" />
        </div>
        <div className="flex-1 px-4 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-3">
              <div className="w-10 h-10 rounded-full bg-secondary animate-pulse" />
              <div className="flex-1">
                <div className="w-24 h-4 bg-secondary rounded animate-pulse mb-1" />
                <div className="w-16 h-3 bg-secondary rounded animate-pulse" />
              </div>
              <div className="text-right">
                <div className="w-16 h-4 bg-secondary rounded animate-pulse mb-1" />
                <div className="w-12 h-3 bg-secondary rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
        <NavBar />
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Not Connected state
// ---------------------------------------------------------------------------

function NotConnected() {
  const { isInFrame, isConnecting, connect } = useFarcaster();

  return (
    <main className="flex h-screen w-screen justify-center bg-zinc-800">
      <div
        className="relative flex h-full w-full max-w-[520px] flex-col bg-background"
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 8px)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 80px)",
        }}
      >
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center mb-4">
            <svg
              className="w-8 h-8 text-muted-foreground"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </div>
          {isInFrame ? (
            <>
              <div className="text-[17px] font-semibold mb-1">
                Connecting...
              </div>
              <div className="text-[14px] text-muted-foreground">
                Connecting your Farcaster wallet
              </div>
            </>
          ) : (
            <>
              <div className="text-[17px] font-semibold mb-1">
                Connect your wallet
              </div>
              <div className="text-[14px] text-muted-foreground mb-4">
                Connect a browser wallet to continue
              </div>
              <button
                onClick={() => connect()}
                disabled={isConnecting}
                className="px-6 py-2.5 rounded-xl bg-white text-black text-[14px] font-semibold hover:bg-zinc-200 transition-colors disabled:opacity-50"
              >
                {isConnecting ? "Connecting..." : "Connect Wallet"}
              </button>
            </>
          )}
        </div>
        <NavBar />
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Main Profile Page
// ---------------------------------------------------------------------------

export default function ProfilePage() {
  const [activeTab, setActiveTab] = useState<Tab>("holdings");

  // Data hooks
  const { user, address } = useFarcaster();
  const { holdings, launchedRigs, totalHoldingsValueUsd, isLoading } = useUserProfile(address);

  // USDC balance
  const { data: usdcBalance, refetch: refetchUsdc } = useReadContract({
    address: CONTRACT_ADDRESSES.usdc as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  // Mock USDC mint (staging only)
  const {
    writeContract: mintUsdc,
    data: usdcTxHash,
    isPending: isUsdcMintPending,
    reset: resetUsdcMint,
  } = useWriteContract();

  const { isLoading: isUsdcTxConfirming, isSuccess: isUsdcTxSuccess } =
    useWaitForTransactionReceipt({ hash: usdcTxHash });

  useEffect(() => {
    if (isUsdcTxSuccess) {
      refetchUsdc();
      resetUsdcMint();
    }
  }, [isUsdcTxSuccess, refetchUsdc, resetUsdcMint]);

  if (!address) {
    return <NotConnected />;
  }

  if (isLoading) {
    return <ProfileSkeleton />;
  }

  const usdcNum = usdcBalance != null ? Number(formatUnits(usdcBalance as bigint, QUOTE_TOKEN_DECIMALS)) : 0;
  const formattedUsdc = usdcBalance != null
    ? usdcNum.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : "--";

  const isUsdcMinting = isUsdcMintPending || isUsdcTxConfirming;
  const totalValueUsd = usdcNum + totalHoldingsValueUsd;
  const shortAddress = `${address.slice(0, 6)}...${address.slice(-4)}`;
  const displayName = user?.displayName || user?.username || shortAddress;
  const pfpUrl = user?.pfpUrl || null;
  const username = user?.username ? `@${user.username}` : null;
  const isAddressFallbackAvatar = !user?.displayName && !user?.username;
  const avatarFallback = user?.displayName
    ? user.displayName.charAt(0).toUpperCase()
    : user?.username
      ? user.username.charAt(0).toUpperCase()
      : address.slice(-2).toUpperCase();

  return (
    <main className="flex h-screen w-screen justify-center bg-zinc-800">
      <div
        className="relative flex h-full w-full max-w-[520px] flex-col bg-background"
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 8px)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 80px)",
        }}
      >
        {/* Header */}
        <div className="px-4 pb-2">
          <div className="mb-3">
            <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
          </div>
          <div className="flex items-center gap-3 py-3">
            {pfpUrl ? (
              <img
                src={pfpUrl}
                alt={displayName}
                className="w-12 h-12 rounded-full object-cover"
              />
            ) : (
              <div
                className={`w-12 h-12 rounded-full flex items-center justify-center text-white ${
                  isAddressFallbackAvatar
                    ? "font-mono text-[15px] tracking-wide bg-gradient-to-br from-zinc-600 to-zinc-800"
                    : "font-semibold text-lg bg-gradient-to-br from-zinc-500 to-zinc-700"
                }`}
              >
                {avatarFallback}
              </div>
            )}
            <div>
              <div className="text-[17px] font-semibold">{displayName}</div>
              {username && (
                <div className="text-[13px] text-muted-foreground">
                  {username}
                </div>
              )}
            </div>
          </div>

          {/* Portfolio value */}
          <div className="pb-3">
            <div className="text-[12px] text-muted-foreground mb-0.5">
              Portfolio value
            </div>
            <div className="text-[28px] font-bold tabular-nums">
              {totalValueUsd > 0 ? formatUsd(totalValueUsd) : "$0.00"}
            </div>
          </div>

          {/* Cash Balance */}
          <div className="pb-3">
            <div className="text-[12px] text-muted-foreground mb-1">
              Cash Balance
            </div>
            <div className="flex items-center justify-between">
              <div className="text-[18px] font-semibold tabular-nums">
                ${formattedUsdc}
              </div>
              <button
                onClick={() =>
                  mintUsdc({
                    address: CONTRACT_ADDRESSES.usdc as `0x${string}`,
                    abi: MOCK_MINT_ABI,
                    functionName: "mint",
                    args: [address!, parseUnits("1000", QUOTE_TOKEN_DECIMALS)],
                  })
                }
                disabled={isUsdcMinting}
                className="text-[12px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                {isUsdcMinting ? "Minting..." : "Mint 1000"}
              </button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-secondary px-4">
          <button
            onClick={() => setActiveTab("holdings")}
            className={`pb-2.5 px-1 mr-6 text-[14px] font-medium border-b-2 transition-colors ${
              activeTab === "holdings"
                ? "border-white text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Holdings
            {holdings.length > 0 && (
              <span className="ml-1.5 text-[12px] text-muted-foreground">
                {holdings.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("launched")}
            className={`pb-2.5 px-1 text-[14px] font-medium border-b-2 transition-colors ${
              activeTab === "launched"
                ? "border-white text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Launched
            {launchedRigs.length > 0 && (
              <span className="ml-1.5 text-[12px] text-muted-foreground">
                {launchedRigs.length}
              </span>
            )}
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-4">
          {activeTab === "holdings" && (
            <>
              {holdings.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center mb-3">
                    <svg
                      className="w-6 h-6 text-muted-foreground"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M3.75 9h16.5m-16.5 6h16.5m-15-9h13.5A2.25 2.25 0 0121 8.25v7.5A2.25 2.25 0 0118.75 18H5.25A2.25 2.25 0 013 15.75v-7.5A2.25 2.25 0 015.25 6z"
                      />
                    </svg>
                  </div>
                  <div className="text-[15px] font-medium mb-1">
                    No holdings yet
                  </div>
                  <div className="text-[13px] text-muted-foreground mb-4">
                    Mine, spin, or trade to earn coins
                  </div>
                  <Link
                    href="/explore"
                    className="px-4 py-2 rounded-xl bg-white text-black text-[13px] font-semibold hover:bg-zinc-200 transition-colors"
                  >
                    Explore coins
                  </Link>
                </div>
              ) : (
                <div className="py-1">
                  {holdings.map((holding) => (
                    <HoldingRow
                      key={holding.unitAddress}
                      holding={holding}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {activeTab === "launched" && (
            <>
              {launchedRigs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center mb-3">
                    <svg
                      className="w-6 h-6 text-muted-foreground"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"
                      />
                    </svg>
                  </div>
                  <div className="text-[15px] font-medium mb-1">
                    No launches yet
                  </div>
                  <div className="text-[13px] text-muted-foreground mb-4">
                    You haven&apos;t launched any coins yet
                  </div>
                  <Link
                    href="/launch"
                    className="px-4 py-2 rounded-xl bg-white text-black text-[13px] font-semibold hover:bg-zinc-200 transition-colors"
                  >
                    Launch a coin
                  </Link>
                </div>
              ) : (
                <div className="py-1">
                  {launchedRigs.map((rig) => (
                    <LaunchedRow
                      key={rig.address}
                      rig={rig}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <NavBar />
      </div>
    </main>
  );
}
