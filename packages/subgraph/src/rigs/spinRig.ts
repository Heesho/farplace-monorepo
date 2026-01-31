import { BigDecimal, BigInt, Address } from '@graphprotocol/graph-ts'
import {
  SpinRig__Spin as SpinEvent,
  SpinRig__Win as WinEvent,
  SpinRig__TreasuryFee as TreasuryFeeEvent,
  SpinRig__TeamFee as TeamFeeEvent,
  SpinRig__ProtocolFee as ProtocolFeeEvent,
} from '../../generated/templates/SpinRig/SpinRig'
import {
  Rig,
  SlotRig,
  Spin,
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

// Map to track pending spins waiting for VRF callback
// Key: sequenceNumber, Value: spinId
// Note: In AssemblyScript we can't use global maps, so we use entity lookups

export function handleSpin(event: SpinEvent): void {
  let rigAddress = event.address.toHexString()
  let slotRig = SlotRig.load(rigAddress)
  if (slotRig === null) return

  let rig = Rig.load(rigAddress)
  if (rig === null) return

  let unit = Unit.load(rig.unit)
  if (unit === null) return

  // Event params: sender (indexed), spinner (indexed), epochId (indexed), price
  let senderAddress = event.params.sender
  let spinnerAddress = event.params.spinner
  let epochId = event.params.epochId
  let price = convertTokenToDecimal(event.params.price, BI_18)

  // Get or create spinner account
  let spinner = getOrCreateAccount(spinnerAddress)
  spinner.totalRigSpend = spinner.totalRigSpend.plus(price)
  spinner.lastActivityAt = event.block.timestamp
  spinner.save()

  // Create Spin entity
  let spinId = event.transaction.hash.toHexString() + '-' + event.logIndex.toString()
  let spin = new Spin(spinId)
  spin.slotRig = slotRig.id
  spin.spinner = spinner.id
  spin.epochId = epochId
  spin.price = price
  spin.won = false // Will be updated by Win event
  spin.winAmount = ZERO_BD
  spin.oddsBps = ZERO_BI
  spin.timestamp = event.block.timestamp
  spin.blockNumber = event.block.number
  spin.txHash = event.transaction.hash
  spin.save()

  // Update SlotRig Dutch auction state
  slotRig.currentEpochId = epochId.plus(ONE_BI)
  slotRig.initPrice = price.times(slotRig.priceMultiplier)
  slotRig.slotStartTime = event.block.timestamp

  // Update SlotRig stats
  slotRig.totalSpins = slotRig.totalSpins.plus(ONE_BI)
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

  // Event params: spinner (indexed), epochId (indexed), oddsBps, amount
  let spinnerAddress = event.params.spinner
  let epochId = event.params.epochId
  let oddsBps = event.params.oddsBps
  let amount = convertTokenToDecimal(event.params.amount, BI_18)

  // Get winner account
  let winner = getOrCreateAccount(spinnerAddress)
  winner.totalWon = winner.totalWon.plus(amount)
  winner.save()

  // Update SlotRig stats
  slotRig.totalWins = slotRig.totalWins.plus(ONE_BI)
  slotRig.totalWonAmount = slotRig.totalWonAmount.plus(amount)
  slotRig.save()

  // Note: We can't easily link back to the original Spin entity without
  // tracking the sequenceNumber -> spinId mapping. The Win event happens
  // in a different transaction (VRF callback).
  // For now, we just update aggregate stats.
}

export function handleSpinTreasuryFee(event: TreasuryFeeEvent): void {
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

export function handleSpinTeamFee(event: TeamFeeEvent): void {
  // Event params: team (indexed), epochId (indexed), amount
  let rigAddress = event.address.toHexString()
  let amount = convertTokenToDecimal(event.params.amount, BI_18)

  let rig = Rig.load(rigAddress)
  if (rig === null) return

  rig.teamRevenue = rig.teamRevenue.plus(amount)
  rig.save()
}

export function handleSpinProtocolFee(event: ProtocolFeeEvent): void {
  // Event params: protocol (indexed), epochId (indexed), amount
  let rigAddress = event.address.toHexString()
  let amount = convertTokenToDecimal(event.params.amount, BI_18)

  let rig = Rig.load(rigAddress)
  if (rig === null) return

  rig.protocolRevenue = rig.protocolRevenue.plus(amount)
  rig.save()

  // Update Protocol total revenue
  let protocol = getOrCreateProtocol()
  protocol.totalProtocolRevenue = protocol.totalProtocolRevenue.plus(amount)
  protocol.lastUpdated = event.block.timestamp
  protocol.save()
}
