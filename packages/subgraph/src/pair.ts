import { BigDecimal, BigInt, Address } from '@graphprotocol/graph-ts'
import {
  Swap as SwapEvent,
  Sync as SyncEvent,
  UniswapV2Pair,
} from '../generated/templates/UniswapV2Pair/UniswapV2Pair'
import {
  Unit,
  UnitHourData,
  UnitDayData,
  Swap,
  Account,
  Protocol,
} from '../generated/schema'
import {
  ZERO_BI,
  ONE_BI,
  ZERO_BD,
  BI_18,
  PROTOCOL_ID,
} from './constants'
import {
  convertTokenToDecimal,
  getOrCreateProtocol,
  getOrCreateAccount,
  getOrCreateUnitHourData,
  getOrCreateUnitDayData,
  updateUnitPrice,
} from './helpers'

// Helper to find Unit by LP pair address
function getUnitByLpPair(pairAddress: Address): Unit | null {
  // We need to find which Unit has this LP pair
  // The Unit entity stores lpPair as Bytes, and the id is the unit token address
  // We'll use the pair contract to get token0 and token1, then check which is the Unit
  let pair = UniswapV2Pair.bind(pairAddress)

  let token0Result = pair.try_token0()
  let token1Result = pair.try_token1()

  if (token0Result.reverted || token1Result.reverted) {
    return null
  }

  let token0 = token0Result.value
  let token1 = token1Result.value

  // Try loading Unit by token0 first, then token1
  let unit = Unit.load(token0.toHexString())
  if (unit !== null) {
    return unit
  }

  unit = Unit.load(token1.toHexString())
  return unit
}

export function handleSync(event: SyncEvent): void {
  let pairAddress = event.address
  let unit = getUnitByLpPair(pairAddress)
  if (unit === null) return

  let pair = UniswapV2Pair.bind(pairAddress)
  let token0Result = pair.try_token0()
  if (token0Result.reverted) return

  let token0 = token0Result.value
  let isUnitToken0 = token0.toHexString() == unit.id

  // Parse reserves - Sync event emits reserve0 and reserve1 as uint112
  // Convert to BigDecimal with 18 decimals
  let reserve0 = BigDecimal.fromString(event.params.reserve0.toString()).div(BigDecimal.fromString('1000000000000000000'))
  let reserve1 = BigDecimal.fromString(event.params.reserve1.toString()).div(BigDecimal.fromString('1000000000000000000'))

  let reserveUnit: BigDecimal
  let reserveDonut: BigDecimal

  if (isUnitToken0) {
    reserveUnit = reserve0
    reserveDonut = reserve1
  } else {
    reserveUnit = reserve1
    reserveDonut = reserve0
  }

  // Update Unit reserves
  unit.reserveUnit = reserveUnit
  unit.reserveDonut = reserveDonut

  // Calculate price: price = reserveDonut / reserveUnit (how much DONUT per Unit)
  let newPrice = ZERO_BD
  if (reserveUnit.gt(ZERO_BD)) {
    newPrice = reserveDonut.div(reserveUnit)
  }

  // Update price and related metrics
  updateUnitPrice(unit, newPrice)

  // Update liquidity (DONUT side)
  unit.liquidity = reserveDonut

  // Update hour/day data OHLC
  let hourData = getOrCreateUnitHourData(unit, event)
  hourData.close = newPrice
  if (newPrice.gt(hourData.high)) {
    hourData.high = newPrice
  }
  if (newPrice.lt(hourData.low) || hourData.low.equals(ZERO_BD)) {
    hourData.low = newPrice
  }
  hourData.liquidity = reserveDonut
  hourData.save()

  let dayData = getOrCreateUnitDayData(unit, event)
  dayData.close = newPrice
  if (newPrice.gt(dayData.high)) {
    dayData.high = newPrice
  }
  if (newPrice.lt(dayData.low) || dayData.low.equals(ZERO_BD)) {
    dayData.low = newPrice
  }
  dayData.liquidity = reserveDonut
  dayData.totalSupply = unit.totalSupply
  dayData.totalMinted = unit.totalMinted
  dayData.save()

  unit.save()

  // Update Protocol liquidity
  let protocol = getOrCreateProtocol()
  // Note: We'd need to sum all units' liquidity for accurate total
  // For simplicity, we can track this separately or recalculate periodically
  protocol.lastUpdated = event.block.timestamp
  protocol.save()
}

export function handleSwap(event: SwapEvent): void {
  let pairAddress = event.address
  let unit = getUnitByLpPair(pairAddress)
  if (unit === null) return

  let pair = UniswapV2Pair.bind(pairAddress)
  let token0Result = pair.try_token0()
  if (token0Result.reverted) return

  let token0 = token0Result.value
  let isUnitToken0 = token0.toHexString() == unit.id

  // Parse swap amounts
  let amount0In = convertTokenToDecimal(event.params.amount0In, BI_18)
  let amount1In = convertTokenToDecimal(event.params.amount1In, BI_18)
  let amount0Out = convertTokenToDecimal(event.params.amount0Out, BI_18)
  let amount1Out = convertTokenToDecimal(event.params.amount1Out, BI_18)

  let amountUnitIn: BigDecimal
  let amountUnitOut: BigDecimal
  let amountDonutIn: BigDecimal
  let amountDonutOut: BigDecimal

  if (isUnitToken0) {
    amountUnitIn = amount0In
    amountUnitOut = amount0Out
    amountDonutIn = amount1In
    amountDonutOut = amount1Out
  } else {
    amountUnitIn = amount1In
    amountUnitOut = amount1Out
    amountDonutIn = amount0In
    amountDonutOut = amount0Out
  }

  // Determine swap type: buy or sell
  // Buy = DONUT in, Unit out (user buying Unit with DONUT)
  // Sell = Unit in, DONUT out (user selling Unit for DONUT)
  let isBuy = amountDonutIn.gt(ZERO_BD) && amountUnitOut.gt(ZERO_BD)
  let swapType = isBuy ? 'buy' : 'sell'

  // Calculate amounts for the swap
  let amountUnit = isBuy ? amountUnitOut : amountUnitIn
  let amountDonut = isBuy ? amountDonutIn : amountDonutOut

  // Calculate execution price
  let price = ZERO_BD
  if (amountUnit.gt(ZERO_BD)) {
    price = amountDonut.div(amountUnit)
  }

  // Get or create account
  let account = getOrCreateAccount(event.params.to)
  account.totalSwapVolume = account.totalSwapVolume.plus(amountDonut)
  account.lastActivityAt = event.block.timestamp
  account.save()

  // Create Swap entity
  let swapId = event.transaction.hash.toHexString() + '-' + event.logIndex.toString()
  let swap = new Swap(swapId)
  swap.unit = unit.id
  swap.account = account.id
  swap.type = swapType
  swap.amountUnit = amountUnit
  swap.amountDonut = amountDonut
  swap.price = price
  swap.timestamp = event.block.timestamp
  swap.blockNumber = event.block.number
  swap.txHash = event.transaction.hash
  swap.logIndex = event.logIndex
  swap.save()

  // Update Unit volume stats
  unit.volumeTotal = unit.volumeTotal.plus(amountDonut)
  unit.txCount = unit.txCount.plus(ONE_BI)
  unit.lastSwapAt = event.block.timestamp
  unit.lastActivityAt = event.block.timestamp
  unit.save()

  // Update hour data
  let hourData = getOrCreateUnitHourData(unit, event)
  hourData.volumeUnit = hourData.volumeUnit.plus(amountUnit)
  hourData.volumeDonut = hourData.volumeDonut.plus(amountDonut)
  hourData.txCount = hourData.txCount.plus(ONE_BI)
  hourData.save()

  // Update day data
  let dayData = getOrCreateUnitDayData(unit, event)
  dayData.volumeUnit = dayData.volumeUnit.plus(amountUnit)
  dayData.volumeDonut = dayData.volumeDonut.plus(amountDonut)
  dayData.txCount = dayData.txCount.plus(ONE_BI)
  dayData.save()

  // Update Protocol volume
  let protocol = getOrCreateProtocol()
  protocol.totalVolumeDonut = protocol.totalVolumeDonut.plus(amountDonut)
  protocol.lastUpdated = event.block.timestamp
  protocol.save()
}
