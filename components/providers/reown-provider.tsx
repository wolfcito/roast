"use client"

import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createAppKit } from "@reown/appkit/react"
import { avalanche, avalancheFuji, mainnet } from "@reown/appkit/networks"
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi"
import { WagmiProvider } from "wagmi"

const queryClient = new QueryClient()
const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "27242132bcfe5f9379ae555c71b26162"

const metadata = {
  name: "Repo Judge — Avalanche + WDK",
  description: "Static audit helper by GOOD WOLF Labs",
  url: process.env.NEXT_PUBLIC_APP_URL ?? "https://goodwolflabs.com",
  icons: ["https://avatars.githubusercontent.com/u/179229932"],
}

const networks = [avalanche, avalancheFuji, mainnet]

const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId,
  ssr: true,
})

createAppKit({
  adapters: [wagmiAdapter],
  networks,
  projectId,
  metadata,
  features: {
    analytics: true,
  },
})

export function ReownProvider({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  )
}
