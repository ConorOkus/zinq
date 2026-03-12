import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock cloudflare:sockets before importing the worker
vi.mock('cloudflare:sockets', () => ({
  connect: vi.fn(() => ({
    readable: new ReadableStream(),
    writable: new WritableStream(),
    close: vi.fn(),
  })),
}))

// Mock WebSocketPair globally (Workers runtime API)
const mockServer = {
  accept: vi.fn(),
  addEventListener: vi.fn(),
  close: vi.fn(),
  send: vi.fn(),
  readyState: 1,
}
const mockClient = {}

vi.stubGlobal(
  'WebSocketPair',
  class {
    constructor() {
      return { 0: mockClient, 1: mockServer }
    }
  },
)

import worker from './index'

const env = {
  ALLOWED_ORIGINS: 'http://localhost:5173,https://wallet.example.com',
  ALLOWED_PORTS: '9735',
}

function makeRequest(
  path: string,
  options: { upgrade?: boolean; origin?: string | null } = {},
) {
  const { upgrade = true, origin = 'http://localhost:5173' } = options
  const headers: Record<string, string> = {}
  if (upgrade) headers['Upgrade'] = 'websocket'
  if (origin) headers['Origin'] = origin
  return new Request(`https://proxy.example.com${path}`, { headers })
}

describe('Worker fetch handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockServer.accept = vi.fn()
    mockServer.addEventListener = vi.fn()
  })

  it('returns 426 for non-WebSocket requests', () => {
    const response = worker.fetch(
      makeRequest('/v1/1_2_3_4/9735', { upgrade: false }),
      env,
    )
    expect(response.status).toBe(426)
  })

  it('returns 403 for unauthorized origin', () => {
    const response = worker.fetch(
      makeRequest('/v1/1_2_3_4/9735', { origin: 'https://evil.com' }),
      env,
    )
    expect(response.status).toBe(403)
  })

  it('returns 403 for missing origin', () => {
    const response = worker.fetch(
      makeRequest('/v1/1_2_3_4/9735', { origin: null }),
      env,
    )
    expect(response.status).toBe(403)
  })

  it('returns 400 for invalid path', () => {
    const response = worker.fetch(makeRequest('/invalid'), env)
    expect(response.status).toBe(400)
  })

  it('returns 400 for blocked port', () => {
    const response = worker.fetch(makeRequest('/v1/8_8_8_8/80'), env)
    expect(response.status).toBe(400)
  })

  it('returns 400 for private IP', () => {
    const response = worker.fetch(makeRequest('/v1/192_168_1_1/9735'), env)
    expect(response.status).toBe(400)
  })

  it('returns 400 for loopback', () => {
    const response = worker.fetch(makeRequest('/v1/127_0_0_1/9735'), env)
    expect(response.status).toBe(400)
  })

  it('returns 400 for localhost hostname', () => {
    const response = worker.fetch(makeRequest('/v1/localhost/9735'), env)
    expect(response.status).toBe(400)
  })

  it('returns 400 for .onion address', () => {
    const response = worker.fetch(makeRequest('/v1/mynode_onion/9735'), env)
    expect(response.status).toBe(400)
  })

  it('returns 500 when ALLOWED_ORIGINS is empty', () => {
    const response = worker.fetch(makeRequest('/v1/8_8_8_8/9735'), {
      ...env,
      ALLOWED_ORIGINS: '',
    })
    expect(response.status).toBe(500)
  })

  it('returns 500 when ALLOWED_PORTS is empty', () => {
    const response = worker.fetch(makeRequest('/v1/8_8_8_8/9735'), {
      ...env,
      ALLOWED_PORTS: '',
    })
    expect(response.status).toBe(500)
  })

  // The Workers runtime allows Response status 101 with a webSocket property,
  // but Node.js Response rejects status outside 200-599. These tests verify
  // that valid requests pass all validation and reach the WebSocket upgrade
  // (which throws in Node.js but succeeds in the Workers runtime).
  it('passes validation for valid public IP request', () => {
    expect(() => worker.fetch(makeRequest('/v1/8_8_8_8/9735'), env)).toThrow(
      RangeError,
    )
  })

  it('passes validation for valid hostname request', () => {
    expect(() =>
      worker.fetch(makeRequest('/v1/node_example_com/9735'), env),
    ).toThrow(RangeError)
  })

  it('passes validation for second allowed origin', () => {
    expect(() =>
      worker.fetch(
        makeRequest('/v1/8_8_8_8/9735', {
          origin: 'https://wallet.example.com',
        }),
        env,
      ),
    ).toThrow(RangeError)
  })
})
