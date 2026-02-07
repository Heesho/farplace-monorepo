"use client";

import { ReactNode, useState } from "react";
import { WagmiProvider, useAccount, useChainId, useSwitchChain } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "@/lib/wagmi";
import { DEFAULT_CHAIN_ID } from "@/lib/constants";

type ProvidersProps = {
  children: ReactNode;
};

function NetworkGuard({ children }: { children: ReactNode }) {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  if (isConnected && chainId !== DEFAULT_CHAIN_ID) {
    return (
      <div style={{ padding: "20px", textAlign: "center" }}>
        <p style={{ marginBottom: "12px", fontSize: "16px" }}>
          Please switch to Base to use this app.
        </p>
        <button
          onClick={() => switchChain({ chainId: DEFAULT_CHAIN_ID })}
          style={{
            padding: "10px 24px",
            borderRadius: "8px",
            background: "#0052FF",
            color: "#fff",
            border: "none",
            cursor: "pointer",
            fontSize: "14px",
            fontWeight: 600,
          }}
        >
          Switch to Base
        </button>
      </div>
    );
  }

  return <>{children}</>;
}

export function Providers({ children }: ProvidersProps) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <NetworkGuard>{children}</NetworkGuard>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
