import { BigDecimal, BigInt, Address } from '@graphprotocol/graph-ts'
import { Transfer as TransferEvent } from '../generated/templates/Unit/ERC20'
import { Unit, Account } from '../generated/schema'
import {
  ZERO_BI,
  ONE_BI,
  ZERO_BD,
  BI_18,
  ADDRESS_ZERO,
} from './constants'
import {
  convertTokenToDecimal,
  getOrCreateAccount,
} from './helpers'

export function handleUnitTransfer(event: TransferEvent): void {
  let unitAddress = event.address.toHexString()
  let unit = Unit.load(unitAddress)
  if (unit === null) return

  let from = event.params.from.toHexString()
  let to = event.params.to.toHexString()
  let value = convertTokenToDecimal(event.params.value, BI_18)

  // Track mints (from zero address)
  if (from == ADDRESS_ZERO) {
    // Mint - increase total supply
    unit.totalSupply = unit.totalSupply.plus(value)
    // Update market cap
    unit.marketCap = unit.price.times(unit.totalSupply)
  }

  // Track burns (to zero address)
  if (to == ADDRESS_ZERO) {
    // Burn - decrease total supply
    unit.totalSupply = unit.totalSupply.minus(value)
    // Update market cap
    unit.marketCap = unit.price.times(unit.totalSupply)
  }

  // Holder tracking (simplified)
  // Note: For accurate holder count, you'd need to track balances per account
  // This is a simplified version that doesn't maintain exact holder count
  // A more accurate implementation would store UnitAccountBalance entities

  // For now, we just track the transfer happened
  // The "from" account had tokens and might still have some
  // The "to" account now has tokens

  // Update accounts
  if (from != ADDRESS_ZERO) {
    let fromAccount = getOrCreateAccount(Address.fromString(from))
    fromAccount.lastActivityAt = event.block.timestamp
    fromAccount.save()
  }

  if (to != ADDRESS_ZERO) {
    let toAccount = getOrCreateAccount(Address.fromString(to))
    toAccount.lastActivityAt = event.block.timestamp
    toAccount.save()
  }

  unit.save()
}
