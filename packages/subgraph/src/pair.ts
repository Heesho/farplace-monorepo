import { BigDecimal, BigInt, Address } from '@graphprotocol/graph-ts'
import {
  Swap as SwapEvent,
  Sync as SyncEvent,
  UniswapV2Pair,
} from '../generated/templates/UniswapV2Pair/UniswapV2Pair'
import {
  Unit,
  UnitMinuteData,
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
  BI_6,
  PROTOCOL_ID,
} from './constants'
import {
  convertTokenToDecimal,
  getOrCreateProtocol,
  getOrCreateAccount,
  getOrCreateUnitMinuteData,
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

  let previousLiquidity = unit.liquidity

  let pair = UniswapV2Pair.bind(pairAddress)
  let token0Result = pair.try_token0()
  if (token0Result.reverted) return

  let token0 = token0Result.value
  let isUnitToken0 = token0.toHexString() == unit.id

  // Parse reserves - Sync event emits reserve0 and reserve1 as uint112
  // Unit has 18 decimals, USDC has 6 decimals
  let reserve0Raw = BigDecimal.fromString(event.params.reserve0.toString())
  let reserve1Raw = BigDecimal.fromString(event.params.reserve1.toString())

  let reserveUnit: BigDecimal
  let reserveUsdc: BigDecimal

  if (isUnitToken0) {
    reserveUnit = reserve0Raw.div(BigDecimal.fromString('1000000000000000000')) // 1e18
    reserveUsdc = reserve1Raw.div(BigDecimal.fromString('1000000')) // 1e6
  } else {
    reserveUnit = reserve1Raw.div(BigDecimal.fromString('1000000000000000000')) // 1e18
    reserveUsdc = reserve0Raw.div(BigDecimal.fromString('1000000')) // 1e6
  }

  // Update Unit reserves
  unit.reserveUnit = reserveUnit
  unit.reserveUsdc = reserveUsdc

  // Calculate price: price = reserveUsdc / reserveUnit (how much USDC per Unit)
  let newPrice = ZERO_BD
  if (reserveUnit.gt(ZERO_BD)) {
    newPrice = reserveUsdc.div(reserveUnit)
  }

  // Update price and related metrics
  updateUnitPrice(unit, newPrice)

  // Update liquidity (USDC side)
  unit.liquidity = reserveUsdc
  unit.liquidityUSD = reserveUsdc

  // Update minute/hour/day data OHLC
  let minuteData = getOrCreateUnitMinuteData(unit, event)
  minuteData.close = newPrice
  if (newPrice.gt(minuteData.high)) {
    minuteData.high = newPrice
  }
  if (newPrice.lt(minuteData.low) || minuteData.low.equals(ZERO_BD)) {
    minuteData.low = newPrice
  }
  minuteData.liquidity = reserveUsdc
  minuteData.save()

  let hourData = getOrCreateUnitHourData(unit, event)
  hourData.close = newPrice
  if (newPrice.gt(hourData.high)) {
    hourData.high = newPrice
  }
  if (newPrice.lt(hourData.low) || hourData.low.equals(ZERO_BD)) {
    hourData.low = newPrice
  }
  hourData.liquidity = reserveUsdc
  hourData.save()

  let dayData = getOrCreateUnitDayData(unit, event)
  dayData.close = newPrice
  if (newPrice.gt(dayData.high)) {
    dayData.high = newPrice
  }
  if (newPrice.lt(dayData.low) || dayData.low.equals(ZERO_BD)) {
    dayData.low = newPrice
  }
  dayData.liquidity = reserveUsdc
  dayData.totalSupply = unit.totalSupply
  dayData.totalMinted = unit.totalMinted
  dayData.save()

  unit.save()

  // Update Protocol liquidity
  let protocol = getOrCreateProtocol()
  protocol.totalLiquidityUsdc = protocol.totalLiquidityUsdc
    .minus(previousLiquidity)
    .plus(reserveUsdc)
  if (protocol.totalLiquidityUsdc.lt(ZERO_BD)) {
    protocol.totalLiquidityUsdc = ZERO_BD
  }
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

  // Parse swap amounts - Unit has 18 decimals, USDC has 6 decimals
  let amountUnitIn: BigDecimal
  let amountUnitOut: BigDecimal
  let amountUsdcIn: BigDecimal
  let amountUsdcOut: BigDecimal

  if (isUnitToken0) {
    amountUnitIn = convertTokenToDecimal(event.params.amount0In, BI_18)
    amountUnitOut = convertTokenToDecimal(event.params.amount0Out, BI_18)
    amountUsdcIn = convertTokenToDecimal(event.params.amount1In, BI_6)
    amountUsdcOut = convertTokenToDecimal(event.params.amount1Out, BI_6)
  } else {
    amountUnitIn = convertTokenToDecimal(event.params.amount1In, BI_18)
    amountUnitOut = convertTokenToDecimal(event.params.amount1Out, BI_18)
    amountUsdcIn = convertTokenToDecimal(event.params.amount0In, BI_6)
    amountUsdcOut = convertTokenToDecimal(event.params.amount0Out, BI_6)
  }

  // Determine swap type: buy or sell
  // Buy = USDC in, Unit out (user buying Unit with USDC)
  // Sell = Unit in, USDC out (user selling Unit for USDC)
  let isBuy = amountUsdcIn.gt(ZERO_BD) && amountUnitOut.gt(ZERO_BD)
  let swapType = isBuy ? 'buy' : 'sell'

  // Calculate amounts for the swap
  let amountUnit = isBuy ? amountUnitOut : amountUnitIn
  let amountUsdc = isBuy ? amountUsdcIn : amountUsdcOut

  // Calculate execution price
  let price = ZERO_BD
  if (amountUnit.gt(ZERO_BD)) {
    price = amountUsdc.div(amountUnit)
  }

  // Get or create account
  let account = getOrCreateAccount(event.params.to)
  account.totalSwapVolume = account.totalSwapVolume.plus(amountUsdc)
  account.lastActivityAt = event.block.timestamp
  account.save()

  // Create Swap entity
  let swapId = event.transaction.hash.toHexString() + '-' + event.logIndex.toString()
  let swap = new Swap(swapId)
  swap.unit = unit.id
  swap.account = account.id
  swap.type = swapType
  swap.amountUnit = amountUnit
  swap.amountUsdc = amountUsdc
  swap.price = price
  swap.timestamp = event.block.timestamp
  swap.blockNumber = event.block.number
  swap.txHash = event.transaction.hash
  swap.logIndex = event.logIndex
  swap.save()

  // Update Unit volume stats
  unit.volumeTotal = unit.volumeTotal.plus(amountUsdc)
  unit.txCount = unit.txCount.plus(ONE_BI)
  unit.lastSwapAt = event.block.timestamp
  unit.lastActivityAt = event.block.timestamp
  unit.save()

  // Update minute data
  let minuteData = getOrCreateUnitMinuteData(unit, event)
  minuteData.volumeUnit = minuteData.volumeUnit.plus(amountUnit)
  minuteData.volumeUsdc = minuteData.volumeUsdc.plus(amountUsdc)
  minuteData.txCount = minuteData.txCount.plus(ONE_BI)
  minuteData.save()

  // Update hour data
  let hourData = getOrCreateUnitHourData(unit, event)
  hourData.volumeUnit = hourData.volumeUnit.plus(amountUnit)
  hourData.volumeUsdc = hourData.volumeUsdc.plus(amountUsdc)
  hourData.txCount = hourData.txCount.plus(ONE_BI)
  hourData.save()

  // Update day data
  let dayData = getOrCreateUnitDayData(unit, event)
  dayData.volumeUnit = dayData.volumeUnit.plus(amountUnit)
  dayData.volumeUsdc = dayData.volumeUsdc.plus(amountUsdc)
  dayData.txCount = dayData.txCount.plus(ONE_BI)
  dayData.save()

  // Keep convenience aggregates in sync for API consumers.
  unit.volume24h = dayData.volumeUsdc
  unit.txCount24h = dayData.txCount
  unit.save()

  // Update Protocol volume
  let protocol = getOrCreateProtocol()
  protocol.totalVolumeUsdc = protocol.totalVolumeUsdc.plus(amountUsdc)
  protocol.lastUpdated = event.block.timestamp
  protocol.save()
}
