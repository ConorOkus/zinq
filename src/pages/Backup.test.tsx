import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Backup } from './Backup'

vi.mock('../wallet/mnemonic', () => ({
  getMnemonic: vi.fn(),
}))

import { getMnemonic } from '../wallet/mnemonic'

const TEST_MNEMONIC =
  'abandon ability able about above absent absorb abstract absurd abuse access accident'

function renderBackup() {
  return render(
    <MemoryRouter>
      <Backup />
    </MemoryRouter>
  )
}

describe('Backup', () => {
  beforeEach(() => {
    vi.mocked(getMnemonic).mockReset()
  })

  it('shows warning screen on initial render', () => {
    renderBackup()
    expect(screen.getByText(/your recovery phrase is the master key/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reveal seed phrase/i })).toBeInTheDocument()
  })

  it('reveals seed phrase after tapping reveal button', async () => {
    vi.mocked(getMnemonic).mockResolvedValue(TEST_MNEMONIC)
    const user = userEvent.setup()
    renderBackup()

    await user.click(screen.getByRole('button', { name: /reveal seed phrase/i }))

    expect(screen.getByText('abandon')).toBeInTheDocument()
    expect(screen.getByText('accident')).toBeInTheDocument()
    expect(screen.getByText('1.')).toBeInTheDocument()
    expect(screen.getByText('12.')).toBeInTheDocument()
  })

  it('shows error when getMnemonic returns undefined', async () => {
    vi.mocked(getMnemonic).mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderBackup()

    await user.click(screen.getByRole('button', { name: /reveal seed phrase/i }))

    expect(screen.getByText(/unable to retrieve seed phrase/i)).toBeInTheDocument()
  })

  it('shows generic error when getMnemonic rejects', async () => {
    vi.mocked(getMnemonic).mockRejectedValue(new Error('DB corrupted'))
    const user = userEvent.setup()
    renderBackup()

    await user.click(screen.getByRole('button', { name: /reveal seed phrase/i }))

    expect(screen.getByText(/unable to retrieve seed phrase/i)).toBeInTheDocument()
    expect(screen.queryByText('DB corrupted')).not.toBeInTheDocument()
  })
})
