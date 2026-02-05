import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import { base } from "wagmi/chains";
import { zeroAddress } from "viem";
import {
  CONTRACT_ADDRESSES,
  MULTICALL_ABI,
  type RigState,
} from "@/lib/contracts";

export type SlotDisplayState = {
  index: number;
  epochId: bigint;
  initPrice: bigint;
  epochStartTime: bigint;
  glazed: bigint;
  price: bigint;
  ups: bigint;
  upsMultiplier: bigint;
  nextUps: bigint;
  miner: `0x${string}`;
  slotUri: string;
  unitPrice: bigint;
  isAvailable: boolean;
};

export function useMultiSlotState(
  rigAddress: `0x${string}` | undefined,
  capacity: number,
  account: `0x${string}` | undefined
) {
  // Create contract calls for each slot
  const contracts = useMemo(() => {
    if (!rigAddress || capacity <= 0) return [];

    return Array.from({ length: capacity }, (_, index) => ({
      address: CONTRACT_ADDRESSES.multicall as `0x${string}`,
      abi: MULTICALL_ABI,
      functionName: "getRig" as const,
      args: [rigAddress, BigInt(index), account ?? zeroAddress] as const,
      chainId: base.id,
    }));
  }, [rigAddress, capacity, account]);

  const { data: results, refetch, isLoading, error } = useReadContracts({
    contracts,
    query: {
      enabled: contracts.length > 0,
      refetchInterval: 15_000,
      refetchOnWindowFocus: false,
    },
  });

  // Transform results into SlotDisplayState array
  const slotStates = useMemo((): SlotDisplayState[] => {
    if (!results) return [];

    return results.map((result, index) => {
      const state = result.result as RigState | undefined;

      if (!state) {
        return {
          index,
          epochId: 0n,
          initPrice: 0n,
          epochStartTime: 0n,
          glazed: 0n,
          price: 0n,
          ups: 0n,
          upsMultiplier: 1n,
          nextUps: 0n,
          miner: zeroAddress,
          slotUri: "",
          unitPrice: 0n,
          isAvailable: true,
        };
      }

      const isAvailable = state.miner === zeroAddress;

      return {
        index,
        epochId: state.epochId,
        initPrice: state.initPrice,
        epochStartTime: state.epochStartTime,
        glazed: state.glazed,
        price: state.price,
        ups: state.ups,
        upsMultiplier: state.upsMultiplier,
        nextUps: state.nextUps,
        miner: state.miner,
        slotUri: state.slotUri,
        unitPrice: state.unitPrice,
        isAvailable,
      };
    });
  }, [results]);

  // Count active slots (slots with miners)
  const activeSlotCount = useMemo(() => {
    return slotStates.filter(s => !s.isAvailable).length;
  }, [slotStates]);

  // Get full RigState for first slot (for shared rig data like rigUri, capacity, etc.)
  const firstSlotFullState = results?.[0]?.result as RigState | undefined;

  return {
    slotStates,
    activeSlotCount,
    rigState: firstSlotFullState, // Full state from slot 0 for shared data
    refetch,
    isLoading,
    error,
  };
}
