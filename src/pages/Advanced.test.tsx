import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, it, expect } from 'vitest'
import { Advanced } from './Advanced'

function renderAdvanced() {
  return render(
    <MemoryRouter>
      <Advanced />
    </MemoryRouter>,
  )
}

describe('Advanced', () => {
  it('renders navigation items', () => {
    renderAdvanced()
    expect(screen.getByText('Balance')).toBeInTheDocument()
    expect(screen.getByText('Peers')).toBeInTheDocument()
    expect(screen.getByText('BOLT 12 Offer')).toBeInTheDocument()
  })
})
