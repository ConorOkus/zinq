import { describe, it, expect, vi } from 'vitest'

// Mock lightningdevkit since we can't load WASM in tests
vi.mock('lightningdevkit', () => {
  class MockHumanReadableName {
    _user: string
    _domain: string
    constructor(user: string, domain: string) {
      this._user = user
      this._domain = domain
    }
    user() { return this._user }
    domain() { return this._domain }
  }

  class Result_OK {
    res: MockHumanReadableName
    constructor(res: MockHumanReadableName) {
      this.res = res
    }
  }

  class Result_Err {}

  return {
    Bolt11Invoice: { constructor_from_str: () => new Result_Err() },
    Offer: { constructor_from_str: () => new Result_Err() },
    HumanReadableName: {
      constructor_from_encoded: (encoded: string) => {
        const atIndex = encoded.indexOf('@')
        if (atIndex === -1 || atIndex === 0 || atIndex === encoded.length - 1) {
          return new Result_Err()
        }
        const user = encoded.slice(0, atIndex)
        const domain = encoded.slice(atIndex + 1)
        return new Result_OK(new MockHumanReadableName(user, domain))
      },
    },
    Currency: { LDKCurrency_Signet: 'signet' },
    Option_u64Z_Some: class {},
    Option_AmountZ_Some: class {},
    Amount_Bitcoin: class {},
    Result_Bolt11InvoiceParseOrSemanticErrorZ_OK: class {},
    Result_OfferBolt12ParseErrorZ_OK: class {},
    Result_HumanReadableNameNoneZ_OK: Result_OK,
  }
})

// Mock lnurl module to avoid circular dependency issues
vi.mock('../lnurl/resolve-lnurl', () => ({
  type: {} as never, // type-only import, no runtime needed
}))

describe('classifyPaymentInput — BIP 353', () => {
  it('parses user@domain as bip353', async () => {
    const { classifyPaymentInput } = await import('./payment-input')
    const result = classifyPaymentInput('alice@example.com')
    expect(result.type).toBe('bip353')
    if (result.type === 'bip353') {
      expect(result.raw).toBe('alice@example.com')
    }
  })

  it('strips ₿ prefix from BIP 353 address', async () => {
    const { classifyPaymentInput } = await import('./payment-input')
    const result = classifyPaymentInput('₿alice@example.com')
    expect(result.type).toBe('bip353')
    if (result.type === 'bip353') {
      expect(result.raw).toBe('alice@example.com')
    }
  })

  it('rejects plain text that is not user@domain', async () => {
    const { classifyPaymentInput } = await import('./payment-input')
    const result = classifyPaymentInput('just-some-text')
    expect(result.type).toBe('error')
  })

  it('classifies on-chain addresses correctly', async () => {
    const { classifyPaymentInput } = await import('./payment-input')
    const result = classifyPaymentInput('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx')
    expect(result.type).toBe('onchain')
  })

  it('handles user@domain with dots and hyphens in user part', async () => {
    const { classifyPaymentInput } = await import('./payment-input')
    const result = classifyPaymentInput('my.name-test@example.com')
    expect(result.type).toBe('bip353')
  })

  it('handles subdomains in domain part', async () => {
    const { classifyPaymentInput } = await import('./payment-input')
    const result = classifyPaymentInput('alice@pay.example.co.uk')
    expect(result.type).toBe('bip353')
  })
})
