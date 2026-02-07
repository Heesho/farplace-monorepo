import { useReadContracts } from "wagmi";
import { base } from "wagmi/chains";
import { CONTRACT_ADDRESSES, CORE_ABI, type RigType } from "@/lib/contracts";

export function useRigType(rigAddress: `0x${string}` | undefined): {
  rigType: RigType | undefined;
  isLoading: boolean;
} {
  const { data, isLoading } = useReadContracts({
    contracts: [
      {
        address: CONTRACT_ADDRESSES.mineCore as `0x${string}`,
        abi: CORE_ABI,
        functionName: "rigToIsRig",
        args: rigAddress ? [rigAddress] : undefined,
        chainId: base.id,
      },
      {
        address: CONTRACT_ADDRESSES.spinCore as `0x${string}`,
        abi: CORE_ABI,
        functionName: "rigToIsRig",
        args: rigAddress ? [rigAddress] : undefined,
        chainId: base.id,
      },
      {
        address: CONTRACT_ADDRESSES.fundCore as `0x${string}`,
        abi: CORE_ABI,
        functionName: "rigToIsRig",
        args: rigAddress ? [rigAddress] : undefined,
        chainId: base.id,
      },
    ],
    query: { enabled: !!rigAddress, staleTime: Infinity },
  });

  let rigType: RigType | undefined;
  if (data) {
    if (data[0]?.result === true) rigType = "mine";
    else if (data[1]?.result === true) rigType = "spin";
    else if (data[2]?.result === true) rigType = "fund";
  }

  return { rigType, isLoading };
}
