/** Convert millisatoshis to satoshis using floor division (never overstates). */
export function msatToSatFloor(msat: bigint): bigint {
  return msat / 1000n
}

/** Convert millisatoshis to satoshis using ceiling division (never understates). */
export function msatToSatCeil(msat: bigint): bigint {
  return (msat + 999n) / 1000n
}
