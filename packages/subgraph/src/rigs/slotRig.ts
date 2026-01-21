import { BigDecimal, BigInt, Address } from '@graphprotocol/graph-ts'
import {
  SlotRig__Slot as SlotEvent,
  SlotRig__Win as WinEvent,
  SlotRig__TreasuryFee as TreasuryFeeEvent,
  SlotRig__TeamFee as TeamFeeEvent,
} from '../../generated/templates/SlotRig/SlotRig'
import {
  Rig,
  SlotRig,
  Slot,
  Account,
  Unit,
  Protocol,
} from '../../generated/schema'
import {
  ZERO_BI,
  ONE_BI,
  ZERO_BD,
  BI_18,
  PROTOCOL_ID,
} from '../constants'
import {
  convertTokenToDecimal,
  getOrCreateProtocol,
  getOrCreateAccount,
} from '../helpers'

// Map to track pending slots waiting for VRF callback
// Key: sequenceNumber, Value: slotId
// Note: In AssemblyScript we can't use global maps, so we use entity lookups

export function handleSlot(event: SlotEvent): void {
  let rigAddress = event.address.toHexString()
  let slotRig = SlotRig.load(rigAddress)
  if (slotRig === null) return

  let rig = Rig.load(rigAddress)
  if (rig === null) return

  let unit = Unit.load(rig.unit)
  if (unit === null) return

  // Event params: sender (indexed), slotner (indexed), epochId (indexed), price
  let senderAddress = event.params.sender
  let slotnerAddress = event.params.slotner
  let epochId = event.params.epochId
  let price = convertTokenToDecimal(event.params.price, BI_18)

  // Get or create slotner account
  let slotner = getOrCreateAccount(slotnerAddress)
  slotner.totalRigSpend = slotner.totalRigSpend.plus(price)
  slotner.lastActivityAt = event.block.timestamp
  slotner.save()

  // Create Slot entity
  let slotId = event.transaction.hash.toHexString() + '-' + event.logIndex.toString()
  let slot = new Slot(slotId)
  slot.slotRig = slotRig.id
  slot.slotner = slotner.id
  slot.epochId = epochId
  slot.price = price
  slot.won = false // Will be updated by Win event
  slot.winAmount = ZERO_BD
  slot.oddsBps = ZERO_BI
  slot.timestamp = event.block.timestamp
  slot.blockNumber = event.block.number
  slot.txHash = event.transaction.hash
  slot.save()

  // Update SlotRig Dutch auction state
  slotRig.currentEpochId = epochId.plus(ONE_BI)
  slotRig.initPrice = price.times(slotRig.priceMultiplier)
  slotRig.slotStartTime = event.block.timestamp

  // Update SlotRig stats
  slotRig.totalSlots = slotRig.totalSlots.plus(ONE_BI)
  slotRig.totalSpent = slotRig.totalSpent.plus(price)
  slotRig.save()

  // Update Rig activity
  rig.lastActivityAt = event.block.timestamp
  rig.save()

  // Update Unit activity
  unit.lastRigActivityAt = event.block.timestamp
  unit.lastActivityAt = event.block.timestamp
  unit.save()
}

export function handleWin(event: WinEvent): void {
  let rigAddress = event.address.toHexString()
  let slotRig = SlotRig.load(rigAddress)
  if (slotRig === null) return

  let rig = Rig.load(rigAddress)
  if (rig === null) return

  // Event params: slotner (indexed), epochId (indexed), oddsBps, amount
  let slotnerAddress = event.params.slotner
  let epochId = event.params.epochId
  let oddsBps = event.params.oddsBps
  let amount = convertTokenToDecimal(event.params.amount, BI_18)

  // Get winner account
  let winner = getOrCreateAccount(slotnerAddress)
  winner.totalWon = winner.totalWon.plus(amount)
  winner.save()

  // Update SlotRig stats
  slotRig.totalWins = slotRig.totalWins.plus(ONE_BI)
  slotRig.totalWonAmount = slotRig.totalWonAmount.plus(amount)
  slotRig.save()

  // Note: We can't easily link back to the original Slot entity without
  // tracking the sequenceNumber -> slotId mapping. The Win event happens
  // in a different transaction (VRF callback).
  // For now, we just update aggregate stats.
}

export function handleSlotTreasuryFee(event: TreasuryFeeEvent): void {
  // Event params: treasury (indexed), epochId (indexed), amount
  let rigAddress = event.address.toHexString()
  let amount = convertTokenToDecimal(event.params.amount, BI_18)

  let rig = Rig.load(rigAddress)
  if (rig === null) return

  rig.treasuryRevenue = rig.treasuryRevenue.plus(amount)
  rig.save()

  // Update Protocol treasury revenue
  let protocol = getOrCreateProtocol()
  protocol.totalTreasuryRevenue = protocol.totalTreasuryRevenue.plus(amount)
  protocol.lastUpdated = event.block.timestamp
  protocol.save()
}

export function handleSlotTeamFee(event: TeamFeeEvent): void {
  // Event params: team (indexed), epochId (indexed), amount
  let rigAddress = event.address.toHexString()
  let amount = convertTokenToDecimal(event.params.amount, BI_18)

  let rig = Rig.load(rigAddress)
  if (rig === null) return

  rig.teamRevenue = rig.teamRevenue.plus(amount)
  rig.save()
}
