import { useCallback, useState, useEffect, useRef } from "react";
import {
  useSendCalls,
  useCallsStatus,
  useCapabilities,
} from "wagmi/experimental";
import {
  useWaitForTransactionReceipt,
  useSendTransaction,
} from "wagmi";
import type { Abi, Address } from "viem";
import { encodeFunctionData } from "viem";
import { DEFAULT_CHAIN_ID } from "@/lib/constants";

export type Call = {
  to: Address;
  data?: `0x${string}`;
  value?: bigint;
};

type BatchedTransactionState = "idle" | "pending" | "confirming" | "success" | "error";

/** Extract a short, user-friendly message from a viem/wagmi error. */
function friendlyError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err);
  if (/User rejected|User denied|rejected the request/i.test(raw)) {
    return new Error("Transaction cancelled.");
  }
  // Strip verbose "Request Arguments:" block that viem appends
  const stripped = raw.replace(/Request Arguments:[\s\S]*/i, "").trim();
  // Take only the first sentence / line for display
  const first = stripped.split("\n")[0].trim();
  return new Error(first || "Transaction failed.");
}

type UseBatchedTransactionReturn = {
  execute: (calls: Call[]) => Promise<void>;
  status: BatchedTransactionState;
  txHash: string | undefined;
  error: Error | null;
  reset: () => void;
  reportsCapability: boolean;
};

type CallsStatusWithReceipts = {
  receipts?: Array<{ transactionHash?: `0x${string}` }>;
};

/**
 * Hook for executing batched transactions using EIP-5792 when available,
 * with fallback to sequential transactions.
 */
export function useBatchedTransaction(): UseBatchedTransactionReturn {
  const [state, setState] = useState<BatchedTransactionState>("idle");
  const [error, setError] = useState<Error | null>(null);
  const [pendingCalls, setPendingCalls] = useState<Call[] | null>(null);
  const [currentCallIndex, setCurrentCallIndex] = useState(0);

  // EIP-5792 batching
  const { data: capabilities } = useCapabilities();
  const {
    sendCalls,
    data: batchId,
    isPending: isBatchPending,
    error: batchError,
    reset: resetBatch,
  } = useSendCalls();

  const { data: callsStatus } = useCallsStatus({
    id: batchId?.id ?? "",
    query: {
      enabled: !!batchId?.id,
      refetchInterval: (query) =>
        query.state.data?.status === "success" || query.state.data?.status === "failure" ? false : 1000,
    },
  });

  // Sequential fallback
  const {
    sendTransaction,
    data: seqTxHash,
    isPending: isSeqPending,
    error: seqError,
    reset: resetSeq,
  } = useSendTransaction();

  const { isLoading: isSeqConfirming, isSuccess: isSeqSuccess, isError: isSeqTxError } =
    useWaitForTransactionReceipt({
      hash: seqTxHash,
      chainId: DEFAULT_CHAIN_ID,
    });

  // Check if wallet reports atomic batching capability
  const chainCapabilities = capabilities?.[DEFAULT_CHAIN_ID];
  const reportsCapability =
    chainCapabilities?.atomicBatch?.supported === true ||
    chainCapabilities?.['wallet_sendCalls'] !== undefined ||
    Object.keys(chainCapabilities ?? {}).length > 0;


  // Track if we're in sequential mode
  const isSequentialMode = useRef(false);
  const lastProcessedIndex = useRef(-1);

  // Handle batch status changes
  useEffect(() => {
    if (!batchId?.id) return;

    // Status can be "pending", "success", or "failure"
    if (callsStatus?.status === "success") {
      setState("success");
      setPendingCalls(null);
    }
  }, [batchId, callsStatus]);

  // Handle batch errors - fall back to sequential if wallet doesn't support batching
  useEffect(() => {
    if (!batchError) return;

    // Check if this is a "method not supported" error - fall back to sequential
    const errorMessage = batchError.message || String(batchError);
    const isMethodNotSupported =
      errorMessage.includes('wallet_sendCalls') ||
      errorMessage.includes('does not exist') ||
      errorMessage.includes('not available') ||
      errorMessage.includes('MethodNotFound');

    if (isMethodNotSupported && pendingCalls && pendingCalls.length > 0) {
      // Wallet doesn't support batching, fall back to sequential
      resetBatch();
      isSequentialMode.current = true;
      const firstCall = pendingCalls[0];
      setCurrentCallIndex(0);
      lastProcessedIndex.current = -1;
      sendTransaction({
        to: firstCall.to,
        data: firstCall.data,
        value: firstCall.value ?? 0n,
        chainId: DEFAULT_CHAIN_ID,
      });
    } else {
      // Other error - just report it
      setError(friendlyError(batchError));
      setState("error");
      setPendingCalls(null);
    }
  }, [batchError, pendingCalls, resetBatch, sendTransaction]);

  // Handle sequential transaction completion
  useEffect(() => {
    if (!isSequentialMode.current || !pendingCalls) return;

    if (isSeqSuccess && currentCallIndex !== lastProcessedIndex.current) {
      lastProcessedIndex.current = currentCallIndex;
      const nextIndex = currentCallIndex + 1;

      if (nextIndex >= pendingCalls.length) {
        // All calls completed
        setState("success");
        setPendingCalls(null);
        isSequentialMode.current = false;
      } else {
        // Execute next call
        setCurrentCallIndex(nextIndex);
        const nextCall = pendingCalls[nextIndex];
        resetSeq();

        setTimeout(() => {
          sendTransaction({
            to: nextCall.to,
            data: nextCall.data,
            value: nextCall.value ?? 0n,
            chainId: DEFAULT_CHAIN_ID,
          });
        }, 100);
      }
    }
  }, [isSeqSuccess, currentCallIndex, pendingCalls, sendTransaction, resetSeq]);

  // Handle sequential errors
  useEffect(() => {
    if (seqError || isSeqTxError) {
      setError(friendlyError(seqError || new Error("Transaction failed")));
      setState("error");
      setPendingCalls(null);
      isSequentialMode.current = false;
    }
  }, [seqError, isSeqTxError]);

  // Update state based on pending status
  useEffect(() => {
    if (isBatchPending || isSeqPending) {
      setState("pending");
    } else if (isSeqConfirming) {
      setState("confirming");
    }
  }, [isBatchPending, isSeqPending, isSeqConfirming]);

  // Derive txHash from sequential or batch mode
  const batchTxHash =
    (callsStatus as CallsStatusWithReceipts | undefined)?.receipts?.[0]?.transactionHash;
  const txHash: string | undefined =
    seqTxHash ?? batchTxHash ?? undefined;

  const execute = useCallback(
    async (calls: Call[]) => {
      if (calls.length === 0) return;

      setError(null);
      setState("pending");
      setPendingCalls(calls);
      setCurrentCallIndex(0);
      lastProcessedIndex.current = -1;

      // Always try batched sendCalls first - many wallets support it without reporting capability
      isSequentialMode.current = false;
      try {
        await sendCalls({
          calls: calls.map((call) => ({
            to: call.to,
            data: call.data,
            value: call.value,
          })),
          chainId: DEFAULT_CHAIN_ID,
        });
      } catch {
        // If batching fails synchronously, fall back to sequential
        isSequentialMode.current = true;
        const firstCall = calls[0];
        sendTransaction({
          to: firstCall.to,
          data: firstCall.data,
          value: firstCall.value ?? 0n,
          chainId: DEFAULT_CHAIN_ID,
        });
      }
    },
    [sendCalls, sendTransaction]
  );

  const reset = useCallback(() => {
    setState("idle");
    setError(null);
    setPendingCalls(null);
    setCurrentCallIndex(0);
    lastProcessedIndex.current = -1;
    isSequentialMode.current = false;
    resetBatch();
    resetSeq();
  }, [resetBatch, resetSeq]);

  return {
    execute,
    status: state,
    txHash,
    error,
    reset,
    // Reports whether capability was detected (not whether batching will work)
    reportsCapability,
  };
}

/**
 * Helper to encode an ERC20 approve call
 */
export function encodeApproveCall(
  tokenAddress: Address,
  spender: Address,
  amount: bigint
): Call {
  const data = encodeFunctionData({
    abi: [
      {
        name: "approve",
        type: "function",
        inputs: [
          { name: "spender", type: "address" },
          { name: "amount", type: "uint256" },
        ],
        outputs: [{ type: "bool" }],
      },
    ],
    functionName: "approve",
    args: [spender, amount],
  });

  return {
    to: tokenAddress,
    data,
    value: 0n,
  };
}

/**
 * Helper to encode a contract call
 */
export function encodeContractCall(
  contractAddress: Address,
  abi: readonly unknown[],
  functionName: string,
  args: readonly unknown[],
  value?: bigint
): Call {
  const data = encodeFunctionData({
    abi: abi as Abi,
    functionName: functionName as never,
    args: args as never,
  });

  return {
    to: contractAddress,
    data,
    value: value ?? 0n,
  };
}
