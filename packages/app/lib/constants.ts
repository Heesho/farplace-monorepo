import { base } from "wagmi/chains";

// Timing constants
export const PRICE_CACHE_TTL_MS = 60_000; // 1 minute
export const PRICE_REFETCH_INTERVAL_MS = 60_000; // 1 minute

// Query stale times
export const STALE_TIME_SHORT_MS = 10_000; // 10 seconds
export const STALE_TIME_MEDIUM_MS = 15_000; // 15 seconds
export const STALE_TIME_LONG_MS = 30_000; // 30 seconds
export const STALE_TIME_PROFILE_MS = 60_000; // 1 minute

// Transaction settings
export const DEADLINE_BUFFER_SECONDS = 15 * 60; // 15 minutes

// Token decimals
export const TOKEN_DECIMALS = 18;

// Chain configuration
export const DEFAULT_CHAIN_ID = base.id;

// Default price fallbacks (USD)
export const DEFAULT_ETH_PRICE_USD = 3500;

// IPFS/Pinata
export const PINATA_GATEWAY = process.env.NEXT_PUBLIC_PINATA_GATEWAY || "https://gateway.pinata.cloud";
export const PINATA_GATEWAY_KEY = process.env.NEXT_PUBLIC_PINATA_GATEWAY_KEY || "";

// Helper to convert IPFS URI to HTTP URL with gateway token
export function ipfsToHttp(uri: string): string {
  if (!uri) return "";
  if (uri.startsWith("ipfs://")) {
    const cid = uri.slice(7);
    const baseUrl = `${PINATA_GATEWAY}/ipfs/${cid}`;
    return PINATA_GATEWAY_KEY ? `${baseUrl}?pinataGatewayToken=${PINATA_GATEWAY_KEY}` : baseUrl;
  }
  // Handle URLs without protocol (e.g., "domain.com/path") - prepend https://
  if (!uri.startsWith("http://") && !uri.startsWith("https://") && uri.includes(".")) {
    return `https://${uri}`;
  }
  return uri;
}

// File upload limits
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

