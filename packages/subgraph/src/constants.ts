import { BigDecimal, BigInt } from '@graphprotocol/graph-ts'

// ============================================================================
// ZERO / ONE VALUES
// ============================================================================

export const ZERO_BI = BigInt.fromI32(0)
export const ONE_BI = BigInt.fromI32(1)
export const ZERO_BD = BigDecimal.fromString('0')
export const ONE_BD = BigDecimal.fromString('1')

// ============================================================================
// ADDRESSES
// ============================================================================

export const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000'
export const PROTOCOL_ID = 'farplace'

// DONUT token address on Base (update after deployment)
export const DONUT_ADDRESS = '0x0000000000000000000000000000000000000000' // TODO: Update

// ============================================================================
// DECIMALS
// ============================================================================

export const BI_18 = BigInt.fromI32(18)
export const BI_6 = BigInt.fromI32(6)

// ============================================================================
// TIME CONSTANTS
// ============================================================================

export const SECONDS_PER_HOUR = 3600
export const SECONDS_PER_DAY = 86400

// ============================================================================
// RIG TYPES
// ============================================================================

export const RIG_TYPE_SEAT = 'seat'
export const RIG_TYPE_SPIN = 'spin'
export const RIG_TYPE_CHARITY = 'charity'
