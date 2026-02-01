import { parseAbi } from "viem";
import "dotenv/config";

// ---------------------------------------------------------------------------
// Contract addresses
// ---------------------------------------------------------------------------

export const ADDRESSES = {
  mineCore: "0xee347D06436D0995abe28d5CE8ab402e79958D1e",
  spinCore: "0xF6515c81C8e9Fa40f56cf6882f096825730cabD0",
  fundCore: "0x5536baD2ec14EbeD83038AF448620634B452185b",
  mineMulticall: "0x1fE3B4f47D5B4824620676Aa2B8bd48007D36207",
  spinMulticall: "0x76eE857c437b9cb7EA12a4fBb0BfCD5098a387A2",
  fundMulticall: "0x103161203A302E6e79f516d04848b376dE0A2C03",
  usdc: "0xe90495BE187d434e23A9B1FeC0B6Ce039700870e",
  uniV2Router: "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24",
  uniV2Factory: "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6",
} as const;

// ---------------------------------------------------------------------------
// ABIs — copied verbatim from packages/app/lib/contracts.ts
// ---------------------------------------------------------------------------

// Core contract ABI - for reading deployed rigs and their mappings
export const CORE_ABI = [
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "deployedRigs",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "deployedRigsLength",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "isDeployedRig",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "rigToLauncher",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "rigToUnit",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "rigToAuction",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "rigToLP",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "rigToQuote",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "minUsdcForLaunch",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "usdcToken",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "protocolFeeAddress",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "entropy",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "uniswapV2Factory",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "uniswapV2Router",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// Multicall ABI - for batched operations and state queries
export const MULTICALL_ABI = [
  // Mine function - mine a rig slot using quote token (e.g., USDC)
  {
    inputs: [
      { internalType: "address", name: "rig", type: "address" },
      { internalType: "uint256", name: "index", type: "uint256" },
      { internalType: "uint256", name: "epochId", type: "uint256" },
      { internalType: "uint256", name: "deadline", type: "uint256" },
      { internalType: "uint256", name: "maxPrice", type: "uint256" },
      { internalType: "string", name: "slotUri", type: "string" },
    ],
    name: "mine",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  // Mine multiple slots
  {
    inputs: [
      { internalType: "address", name: "rig", type: "address" },
      {
        components: [
          { internalType: "uint256", name: "index", type: "uint256" },
          { internalType: "uint256", name: "epochId", type: "uint256" },
          { internalType: "uint256", name: "maxPrice", type: "uint256" },
          { internalType: "string", name: "slotUri", type: "string" },
        ],
        internalType: "struct Multicall.MineParams[]",
        name: "params",
        type: "tuple[]",
      },
      { internalType: "uint256", name: "deadline", type: "uint256" },
    ],
    name: "mineMultiple",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  // Buy function - buy from auction using LP tokens
  {
    inputs: [
      { internalType: "address", name: "rig", type: "address" },
      { internalType: "uint256", name: "epochId", type: "uint256" },
      { internalType: "uint256", name: "deadline", type: "uint256" },
      { internalType: "uint256", name: "maxPaymentTokenAmount", type: "uint256" },
    ],
    name: "buy",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // Launch function - launch a new rig
  {
    inputs: [
      {
        components: [
          { internalType: "address", name: "launcher", type: "address" },
          { internalType: "address", name: "quoteToken", type: "address" },
          { internalType: "string", name: "tokenName", type: "string" },
          { internalType: "string", name: "tokenSymbol", type: "string" },
          { internalType: "string", name: "uri", type: "string" },
          { internalType: "uint256", name: "usdcAmount", type: "uint256" },
          { internalType: "uint256", name: "unitAmount", type: "uint256" },
          { internalType: "uint256", name: "initialUps", type: "uint256" },
          { internalType: "uint256", name: "tailUps", type: "uint256" },
          { internalType: "uint256", name: "halvingAmount", type: "uint256" },
          { internalType: "uint256", name: "rigEpochPeriod", type: "uint256" },
          { internalType: "uint256", name: "rigPriceMultiplier", type: "uint256" },
          { internalType: "uint256", name: "rigMinInitPrice", type: "uint256" },
          { internalType: "uint256[]", name: "upsMultipliers", type: "uint256[]" },
          { internalType: "uint256", name: "upsMultiplierDuration", type: "uint256" },
          { internalType: "uint256", name: "auctionInitPrice", type: "uint256" },
          { internalType: "uint256", name: "auctionEpochPeriod", type: "uint256" },
          { internalType: "uint256", name: "auctionPriceMultiplier", type: "uint256" },
          { internalType: "uint256", name: "auctionMinInitPrice", type: "uint256" },
        ],
        internalType: "struct ICore.LaunchParams",
        name: "params",
        type: "tuple",
      },
    ],
    name: "launch",
    outputs: [
      { internalType: "address", name: "unit", type: "address" },
      { internalType: "address", name: "rig", type: "address" },
      { internalType: "address", name: "auction", type: "address" },
      { internalType: "address", name: "lpToken", type: "address" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  // getRig function - get aggregated rig slot state
  {
    inputs: [
      { internalType: "address", name: "rig", type: "address" },
      { internalType: "uint256", name: "index", type: "uint256" },
      { internalType: "address", name: "account", type: "address" },
    ],
    name: "getRig",
    outputs: [
      {
        components: [
          { internalType: "uint256", name: "epochId", type: "uint256" },
          { internalType: "uint256", name: "initPrice", type: "uint256" },
          { internalType: "uint256", name: "epochStartTime", type: "uint256" },
          { internalType: "uint256", name: "glazed", type: "uint256" },
          { internalType: "uint256", name: "price", type: "uint256" },
          { internalType: "uint256", name: "ups", type: "uint256" },
          { internalType: "uint256", name: "upsMultiplier", type: "uint256" },
          { internalType: "address", name: "miner", type: "address" },
          { internalType: "string", name: "slotUri", type: "string" },
          { internalType: "bool", name: "needsEntropy", type: "bool" },
          { internalType: "uint256", name: "entropyFee", type: "uint256" },
          { internalType: "uint256", name: "nextUps", type: "uint256" },
          { internalType: "uint256", name: "unitPrice", type: "uint256" },
          { internalType: "string", name: "rigUri", type: "string" },
          { internalType: "uint256", name: "capacity", type: "uint256" },
          { internalType: "uint256", name: "accountQuoteBalance", type: "uint256" },
          { internalType: "uint256", name: "accountUsdcBalance", type: "uint256" },
          { internalType: "uint256", name: "accountUnitBalance", type: "uint256" },
          { internalType: "uint256", name: "accountClaimable", type: "uint256" },
        ],
        internalType: "struct Multicall.RigState",
        name: "state",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  // getRigMultiple function - get multiple slots' state
  {
    inputs: [
      { internalType: "address", name: "rig", type: "address" },
      { internalType: "uint256[]", name: "indices", type: "uint256[]" },
      { internalType: "address", name: "account", type: "address" },
    ],
    name: "getRigMultiple",
    outputs: [
      {
        components: [
          { internalType: "uint256", name: "epochId", type: "uint256" },
          { internalType: "uint256", name: "initPrice", type: "uint256" },
          { internalType: "uint256", name: "epochStartTime", type: "uint256" },
          { internalType: "uint256", name: "glazed", type: "uint256" },
          { internalType: "uint256", name: "price", type: "uint256" },
          { internalType: "uint256", name: "ups", type: "uint256" },
          { internalType: "uint256", name: "upsMultiplier", type: "uint256" },
          { internalType: "address", name: "miner", type: "address" },
          { internalType: "string", name: "slotUri", type: "string" },
          { internalType: "bool", name: "needsEntropy", type: "bool" },
          { internalType: "uint256", name: "entropyFee", type: "uint256" },
          { internalType: "uint256", name: "nextUps", type: "uint256" },
          { internalType: "uint256", name: "unitPrice", type: "uint256" },
          { internalType: "string", name: "rigUri", type: "string" },
          { internalType: "uint256", name: "capacity", type: "uint256" },
          { internalType: "uint256", name: "accountQuoteBalance", type: "uint256" },
          { internalType: "uint256", name: "accountUsdcBalance", type: "uint256" },
          { internalType: "uint256", name: "accountUnitBalance", type: "uint256" },
          { internalType: "uint256", name: "accountClaimable", type: "uint256" },
        ],
        internalType: "struct Multicall.RigState[]",
        name: "states",
        type: "tuple[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  // getAuction function - get aggregated auction state
  {
    inputs: [
      { internalType: "address", name: "rig", type: "address" },
      { internalType: "address", name: "account", type: "address" },
    ],
    name: "getAuction",
    outputs: [
      {
        components: [
          { internalType: "uint256", name: "epochId", type: "uint256" },
          { internalType: "uint256", name: "initPrice", type: "uint256" },
          { internalType: "uint256", name: "startTime", type: "uint256" },
          { internalType: "address", name: "paymentToken", type: "address" },
          { internalType: "uint256", name: "price", type: "uint256" },
          { internalType: "uint256", name: "paymentTokenPrice", type: "uint256" },
          { internalType: "uint256", name: "quoteAccumulated", type: "uint256" },
          { internalType: "uint256", name: "accountQuoteBalance", type: "uint256" },
          { internalType: "uint256", name: "accountPaymentTokenBalance", type: "uint256" },
        ],
        internalType: "struct Multicall.AuctionState",
        name: "state",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  // estimateMineMultipleCost function
  {
    inputs: [
      { internalType: "address", name: "rig", type: "address" },
      { internalType: "uint256[]", name: "indices", type: "uint256[]" },
    ],
    name: "estimateMineMultipleCost",
    outputs: [
      { internalType: "uint256", name: "totalEntropyFee", type: "uint256" },
      { internalType: "uint256", name: "totalQuoteNeeded", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  // Core and token addresses
  {
    inputs: [],
    name: "core",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "usdc",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// SpinMulticall ABI - for spin rig batched operations and state queries
export const SPIN_MULTICALL_ABI = [
  // getRig function - get aggregated spin rig state
  {
    inputs: [
      { internalType: "address", name: "rig", type: "address" },
      { internalType: "address", name: "account", type: "address" },
    ],
    name: "getRig",
    outputs: [
      {
        components: [
          { internalType: "uint256", name: "epochId", type: "uint256" },
          { internalType: "uint256", name: "initPrice", type: "uint256" },
          { internalType: "uint256", name: "spinStartTime", type: "uint256" },
          { internalType: "uint256", name: "price", type: "uint256" },
          { internalType: "uint256", name: "ups", type: "uint256" },
          { internalType: "uint256", name: "prizePool", type: "uint256" },
          { internalType: "uint256", name: "pendingEmissions", type: "uint256" },
          { internalType: "uint256", name: "entropyFee", type: "uint256" },
          { internalType: "uint256", name: "unitPrice", type: "uint256" },
          { internalType: "string", name: "rigUri", type: "string" },
          { internalType: "uint256", name: "accountQuoteBalance", type: "uint256" },
          { internalType: "uint256", name: "accountUsdcBalance", type: "uint256" },
          { internalType: "uint256", name: "accountUnitBalance", type: "uint256" },
        ],
        internalType: "struct SpinMulticall.SpinRigState",
        name: "state",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  // spin function - spin the slot machine
  {
    inputs: [
      { internalType: "address", name: "rig", type: "address" },
      { internalType: "uint256", name: "epochId", type: "uint256" },
      { internalType: "uint256", name: "deadline", type: "uint256" },
      { internalType: "uint256", name: "maxPrice", type: "uint256" },
    ],
    name: "spin",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  // getOdds function - get the odds array for a spin rig
  {
    inputs: [
      { internalType: "address", name: "rig", type: "address" },
    ],
    name: "getOdds",
    outputs: [
      { internalType: "uint256[]", name: "", type: "uint256[]" },
    ],
    stateMutability: "view",
    type: "function",
  },
  // getEntropyFee function - get the entropy fee for a spin rig
  {
    inputs: [
      { internalType: "address", name: "rig", type: "address" },
    ],
    name: "getEntropyFee",
    outputs: [
      { internalType: "uint256", name: "", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  // getAuction function - get aggregated auction state
  {
    inputs: [
      { internalType: "address", name: "rig", type: "address" },
      { internalType: "address", name: "account", type: "address" },
    ],
    name: "getAuction",
    outputs: [
      {
        components: [
          { internalType: "uint256", name: "epochId", type: "uint256" },
          { internalType: "uint256", name: "initPrice", type: "uint256" },
          { internalType: "uint256", name: "startTime", type: "uint256" },
          { internalType: "address", name: "paymentToken", type: "address" },
          { internalType: "uint256", name: "price", type: "uint256" },
          { internalType: "uint256", name: "paymentTokenPrice", type: "uint256" },
          { internalType: "uint256", name: "quoteAccumulated", type: "uint256" },
          { internalType: "uint256", name: "accountQuoteBalance", type: "uint256" },
          { internalType: "uint256", name: "accountPaymentTokenBalance", type: "uint256" },
        ],
        internalType: "struct SpinMulticall.AuctionState",
        name: "state",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  // buy function - buy from auction using LP tokens
  {
    inputs: [
      { internalType: "address", name: "rig", type: "address" },
      { internalType: "uint256", name: "epochId", type: "uint256" },
      { internalType: "uint256", name: "deadline", type: "uint256" },
      { internalType: "uint256", name: "maxPaymentTokenAmount", type: "uint256" },
    ],
    name: "buy",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

// FundMulticall ABI - for fund rig batched operations and state queries
export const FUND_MULTICALL_ABI = [
  // getRig function - get aggregated fund rig state
  {
    inputs: [
      { internalType: "address", name: "rig", type: "address" },
      { internalType: "address", name: "account", type: "address" },
    ],
    name: "getRig",
    outputs: [
      {
        components: [
          { internalType: "uint256", name: "currentDay", type: "uint256" },
          { internalType: "uint256", name: "todayEmission", type: "uint256" },
          { internalType: "uint256", name: "todayTotalDonated", type: "uint256" },
          { internalType: "uint256", name: "startTime", type: "uint256" },
          { internalType: "address", name: "treasury", type: "address" },
          { internalType: "address", name: "team", type: "address" },
          { internalType: "uint256", name: "unitPrice", type: "uint256" },
          { internalType: "string", name: "rigUri", type: "string" },
          { internalType: "uint256", name: "accountPaymentTokenBalance", type: "uint256" },
          { internalType: "uint256", name: "accountUsdcBalance", type: "uint256" },
          { internalType: "uint256", name: "accountUnitBalance", type: "uint256" },
          { internalType: "uint256", name: "accountTodayDonation", type: "uint256" },
        ],
        internalType: "struct FundMulticall.FundRigState",
        name: "state",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  // fund function - donate to a fund rig
  {
    inputs: [
      { internalType: "address", name: "rig", type: "address" },
      { internalType: "address", name: "account", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "fund",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // claim function - claim rewards for a specific day
  {
    inputs: [
      { internalType: "address", name: "rig", type: "address" },
      { internalType: "address", name: "account", type: "address" },
      { internalType: "uint256", name: "day", type: "uint256" },
    ],
    name: "claim",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // claimMultiple function - claim rewards for multiple days
  {
    inputs: [
      { internalType: "address", name: "rig", type: "address" },
      { internalType: "address", name: "account", type: "address" },
      { internalType: "uint256[]", name: "dayIds", type: "uint256[]" },
    ],
    name: "claimMultiple",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // getClaimableDays function - get claimable day info for a range
  {
    inputs: [
      { internalType: "address", name: "rig", type: "address" },
      { internalType: "address", name: "account", type: "address" },
      { internalType: "uint256", name: "startDay", type: "uint256" },
      { internalType: "uint256", name: "endDay", type: "uint256" },
    ],
    name: "getClaimableDays",
    outputs: [
      {
        components: [
          { internalType: "uint256", name: "day", type: "uint256" },
          { internalType: "uint256", name: "donation", type: "uint256" },
          { internalType: "uint256", name: "pendingReward", type: "uint256" },
          { internalType: "bool", name: "hasClaimed", type: "bool" },
        ],
        internalType: "struct FundMulticall.ClaimableDay[]",
        name: "days",
        type: "tuple[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  // getTotalPendingRewards function - get total pending rewards for a range
  {
    inputs: [
      { internalType: "address", name: "rig", type: "address" },
      { internalType: "address", name: "account", type: "address" },
      { internalType: "uint256", name: "startDay", type: "uint256" },
      { internalType: "uint256", name: "endDay", type: "uint256" },
    ],
    name: "getTotalPendingRewards",
    outputs: [
      { internalType: "uint256", name: "totalPending", type: "uint256" },
      { internalType: "uint256[]", name: "unclaimedDays", type: "uint256[]" },
    ],
    stateMutability: "view",
    type: "function",
  },
  // getAuction function - get aggregated auction state
  {
    inputs: [
      { internalType: "address", name: "rig", type: "address" },
      { internalType: "address", name: "account", type: "address" },
    ],
    name: "getAuction",
    outputs: [
      {
        components: [
          { internalType: "uint256", name: "epochId", type: "uint256" },
          { internalType: "uint256", name: "initPrice", type: "uint256" },
          { internalType: "uint256", name: "startTime", type: "uint256" },
          { internalType: "address", name: "paymentToken", type: "address" },
          { internalType: "uint256", name: "price", type: "uint256" },
          { internalType: "uint256", name: "paymentTokenPrice", type: "uint256" },
          { internalType: "uint256", name: "quoteAccumulated", type: "uint256" },
          { internalType: "uint256", name: "accountQuoteBalance", type: "uint256" },
          { internalType: "uint256", name: "accountPaymentTokenBalance", type: "uint256" },
        ],
        internalType: "struct FundMulticall.AuctionState",
        name: "state",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  // buy function - buy from auction using LP tokens
  {
    inputs: [
      { internalType: "address", name: "rig", type: "address" },
      { internalType: "uint256", name: "epochId", type: "uint256" },
      { internalType: "uint256", name: "deadline", type: "uint256" },
      { internalType: "uint256", name: "maxPaymentTokenAmount", type: "uint256" },
    ],
    name: "buy",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

// ERC20 ABI - for token interactions
export const ERC20_ABI = [
  {
    inputs: [],
    name: "name",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ internalType: "uint8", name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalSupply",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "spender", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "owner", type: "address" },
      { internalType: "address", name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// Rig contract ABI - for direct rig reads if needed
export const RIG_ABI = [
  // Mine function - mine a rig slot
  {
    inputs: [
      { internalType: "address", name: "miner", type: "address" },
      { internalType: "uint256", name: "index", type: "uint256" },
      { internalType: "uint256", name: "epochId", type: "uint256" },
      { internalType: "uint256", name: "deadline", type: "uint256" },
      { internalType: "uint256", name: "maxPrice", type: "uint256" },
      { internalType: "string", name: "_uri", type: "string" },
    ],
    name: "mine",
    outputs: [{ internalType: "uint256", name: "price", type: "uint256" }],
    stateMutability: "payable",
    type: "function",
  },
  // Claim function - claim accumulated miner fees (pull pattern)
  {
    inputs: [{ internalType: "address", name: "account", type: "address" }],
    name: "claim",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "index", type: "uint256" }],
    name: "getSlot",
    outputs: [
      {
        components: [
          { internalType: "uint256", name: "epochId", type: "uint256" },
          { internalType: "uint256", name: "initPrice", type: "uint256" },
          { internalType: "uint256", name: "startTime", type: "uint256" },
          { internalType: "uint256", name: "ups", type: "uint256" },
          { internalType: "uint256", name: "upsMultiplier", type: "uint256" },
          { internalType: "uint256", name: "lastUpsMultiplierTime", type: "uint256" },
          { internalType: "address", name: "miner", type: "address" },
          { internalType: "string", name: "uri", type: "string" },
        ],
        internalType: "struct IRig.Slot",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "index", type: "uint256" }],
    name: "getPrice",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getUps",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "capacity",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "uri",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "unit",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "quote",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "treasury",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "team",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "startTime",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "initialUps",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "tailUps",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "halvingAmount",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "epochPeriod",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "priceMultiplier",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "minInitPrice",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "isMultipliersEnabled",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "upsMultiplierDuration",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getEntropyFee",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "account", type: "address" }],
    name: "accountToClaimable",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalMinted",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getUpsMultipliers",
    outputs: [{ internalType: "uint256[]", name: "", type: "uint256[]" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getUpsMultipliersLength",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// Auction contract ABI
export const AUCTION_ABI = [
  {
    inputs: [],
    name: "epochId",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "initPrice",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "startTime",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getPrice",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "paymentToken",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "paymentReceiver",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "epochPeriod",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "priceMultiplier",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "minInitPrice",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// Uniswap V2 Router ABI (only addLiquidity)
export const UNIV2_ROUTER_ABI = [
  {
    inputs: [
      { internalType: "address", name: "tokenA", type: "address" },
      { internalType: "address", name: "tokenB", type: "address" },
      { internalType: "uint256", name: "amountADesired", type: "uint256" },
      { internalType: "uint256", name: "amountBDesired", type: "uint256" },
      { internalType: "uint256", name: "amountAMin", type: "uint256" },
      { internalType: "uint256", name: "amountBMin", type: "uint256" },
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "deadline", type: "uint256" },
    ],
    name: "addLiquidity",
    outputs: [
      { internalType: "uint256", name: "amountA", type: "uint256" },
      { internalType: "uint256", name: "amountB", type: "uint256" },
      { internalType: "uint256", name: "liquidity", type: "uint256" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

// Uniswap V2 Pair ABI (for getReserves)
export const UNIV2_PAIR_ABI = [
  {
    inputs: [],
    name: "getReserves",
    outputs: [
      { internalType: "uint112", name: "reserve0", type: "uint112" },
      { internalType: "uint112", name: "reserve1", type: "uint112" },
      { internalType: "uint32", name: "blockTimestampLast", type: "uint32" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "token0",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "token1",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalSupply",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// ---------------------------------------------------------------------------
// Additional ABIs (not in contracts.ts)
// ---------------------------------------------------------------------------

export const MOCK_TOKEN_ABI = parseAbi([
  "function mint(address to, uint256 amount) external",
]);

export const UNIV2_SWAP_ABI = parseAbi([
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)",
  "function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RigType = "mine" | "spin" | "fund";

export type AgentConfig = {
  name: string;
  privateKey: `0x${string}`;
  rigs: `0x${string}`[];
  heartbeatRange: [number, number];
  maxPricePercent: number;
  maxSpendPercent: number;
  auctionMinDiscount: number;
};

// ---------------------------------------------------------------------------
// Config loader
// ---------------------------------------------------------------------------

export function loadAgentConfigs(): AgentConfig[] {
  const keys = (process.env.AGENT_KEYS ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  const rigs = (process.env.TARGET_RIGS ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean) as `0x${string}`[];

  const heartbeatMin = Number(process.env.HEARTBEAT_MIN ?? "30");
  const heartbeatMax = Number(process.env.HEARTBEAT_MAX ?? "60");
  const maxPricePercent = Number(process.env.MAX_PRICE_PERCENT ?? "40");
  const maxSpendPercent = Number(process.env.MAX_SPEND_PERCENT ?? "10");
  const auctionMinDiscount = Number(process.env.AUCTION_MIN_DISCOUNT ?? "20");

  return keys.map((key, i) => ({
    name: `agent-${i}`,
    privateKey: key as `0x${string}`,
    rigs,
    heartbeatRange: [heartbeatMin, heartbeatMax] as [number, number],
    maxPricePercent,
    maxSpendPercent,
    auctionMinDiscount,
  }));
}
