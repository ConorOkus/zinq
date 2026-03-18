import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPersister, type PersisterOptions } from './persist'
import { VssError, type VssClient } from '../storage/vss-client'
import { ErrorCode } from '../storage/proto/vss_pb'

// Mock IDB storage
vi.mock('../storage/idb', () => ({
  idbPut: vi.fn().mockResolvedValue(undefined),
  idbDelete: vi.fn().mockResolvedValue(undefined),
}))

// Mock lightningdevkit — provide just enough to create a Persist impl
vi.mock('lightningdevkit', () => {
  const InProgress = 2 // LDKChannelMonitorUpdateStatus_InProgress
  return {
    Persist: {
      new_impl: (impl: Record<string, unknown>) => impl,
    },
    ChannelMonitorUpdateStatus: {
      LDKChannelMonitorUpdateStatus_InProgress: InProgress,
    },
  }
})

import { idbPut, idbDelete } from '../storage/idb'

function makeOutpoint(txid: string, index: number) {
  const txidBytes = new Uint8Array(txid.split('').map((c) => c.charCodeAt(0)))
  return {
    get_txid: () => txidBytes,
    get_index: () => index,
  }
}

function makeMonitor(data: Uint8Array, updateId = 1n) {
  return {
    write: () => data,
    get_latest_update_id: () => updateId,
  }
}

function makeVssClient(overrides: Partial<VssClient> = {}): VssClient {
  return {
    putObject: vi.fn().mockResolvedValue(1),
    getObject: vi.fn().mockResolvedValue(null),
    putObjects: vi.fn().mockResolvedValue(undefined),
    deleteObject: vi.fn().mockResolvedValue(undefined),
    listKeyVersions: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as VssClient
}

function createTestPersister(options: PersisterOptions = {}) {
  const persister = createPersister(options)
  const mockChainMonitor = {
    channel_monitor_updated: vi.fn(),
  }
  persister.setChainMonitor(mockChainMonitor as never)
  return { ...persister, mockChainMonitor }
}

describe('createPersister', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(idbPut).mockReset().mockResolvedValue(undefined)
    vi.mocked(idbDelete).mockReset().mockResolvedValue(undefined)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('without VssClient (IDB-only)', () => {
    it('persists to IDB and calls channel_monitor_updated', async () => {
      const { persist, mockChainMonitor } = createTestPersister()
      const outpoint = makeOutpoint('abcd', 0)
      const data = new Uint8Array([1, 2, 3])
      const monitor = makeMonitor(data, 42n)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const impl = persist as any
      impl.persist_new_channel(outpoint, monitor)

      // Let the async persist complete
      await vi.advanceTimersByTimeAsync(0)

      expect(idbPut).toHaveBeenCalledWith('ldk_channel_monitors', expect.any(String), data)
      expect(mockChainMonitor.channel_monitor_updated).toHaveBeenCalledWith(outpoint, 42n)
    })

    it('retries with exponential backoff on IDB failure then succeeds', async () => {
      const idbPutMock = vi.mocked(idbPut)
      idbPutMock
        .mockRejectedValueOnce(new Error('IDB error'))
        .mockRejectedValueOnce(new Error('IDB error'))
        .mockResolvedValueOnce(undefined)

      const { persist, mockChainMonitor } = createTestPersister()
      const outpoint = makeOutpoint('abcd', 0)
      const monitor = makeMonitor(new Uint8Array([1]), 1n)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(persist as any).persist_new_channel(outpoint, monitor)

      // Advance through first backoff (500ms) and second backoff (1000ms)
      await vi.advanceTimersByTimeAsync(500)
      await vi.advanceTimersByTimeAsync(1000)
      // Flush remaining microtasks
      await vi.advanceTimersByTimeAsync(0)

      expect(idbPutMock).toHaveBeenCalledTimes(3)
      expect(mockChainMonitor.channel_monitor_updated).toHaveBeenCalled()
    })

    it('archives by deleting from IDB', async () => {
      const { persist } = createTestPersister()
      const outpoint = makeOutpoint('abcd', 0)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(persist as any).archive_persisted_channel(outpoint)

      await vi.advanceTimersByTimeAsync(0)

      expect(idbDelete).toHaveBeenCalledWith('ldk_channel_monitors', expect.any(String))
    })
  })

  describe('with VssClient', () => {
    it('writes to VSS first, then IDB', async () => {
      const callOrder: string[] = []
      const putObjectFn = vi.fn().mockImplementation(async () => {
        callOrder.push('vss')
        return 1
      })
      const vssClient = makeVssClient({ putObject: putObjectFn })
      vi.mocked(idbPut).mockImplementation(async () => {
        callOrder.push('idb')
      })

      const { persist } = createTestPersister({ vssClient })
      const outpoint = makeOutpoint('abcd', 0)
      const monitor = makeMonitor(new Uint8Array([1, 2, 3]), 1n)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(persist as any).persist_new_channel(outpoint, monitor)

      // Flush all microtasks from the chained async operations
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(0)

      expect(callOrder).toEqual(['vss', 'idb'])
    })

    it('passes version 0 for new channels and caches returned version', async () => {
      const vssClient = makeVssClient({
        putObject: vi.fn().mockResolvedValue(1),
      })

      const { persist, versionCache } = createTestPersister({ vssClient })
      const outpoint = makeOutpoint('abcd', 0)
      const monitor = makeMonitor(new Uint8Array([1]), 1n)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(persist as any).persist_new_channel(outpoint, monitor)
      await vi.advanceTimersByTimeAsync(0)

      expect(vssClient.putObject).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Uint8Array),
        0, // version 0 for new channel
      )
      // Version cache should now have version 1
      const key = Array.from(versionCache.keys())[0]
      expect(versionCache.get(key!)).toBe(1)
    })

    it('uses cached version for subsequent updates', async () => {
      const vssClient = makeVssClient({
        putObject: vi.fn()
          .mockResolvedValueOnce(1) // persist_new_channel returns version 1
          .mockResolvedValueOnce(2), // update_persisted_channel returns version 2
      })

      const { persist, versionCache } = createTestPersister({ vssClient })
      const outpoint = makeOutpoint('abcd', 0)

      // First: persist_new_channel
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(persist as any).persist_new_channel(outpoint, makeMonitor(new Uint8Array([1]), 1n))
      await vi.advanceTimersByTimeAsync(0)

      // Second: update_persisted_channel — should use cached version 1
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(persist as any).update_persisted_channel(outpoint, null, makeMonitor(new Uint8Array([2]), 2n))
      await vi.advanceTimersByTimeAsync(0)

      expect(vssClient.putObject).toHaveBeenCalledTimes(2)
      expect(vssClient.putObject).toHaveBeenNthCalledWith(2, expect.any(String), expect.any(Uint8Array), 1)

      const key = Array.from(versionCache.keys())[0]
      expect(versionCache.get(key!)).toBe(2)
    })

    it('does not call channel_monitor_updated when VSS fails', async () => {
      const idbPutMock = vi.mocked(idbPut)
      idbPutMock.mockClear()

      const vssClient = makeVssClient({
        putObject: vi.fn().mockRejectedValue(new Error('network error')),
      })

      const { persist, mockChainMonitor } = createTestPersister({ vssClient })
      const outpoint = makeOutpoint('abcd', 0)
      const monitor = makeMonitor(new Uint8Array([1]), 1n)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(persist as any).persist_new_channel(outpoint, monitor)

      // Let several retry cycles happen (the retry loop is indefinite, so it won't resolve)
      await vi.advanceTimersByTimeAsync(500)
      await vi.advanceTimersByTimeAsync(1000)
      await vi.advanceTimersByTimeAsync(2000)

      // channel_monitor_updated should NOT have been called
      expect(mockChainMonitor.channel_monitor_updated).not.toHaveBeenCalled()
      // IDB should NOT have been called (VSS failed before IDB attempt)
      expect(idbPutMock).not.toHaveBeenCalled()
    })

    it('calls onVssUnavailable after 10s of failures', async () => {
      const vssClient = makeVssClient({
        putObject: vi.fn().mockRejectedValue(new Error('network error')),
      })

      const onVssUnavailable = vi.fn()
      const { persist } = createTestPersister({ vssClient, onVssUnavailable })
      const outpoint = makeOutpoint('abcd', 0)
      const monitor = makeMonitor(new Uint8Array([1]), 1n)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(persist as any).persist_new_channel(outpoint, monitor)

      // Advance time through exponential backoff: 500, 1000, 2000, 4000 = 7500ms total
      await vi.advanceTimersByTimeAsync(500)
      expect(onVssUnavailable).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1000)
      expect(onVssUnavailable).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(2000)
      expect(onVssUnavailable).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(4000)
      // After 500 + 1000 + 2000 + 4000 = 7500ms, next backoff is 8000ms
      await vi.advanceTimersByTimeAsync(8000)
      // Now total wait is 15500ms > 10000ms threshold
      expect(onVssUnavailable).toHaveBeenCalled()
    })

    it('calls onVssRecovered after degraded state resolves', async () => {
      let callCount = 0
      const vssClient = makeVssClient({
        putObject: vi.fn().mockImplementation(async () => {
          callCount++
          // Fail for first 6 calls, succeed on 7th
          if (callCount <= 6) throw new Error('network error')
          return 1
        }),
      })

      const onVssUnavailable = vi.fn()
      const onVssRecovered = vi.fn()
      const { persist, mockChainMonitor } = createTestPersister({
        vssClient,
        onVssUnavailable,
        onVssRecovered,
      })
      const outpoint = makeOutpoint('abcd', 0)
      const monitor = makeMonitor(new Uint8Array([1]), 1n)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(persist as any).persist_new_channel(outpoint, monitor)

      // Advance through failures until degraded, then recovery
      // Backoffs: 500, 1000, 2000, 4000, 8000, 16000 = 31500ms total
      await vi.advanceTimersByTimeAsync(500)
      await vi.advanceTimersByTimeAsync(1000)
      await vi.advanceTimersByTimeAsync(2000)
      await vi.advanceTimersByTimeAsync(4000)
      await vi.advanceTimersByTimeAsync(8000)
      await vi.advanceTimersByTimeAsync(16000)

      // Now the 7th attempt should succeed
      await vi.advanceTimersByTimeAsync(0)

      expect(onVssUnavailable).toHaveBeenCalled()
      expect(onVssRecovered).toHaveBeenCalled()
      expect(mockChainMonitor.channel_monitor_updated).toHaveBeenCalled()
    })

    describe('version conflict resolution', () => {
      it('resolves conflict when server has same data', async () => {
        const data = new Uint8Array([1, 2, 3])
        const conflictError = new VssError('conflict', ErrorCode.CONFLICT_EXCEPTION, 409)

        const vssClient = makeVssClient({
          putObject: vi.fn()
            .mockRejectedValueOnce(conflictError)
            .mockResolvedValueOnce(2), // should not be called — resolved via getObject
          getObject: vi.fn().mockResolvedValue({ value: data, version: 5 }),
        })

        const { persist, versionCache, mockChainMonitor } = createTestPersister({ vssClient })
        const outpoint = makeOutpoint('abcd', 0)
        const monitor = makeMonitor(data, 1n)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(persist as any).persist_new_channel(outpoint, monitor)
        await vi.advanceTimersByTimeAsync(0)

        // Conflict resolved: server had same data, just update version cache
        const key = Array.from(versionCache.keys())[0]
        expect(versionCache.get(key!)).toBe(5)
        expect(idbPut).toHaveBeenCalled()
        expect(mockChainMonitor.channel_monitor_updated).toHaveBeenCalled()
      })

      it('retries with corrected version when server has different data', async () => {
        const localData = new Uint8Array([1, 2, 3])
        const serverData = new Uint8Array([4, 5, 6])
        const conflictError = new VssError('conflict', ErrorCode.CONFLICT_EXCEPTION, 409)

        const vssClient = makeVssClient({
          putObject: vi.fn()
            .mockRejectedValueOnce(conflictError)
            .mockResolvedValueOnce(6), // retry succeeds with corrected version
          getObject: vi.fn().mockResolvedValue({ value: serverData, version: 5 }),
        })

        const { persist, versionCache, mockChainMonitor } = createTestPersister({ vssClient })
        const outpoint = makeOutpoint('abcd', 0)
        const monitor = makeMonitor(localData, 1n)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(persist as any).persist_new_channel(outpoint, monitor)
        await vi.advanceTimersByTimeAsync(0)

        // Should have retried with version 5 (from getObject)
        expect(vssClient.putObject).toHaveBeenCalledTimes(2)
        expect(vssClient.putObject).toHaveBeenNthCalledWith(
          2,
          expect.any(String),
          expect.any(Uint8Array),
          5, // corrected version from server
        )
        const key = Array.from(versionCache.keys())[0]
        expect(versionCache.get(key!)).toBe(6)
        expect(mockChainMonitor.channel_monitor_updated).toHaveBeenCalled()
      })
    })

    describe('archive_persisted_channel', () => {
      it('deletes from VSS then IDB', async () => {
        const callOrder: string[] = []
        const vssClient = makeVssClient({
          deleteObject: vi.fn().mockImplementation(async () => {
            callOrder.push('vss')
          }),
        })
        vi.mocked(idbDelete).mockImplementation(async () => {
          callOrder.push('idb')
        })

        const { persist, versionCache } = createTestPersister({ vssClient })
        const outpoint = makeOutpoint('abcd', 0)

        // Pre-populate version cache
        const key = `${Array.from(outpoint.get_txid()).map((b) => b.toString(16).padStart(2, '0')).join('')}:0`
        versionCache.set(key, 3)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(persist as any).archive_persisted_channel(outpoint)
        await vi.advanceTimersByTimeAsync(0)

        expect(callOrder).toEqual(['vss', 'idb'])
        expect(vssClient.deleteObject).toHaveBeenCalledWith(key, 3)
        expect(versionCache.has(key)).toBe(false)
      })

      it('still deletes from IDB when VSS delete fails', async () => {
        const vssClient = makeVssClient({
          deleteObject: vi.fn().mockRejectedValue(new Error('VSS error')),
        })

        const { persist } = createTestPersister({ vssClient })
        const outpoint = makeOutpoint('abcd', 0)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(persist as any).archive_persisted_channel(outpoint)
        await vi.advanceTimersByTimeAsync(0)

        expect(idbDelete).toHaveBeenCalled()
      })
    })
  })

  it('exposes versionCache for external seeding', () => {
    const { versionCache } = createPersister()
    expect(versionCache).toBeInstanceOf(Map)
    versionCache.set('test:0', 5)
    expect(versionCache.get('test:0')).toBe(5)
  })
})
