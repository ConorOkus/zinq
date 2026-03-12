import { describe, expect, it } from 'vitest'
import { parseProxyPath, validateOrigin, validateTarget } from './validation'

describe('parseProxyPath', () => {
  it('parses valid IPv4 path', () => {
    expect(parseProxyPath('/v1/1_2_3_4/9735')).toEqual({
      host: '1.2.3.4',
      port: 9735,
    })
  })

  it('parses hostname path', () => {
    expect(parseProxyPath('/v1/node_example_com/9735')).toEqual({
      host: 'node.example.com',
      port: 9735,
    })
  })

  it('parses single-component host', () => {
    expect(parseProxyPath('/v1/myhost/9735')).toEqual({
      host: 'myhost',
      port: 9735,
    })
  })

  it('rejects missing version prefix', () => {
    expect(parseProxyPath('/1_2_3_4/9735')).toBeNull()
  })

  it('rejects missing port', () => {
    expect(parseProxyPath('/v1/1_2_3_4')).toBeNull()
  })

  it('rejects non-numeric port', () => {
    expect(parseProxyPath('/v1/1_2_3_4/abc')).toBeNull()
  })

  it('rejects extra path segments', () => {
    expect(parseProxyPath('/v1/1_2_3_4/9735/extra')).toBeNull()
  })

  it('rejects empty path', () => {
    expect(parseProxyPath('/')).toBeNull()
  })

  it('rejects root path', () => {
    expect(parseProxyPath('')).toBeNull()
  })
})

describe('validateOrigin', () => {
  const allowed = ['http://localhost:5173', 'https://wallet.example.com']

  it('allows matching origin', () => {
    expect(validateOrigin('http://localhost:5173', allowed)).toBe(true)
  })

  it('allows second matching origin', () => {
    expect(validateOrigin('https://wallet.example.com', allowed)).toBe(true)
  })

  it('rejects non-matching origin', () => {
    expect(validateOrigin('https://evil.com', allowed)).toBe(false)
  })

  it('rejects null origin', () => {
    expect(validateOrigin(null, allowed)).toBe(false)
  })

  it('rejects empty string origin', () => {
    expect(validateOrigin('', allowed)).toBe(false)
  })

  it('does not allow substring match', () => {
    expect(
      validateOrigin('http://localhost:5173.evil.com', allowed),
    ).toBe(false)
  })

  it('rejects when allowlist is empty', () => {
    expect(validateOrigin('http://localhost:5173', [])).toBe(false)
  })
})

describe('validateTarget', () => {
  const allowedPorts = [9735]

  it('allows port 9735 with public IP', () => {
    expect(validateTarget('8.8.8.8', 9735, allowedPorts)).toBeNull()
  })

  it('rejects disallowed port', () => {
    expect(validateTarget('8.8.8.8', 80, allowedPorts)).not.toBeNull()
  })

  it('rejects .onion addresses', () => {
    expect(validateTarget('mynode.onion', 9735, allowedPorts)).not.toBeNull()
  })

  // SSRF: private IPv4 ranges
  it('blocks 10.x.x.x', () => {
    expect(validateTarget('10.0.0.1', 9735, allowedPorts)).not.toBeNull()
  })

  it('blocks 172.16.x.x', () => {
    expect(validateTarget('172.16.0.1', 9735, allowedPorts)).not.toBeNull()
  })

  it('blocks 172.31.x.x', () => {
    expect(validateTarget('172.31.255.255', 9735, allowedPorts)).not.toBeNull()
  })

  it('allows 172.15.x.x (not private)', () => {
    expect(validateTarget('172.15.0.1', 9735, allowedPorts)).toBeNull()
  })

  it('allows 172.32.x.x (not private)', () => {
    expect(validateTarget('172.32.0.1', 9735, allowedPorts)).toBeNull()
  })

  it('blocks 192.168.x.x', () => {
    expect(validateTarget('192.168.1.1', 9735, allowedPorts)).not.toBeNull()
  })

  it('blocks 127.x.x.x', () => {
    expect(validateTarget('127.0.0.1', 9735, allowedPorts)).not.toBeNull()
  })

  it('blocks 169.254.x.x (link-local)', () => {
    expect(validateTarget('169.254.1.1', 9735, allowedPorts)).not.toBeNull()
  })

  it('blocks 0.x.x.x', () => {
    expect(validateTarget('0.0.0.0', 9735, allowedPorts)).not.toBeNull()
  })

  it('blocks 100.64.x.x (CGNAT)', () => {
    expect(validateTarget('100.64.0.1', 9735, allowedPorts)).not.toBeNull()
  })

  it('blocks 100.127.x.x (CGNAT upper)', () => {
    expect(validateTarget('100.127.255.255', 9735, allowedPorts)).not.toBeNull()
  })

  it('allows 100.63.x.x (not CGNAT)', () => {
    expect(validateTarget('100.63.0.1', 9735, allowedPorts)).toBeNull()
  })

  it('blocks 255.x.x.x (broadcast)', () => {
    expect(validateTarget('255.255.255.255', 9735, allowedPorts)).not.toBeNull()
  })

  it('allows public IP', () => {
    expect(validateTarget('8.8.8.8', 9735, allowedPorts)).toBeNull()
  })

  it('allows public hostname', () => {
    expect(validateTarget('node.example.com', 9735, allowedPorts)).toBeNull()
  })

  // DNS rebinding protection: well-known private hostnames
  it('blocks localhost', () => {
    expect(validateTarget('localhost', 9735, allowedPorts)).not.toBeNull()
  })

  it('blocks localhost case-insensitive', () => {
    expect(validateTarget('LOCALHOST', 9735, allowedPorts)).not.toBeNull()
  })

  it('blocks .local domains', () => {
    expect(validateTarget('myhost.local', 9735, allowedPorts)).not.toBeNull()
  })

  it('blocks .internal domains', () => {
    expect(
      validateTarget('service.internal', 9735, allowedPorts),
    ).not.toBeNull()
  })

  it('blocks .localhost domains', () => {
    expect(
      validateTarget('app.localhost', 9735, allowedPorts),
    ).not.toBeNull()
  })

  // IPv6 loopback and private literals
  it('blocks ::1', () => {
    expect(validateTarget('::1', 9735, allowedPorts)).not.toBeNull()
  })

  it('blocks [::1]', () => {
    expect(validateTarget('[::1]', 9735, allowedPorts)).not.toBeNull()
  })

  it('blocks ::ffff: mapped addresses', () => {
    expect(
      validateTarget('::ffff:127.0.0.1', 9735, allowedPorts),
    ).not.toBeNull()
  })

  it('blocks fc00:: (IPv6 ULA)', () => {
    expect(validateTarget('fc00::1', 9735, allowedPorts)).not.toBeNull()
  })

  it('blocks fd00:: (IPv6 ULA)', () => {
    expect(validateTarget('fd00::1', 9735, allowedPorts)).not.toBeNull()
  })

  it('blocks fe80:: (IPv6 link-local)', () => {
    expect(validateTarget('fe80::1', 9735, allowedPorts)).not.toBeNull()
  })
})
