import { describe, it, expect } from 'vitest'
import { msatToSatFloor, msatToSatCeil } from './msat'

describe('msatToSatFloor', () => {
  it('converts exact multiples', () => {
    expect(msatToSatFloor(5000n)).toBe(5n)
    expect(msatToSatFloor(1000n)).toBe(1n)
    expect(msatToSatFloor(0n)).toBe(0n)
  })

  it('floors sub-sat remainders', () => {
    expect(msatToSatFloor(1999n)).toBe(1n)
    expect(msatToSatFloor(1001n)).toBe(1n)
    expect(msatToSatFloor(999n)).toBe(0n)
    expect(msatToSatFloor(1n)).toBe(0n)
  })

  it('handles large values', () => {
    expect(msatToSatFloor(100_000_000_000n)).toBe(100_000_000n)
    expect(msatToSatFloor(100_000_000_999n)).toBe(100_000_000n)
  })
})

describe('msatToSatCeil', () => {
  it('converts exact multiples', () => {
    expect(msatToSatCeil(5000n)).toBe(5n)
    expect(msatToSatCeil(1000n)).toBe(1n)
    expect(msatToSatCeil(0n)).toBe(0n)
  })

  it('rounds up sub-sat remainders', () => {
    expect(msatToSatCeil(1999n)).toBe(2n)
    expect(msatToSatCeil(1001n)).toBe(2n)
    expect(msatToSatCeil(999n)).toBe(1n)
    expect(msatToSatCeil(1n)).toBe(1n)
  })

  it('handles large values', () => {
    expect(msatToSatCeil(100_000_000_000n)).toBe(100_000_000n)
    expect(msatToSatCeil(100_000_000_001n)).toBe(100_000_001n)
  })
})
