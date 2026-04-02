import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { router } from './routes/router'
import { WalletProvider } from './wallet/context'
import { WalletGate } from './wallet/wallet-gate'
import './index.css'

if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js', { scope: '/' })
}

const root = document.getElementById('root')
if (!root) {
  throw new Error('Root element #root not found. Check index.html.')
}

createRoot(root).render(
  <StrictMode>
    <WalletProvider>
      <WalletGate>
        <RouterProvider router={router} />
      </WalletGate>
    </WalletProvider>
  </StrictMode>
)
