import { BigInt, BigDecimal, Address, ethereum } from '@graphprotocol/graph-ts'
import { Protocol, Unit, Rig, Account, UnitMinuteData, UnitHourData, UnitDayData } from '../generated/schema'
import {
  ZERO_BI,
  ONE_BI,
  ZERO_BD,
  PROTOCOL_ID,
  ADDRESS_ZERO,
  SECONDS_PER_MINUTE,
  SECONDS_PER_HOUR,
  SECONDS_PER_DAY,
} from './constants'

// ============================================================================
// DECIMAL CONVERSION
// ============================================================================

export function exponentToBigDecimal(decimals: BigInt): BigDecimal {
  let bd = BigDecimal.fromString('1')
  for (let i = ZERO_BI; i.lt(decimals); i = i.plus(ONE_BI)) {
    bd = bd.times(BigDecimal.fromString('10'))
  }
  return bd
}

export function convertTokenToDecimal(tokenAmount: BigInt, exchangeDecimals: BigInt): BigDecimal {
  if (exchangeDecimals == ZERO_BI) {
    return tokenAmount.toBigDecimal()
  }
  return tokenAmount.toBigDecimal().div(exponentToBigDecimal(exchangeDecimals))
}

// ============================================================================
// ENTITY LOADERS / CREATORS
// ============================================================================

export function getOrCreateProtocol(): Protocol {
  let protocol = Protocol.load(PROTOCOL_ID)
  if (protocol === null) {
    protocol = new Protocol(PROTOCOL_ID)
    protocol.totalUnits = ZERO_BI
    protocol.totalRigs = ZERO_BI
    protocol.totalVolumeUsdc = ZERO_BD
    protocol.totalVolume24h = ZERO_BD
    protocol.totalLiquidityUsdc = ZERO_BD
    protocol.totalTreasuryRevenue = ZERO_BD
    protocol.totalProtocolRevenue = ZERO_BD
    protocol.totalMinted = ZERO_BD
    protocol.lastUpdated = ZERO_BI
    protocol.save()
  }
  return protocol
}

export function getOrCreateAccount(address: Address): Account {
  let id = address.toHexString()
  let account = Account.load(id)
  if (account === null) {
    account = new Account(id)
    account.totalSwapVolume = ZERO_BD
    account.totalRigSpend = ZERO_BD
    account.totalMined = ZERO_BD
    account.totalWon = ZERO_BD
    account.lastActivityAt = ZERO_BI
    account.save()
  }
  return account
}

export function createUnit(
  unitAddress: Address,
  lpPairAddress: Address,
  usdcAddress: Address,
  launcher: Account,
  name: string,
  symbol: string,
  event: ethereum.Event
): Unit {
  let unit = new Unit(unitAddress.toHexString())

  // Basic info
  unit.name = name
  unit.symbol = symbol
  unit.decimals = 18

  // Supply
  unit.totalSupply = ZERO_BD
  unit.totalMinted = ZERO_BD

  // Contracts
  unit.lpPair = lpPairAddress
  unit.usdcToken = usdcAddress
  unit.launcher = launcher.id

  // Price data (will be updated on first Sync)
  unit.price = ZERO_BD
  unit.priceUSD = ZERO_BD
  unit.marketCap = ZERO_BD
  unit.marketCapUSD = ZERO_BD
  unit.liquidity = ZERO_BD
  unit.liquidityUSD = ZERO_BD
  unit.reserveUnit = ZERO_BD
  unit.reserveUsdc = ZERO_BD

  // Volume
  unit.volume24h = ZERO_BD
  unit.volume7d = ZERO_BD
  unit.volumeTotal = ZERO_BD
  unit.txCount = ZERO_BI
  unit.txCount24h = ZERO_BI

  // Price changes
  unit.priceChange1h = ZERO_BD
  unit.priceChange24h = ZERO_BD
  unit.priceChange7d = ZERO_BD
  unit.priceHigh24h = ZERO_BD
  unit.priceLow24h = ZERO_BD
  unit.price1hAgo = ZERO_BD
  unit.price24hAgo = ZERO_BD
  unit.price7dAgo = ZERO_BD

  // Activity
  unit.lastSwapAt = ZERO_BI
  unit.lastRigActivityAt = ZERO_BI
  unit.lastActivityAt = ZERO_BI

  // Holders
  unit.holderCount = ZERO_BI

  // Timestamps
  unit.createdAt = event.block.timestamp
  unit.createdAtBlock = event.block.number

  return unit
}

// ============================================================================
// HOUR / DAY DATA HELPERS
// ============================================================================

export function getMinuteIndex(timestamp: BigInt): i32 {
  return timestamp.toI32() / SECONDS_PER_MINUTE
}

export function getHourIndex(timestamp: BigInt): i32 {
  return timestamp.toI32() / SECONDS_PER_HOUR
}

export function getDayIndex(timestamp: BigInt): i32 {
  return timestamp.toI32() / SECONDS_PER_DAY
}

export function getMinuteStartTimestamp(minuteIndex: i32): BigInt {
  return BigInt.fromI32(minuteIndex * SECONDS_PER_MINUTE)
}

export function getHourStartTimestamp(hourIndex: i32): BigInt {
  return BigInt.fromI32(hourIndex * SECONDS_PER_HOUR)
}

export function getDayStartTimestamp(dayIndex: i32): BigInt {
  return BigInt.fromI32(dayIndex * SECONDS_PER_DAY)
}

export function getOrCreateUnitMinuteData(unit: Unit, event: ethereum.Event): UnitMinuteData {
  let minuteIndex = getMinuteIndex(event.block.timestamp)
  let id = unit.id.concat('-').concat(minuteIndex.toString())

  let minuteData = UnitMinuteData.load(id)
  if (minuteData === null) {
    minuteData = new UnitMinuteData(id)
    minuteData.unit = unit.id
    minuteData.timestamp = getMinuteStartTimestamp(minuteIndex)
    minuteData.minuteIndex = minuteIndex

    // Initialize OHLC with current price
    minuteData.open = unit.price
    minuteData.high = unit.price
    minuteData.low = unit.price
    minuteData.close = unit.price

    // Volume
    minuteData.volumeUnit = ZERO_BD
    minuteData.volumeUsdc = ZERO_BD
    minuteData.txCount = ZERO_BI

    // Liquidity
    minuteData.liquidity = unit.liquidity
  }

  return minuteData
}

export function getOrCreateUnitHourData(unit: Unit, event: ethereum.Event): UnitHourData {
  let hourIndex = getHourIndex(event.block.timestamp)
  let id = unit.id.concat('-').concat(hourIndex.toString())

  let hourData = UnitHourData.load(id)
  if (hourData === null) {
    hourData = new UnitHourData(id)
    hourData.unit = unit.id
    hourData.timestamp = getHourStartTimestamp(hourIndex)
    hourData.hourIndex = hourIndex

    // Initialize OHLC with current price
    hourData.open = unit.price
    hourData.high = unit.price
    hourData.low = unit.price
    hourData.close = unit.price

    // Volume
    hourData.volumeUnit = ZERO_BD
    hourData.volumeUsdc = ZERO_BD
    hourData.txCount = ZERO_BI

    // Liquidity
    hourData.liquidity = unit.liquidity
  }

  return hourData
}

export function getOrCreateUnitDayData(unit: Unit, event: ethereum.Event): UnitDayData {
  let dayIndex = getDayIndex(event.block.timestamp)
  let id = unit.id.concat('-').concat(dayIndex.toString())

  let dayData = UnitDayData.load(id)
  if (dayData === null) {
    dayData = new UnitDayData(id)
    dayData.unit = unit.id
    dayData.timestamp = getDayStartTimestamp(dayIndex)
    dayData.dayIndex = dayIndex

    // Initialize OHLC with current price
    dayData.open = unit.price
    dayData.high = unit.price
    dayData.low = unit.price
    dayData.close = unit.price

    // Volume
    dayData.volumeUnit = ZERO_BD
    dayData.volumeUsdc = ZERO_BD
    dayData.txCount = ZERO_BI

    // Snapshots
    dayData.liquidity = unit.liquidity
    dayData.totalSupply = unit.totalSupply
    dayData.totalMinted = unit.totalMinted
  }

  return dayData
}

// ============================================================================
// PRICE HELPERS
// ============================================================================

export function updateUnitPrice(unit: Unit, newPrice: BigDecimal): void {
  // Update high/low
  if (newPrice.gt(unit.priceHigh24h)) {
    unit.priceHigh24h = newPrice
  }
  if (unit.priceLow24h.equals(ZERO_BD) || newPrice.lt(unit.priceLow24h)) {
    unit.priceLow24h = newPrice
  }

  // Update current price
  unit.price = newPrice
  unit.priceUSD = newPrice

  // Update market cap
  unit.marketCap = newPrice.times(unit.totalSupply)
  unit.marketCapUSD = unit.marketCap
}

export function calculatePriceChange(currentPrice: BigDecimal, oldPrice: BigDecimal): BigDecimal {
  if (oldPrice.equals(ZERO_BD)) {
    return ZERO_BD
  }
  return currentPrice.minus(oldPrice).div(oldPrice).times(BigDecimal.fromString('100'))
}
