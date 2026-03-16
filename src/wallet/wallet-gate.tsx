import { useState, type ReactNode } from 'react'
import { useWallet } from './use-wallet'
import { LdkProvider } from '../ldk/context'
import { OnchainProvider } from '../onchain/context'
import { MnemonicWordGrid } from '../components/MnemonicWordGrid'

function normalizeMnemonic(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z\s]/g, '')
}

function ImportWalletForm({ onImport }: { onImport: (mnemonic: string) => void }) {
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [masked, setMasked] = useState(true)

  const handleSubmit = () => {
    const normalized = normalizeMnemonic(input)
    if (!normalized) {
      setError('Please enter your 12-word recovery phrase.')
      return
    }
    const wordCount = normalized.split(' ').length
    if (wordCount !== 12 && wordCount !== 24) {
      setError(`Expected 12 or 24 words, got ${wordCount}.`)
      return
    }
    setError(null)
    setInput('')
    onImport(normalized)
  }

  return (
    <div className="w-full space-y-4">
      <div className="relative">
        <textarea
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            setError(null)
          }}
          placeholder="Enter your 12-word recovery phrase, separated by spaces"
          rows={3}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className={`w-full rounded-lg border bg-gray-900 px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            error ? 'border-red-500' : 'border-gray-700'
          } ${masked ? '[&]:[-webkit-text-security:disc] [&]:[text-security:disc]' : ''}`}
        />
        <button
          type="button"
          onClick={() => setMasked(!masked)}
          className="absolute right-2 top-2 rounded px-2 py-1 text-xs text-gray-400 hover:text-white"
        >
          {masked ? 'Show' : 'Hide'}
        </button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        onClick={handleSubmit}
        className="w-full rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
      >
        Import Wallet
      </button>
    </div>
  )
}

export function WalletGate({ children }: { children: ReactNode }) {
  const wallet = useWallet()
  const [importMode, setImportMode] = useState(false)

  if (wallet.status === 'loading') {
    return <div className="p-4 text-gray-400">Loading wallet...</div>
  }

  if (wallet.status === 'new') {
    if (importMode) {
      return (
        <div className="flex min-h-screen items-center justify-center">
          <div className="max-w-md space-y-4 text-center">
            <h1 className="text-2xl font-bold">Import Wallet</h1>
            <p className="text-gray-400">
              Enter your recovery phrase to restore an existing wallet.
            </p>
            <ImportWalletForm onImport={wallet.importWallet} />
            <button
              onClick={() => setImportMode(false)}
              className="text-sm text-gray-400 hover:text-white"
            >
              Back
            </button>
          </div>
        </div>
      )
    }

    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="max-w-md space-y-4 text-center">
          <h1 className="text-2xl font-bold">Welcome</h1>
          <p className="text-gray-400">Create a new wallet or import an existing one.</p>
          <div className="flex gap-4 justify-center">
            <button
              onClick={wallet.createWallet}
              className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
            >
              Create Wallet
            </button>
            <button
              onClick={() => setImportMode(true)}
              className="rounded border border-gray-600 px-4 py-2 text-gray-300 hover:bg-gray-800"
            >
              Import Wallet
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (wallet.status === 'backup') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="max-w-md space-y-4 text-center">
          <h1 className="text-2xl font-bold">Back Up Your Mnemonic</h1>
          <p className="text-gray-400">
            Write down these 12 words in order. They are the only way to recover your wallet.
          </p>
          <MnemonicWordGrid words={wallet.mnemonic.split(' ')} />
          <button
            onClick={() => void wallet.confirmBackup()}
            className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            I&apos;ve Written It Down
          </button>
        </div>
      </div>
    )
  }

  if (wallet.status === 'error') {
    return <div className="p-4 text-red-400">Wallet error: {wallet.error.message}</div>
  }

  // status === 'ready' — render providers with derived keys, then children
  return (
    <LdkProvider ldkSeed={wallet.ldkSeed}>
      <OnchainProvider bdkDescriptors={wallet.bdkDescriptors}>{children}</OnchainProvider>
    </LdkProvider>
  )
}
