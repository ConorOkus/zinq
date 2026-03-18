import { create, toBinary, fromBinary } from '@bufbuild/protobuf'
import {
  GetObjectRequestSchema,
  GetObjectResponseSchema,
  PutObjectRequestSchema,
  DeleteObjectRequestSchema,
  ListKeyVersionsRequestSchema,
  ListKeyVersionsResponseSchema,
  ErrorResponseSchema,
  KeyValueSchema,
  ErrorCode,
  type KeyValue,
} from './proto/vss_pb'
import { vssEncrypt, vssDecrypt, obfuscateKey } from './vss-crypto'

const FETCH_TIMEOUT_MS = 15_000

export interface VssHeaderProvider {
  getHeaders(): Promise<Record<string, string>>
}

export class FixedHeaderProvider implements VssHeaderProvider {
  #headers: Record<string, string>
  constructor(headers: Record<string, string>) {
    this.#headers = headers
  }
  async getHeaders(): Promise<Record<string, string>> {
    return this.#headers
  }
}

export class VssError extends Error {
  errorCode: ErrorCode
  httpStatus: number
  constructor(message: string, errorCode: ErrorCode, httpStatus: number) {
    super(message)
    this.name = 'VssError'
    this.errorCode = errorCode
    this.httpStatus = httpStatus
  }
}

export class VssClient {
  #baseUrl: string
  #storeId: string
  #encryptionKey: Uint8Array
  #auth: VssHeaderProvider

  constructor(
    baseUrl: string,
    storeId: string,
    encryptionKey: Uint8Array,
    auth: VssHeaderProvider,
  ) {
    this.#baseUrl = baseUrl
    this.#storeId = storeId
    this.#encryptionKey = encryptionKey
    this.#auth = auth
  }

  async getObject(
    key: string,
  ): Promise<{ value: Uint8Array; version: number } | null> {
    const obfuscatedKey = await obfuscateKey(this.#encryptionKey, key)

    const request = create(GetObjectRequestSchema, {
      storeId: this.#storeId,
      key: obfuscatedKey,
    })
    const body = toBinary(GetObjectRequestSchema, request)

    let res: Response
    try {
      res = await fetch(`${this.#baseUrl}/getObject`, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          'Content-Type': 'application/octet-stream',
          ...(await this.#auth.getHeaders()),
        },
      })
    } catch (err) {
      throw new VssError(
        `[VSS] getObject network error: ${err instanceof Error ? err.message : String(err)}`,
        ErrorCode.UNKNOWN,
        0,
      )
    }

    if (res.status === 404) return null
    if (!res.ok) throw await this.#parseError(res)

    const responseBytes = new Uint8Array(await res.arrayBuffer())
    const response = fromBinary(GetObjectResponseSchema, responseBytes)

    if (!response.value) return null

    const decrypted = vssDecrypt(this.#encryptionKey, response.value.value)
    return {
      value: decrypted,
      version: Number(response.value.version),
    }
  }

  async putObject(
    key: string,
    value: Uint8Array,
    version: number,
  ): Promise<number> {
    const obfuscatedKey = await obfuscateKey(this.#encryptionKey, key)
    const encrypted = vssEncrypt(this.#encryptionKey, value)

    const kv = create(KeyValueSchema, {
      key: obfuscatedKey,
      version: BigInt(version),
      value: encrypted,
    })

    const request = create(PutObjectRequestSchema, {
      storeId: this.#storeId,
      transactionItems: [kv],
      deleteItems: [],
    })
    const body = toBinary(PutObjectRequestSchema, request)

    let res: Response
    try {
      res = await fetch(`${this.#baseUrl}/putObjects`, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          'Content-Type': 'application/octet-stream',
          ...(await this.#auth.getHeaders()),
        },
      })
    } catch (err) {
      throw new VssError(
        `[VSS] putObject network error: ${err instanceof Error ? err.message : String(err)}`,
        ErrorCode.UNKNOWN,
        0,
      )
    }

    if (!res.ok) throw await this.#parseError(res)
    return version + 1
  }

  async putObjects(
    items: Array<{ key: string; value: Uint8Array; version: number }>,
  ): Promise<void> {
    const transactionItems: KeyValue[] = []
    for (const item of items) {
      const obfuscatedKey = await obfuscateKey(this.#encryptionKey, item.key)
      const encrypted = vssEncrypt(this.#encryptionKey, item.value)
      transactionItems.push(
        create(KeyValueSchema, {
          key: obfuscatedKey,
          version: BigInt(item.version),
          value: encrypted,
        }),
      )
    }

    const request = create(PutObjectRequestSchema, {
      storeId: this.#storeId,
      transactionItems,
      deleteItems: [],
    })
    const body = toBinary(PutObjectRequestSchema, request)

    let res: Response
    try {
      res = await fetch(`${this.#baseUrl}/putObjects`, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          'Content-Type': 'application/octet-stream',
          ...(await this.#auth.getHeaders()),
        },
      })
    } catch (err) {
      throw new VssError(
        `[VSS] putObjects network error: ${err instanceof Error ? err.message : String(err)}`,
        ErrorCode.UNKNOWN,
        0,
      )
    }

    if (!res.ok) throw await this.#parseError(res)
  }

  async deleteObject(key: string, version: number): Promise<void> {
    const obfuscatedKey = await obfuscateKey(this.#encryptionKey, key)

    const request = create(DeleteObjectRequestSchema, {
      storeId: this.#storeId,
      keyValue: create(KeyValueSchema, {
        key: obfuscatedKey,
        version: BigInt(version),
      }),
    })
    const body = toBinary(DeleteObjectRequestSchema, request)

    let res: Response
    try {
      res = await fetch(`${this.#baseUrl}/deleteObject`, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          'Content-Type': 'application/octet-stream',
          ...(await this.#auth.getHeaders()),
        },
      })
    } catch (err) {
      throw new VssError(
        `[VSS] deleteObject network error: ${err instanceof Error ? err.message : String(err)}`,
        ErrorCode.UNKNOWN,
        0,
      )
    }

    if (!res.ok) throw await this.#parseError(res)
  }

  async listKeyVersions(): Promise<
    Array<{ key: string; version: number }>
  > {
    const results: Array<{ key: string; version: number }> = []
    let pageToken: string | undefined

    do {
      const request = create(ListKeyVersionsRequestSchema, {
        storeId: this.#storeId,
        pageToken,
      })
      const body = toBinary(ListKeyVersionsRequestSchema, request)

      let res: Response
      try {
        res = await fetch(`${this.#baseUrl}/listKeyVersions`, {
          method: 'POST',
          body,
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          headers: {
            'Content-Type': 'application/octet-stream',
            ...(await this.#auth.getHeaders()),
          },
        })
      } catch (err) {
        throw new VssError(
          `[VSS] listKeyVersions network error: ${err instanceof Error ? err.message : String(err)}`,
          ErrorCode.UNKNOWN,
          0,
        )
      }

      if (!res.ok) throw await this.#parseError(res)

      const responseBytes = new Uint8Array(await res.arrayBuffer())
      const response = fromBinary(ListKeyVersionsResponseSchema, responseBytes)

      for (const kv of response.keyVersions) {
        results.push({ key: kv.key, version: Number(kv.version) })
      }

      pageToken = response.nextPageToken || undefined
    } while (pageToken)

    return results
  }

  async #parseError(res: Response): Promise<VssError> {
    try {
      const bytes = new Uint8Array(await res.arrayBuffer())
      const errorResponse = fromBinary(ErrorResponseSchema, bytes)
      return new VssError(
        `[VSS] ${errorResponse.message}`,
        errorResponse.errorCode,
        res.status,
      )
    } catch {
      return new VssError(
        `[VSS] HTTP ${res.status}: ${res.statusText}`,
        ErrorCode.UNKNOWN,
        res.status,
      )
    }
  }
}
