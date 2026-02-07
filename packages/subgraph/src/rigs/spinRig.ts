import { BigDecimal, BigInt, Address } from '@graphprotocol/graph-ts'
import {
  SpinRig__Spin as SpinEvent,
  SpinRig__Win as WinEvent,
  SpinRig__EmissionMinted as EmissionMintedEvent,
  SpinRig__TreasuryFee as TreasuryFeeEvent,
  SpinRig__TeamFee as TeamFeeEvent,
  SpinRig__ProtocolFee as ProtocolFeeEvent,
  SpinRig__UriSet as UriSetEvent,
} from '../../generated/templates/SpinRig/SpinRig'
import {
  Rig,
  SpinRig,
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
  BI_6,
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
  let spinRig = SpinRig.load(rigAddress)
  if (spinRig === null) return

  let rig = Rig.load(rigAddress)
  if (rig === null) return

  let unit = Unit.load(rig.unit)
  if (unit === null) return

  // Event params: sender (indexed), spinner (indexed), epochId (indexed), price
  let senderAddress = event.params.sender
  let spinnerAddress = event.params.spinner
  let epochId = event.params.epochId
  let price = convertTokenToDecimal(event.params.price, BI_6)

  // Get or create spinner account
  let spinner = getOrCreateAccount(spinnerAddress)
  spinner.totalRigSpend = spinner.totalRigSpend.plus(price)
  spinner.lastActivityAt = event.block.timestamp
  spinner.save()

  // Create Spin entity (ID = rigAddress-epochId so handleWin can look it up)
  let spinId = rigAddress + '-' + epochId.toString()
  let spin = new Spin(spinId)
  spin.spinRig = spinRig.id
  spin.spinner = spinner.id
  spin.epochId = epochId
  spin.price = price
  spin.uri = event.params.uri
  spin.won = false // Will be updated by Win event
  spin.winAmount = ZERO_BD
  spin.oddsBps = ZERO_BI
  spin.timestamp = event.block.timestamp
  spin.blockNumber = event.block.number
  spin.txHash = event.transaction.hash
  spin.save()

  // Update SpinRig Dutch auction state
  spinRig.currentEpochId = epochId.plus(ONE_BI)
  let computedInitPrice = price.times(spinRig.priceMultiplier)
  if (computedInitPrice.lt(spinRig.minInitPrice)) {
    computedInitPrice = spinRig.minInitPrice
  }
  spinRig.initPrice = computedInitPrice
  spinRig.slotStartTime = event.block.timestamp

  // Update SpinRig stats
  spinRig.totalSpins = spinRig.totalSpins.plus(ONE_BI)
  spinRig.totalSpent = spinRig.totalSpent.plus(price)
  spinRig.save()

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
  let spinRig = SpinRig.load(rigAddress)
  if (spinRig === null) return

  let rig = Rig.load(rigAddress)
  if (rig === null) return

  let unit = Unit.load(rig.unit)
  if (unit === null) return

  // Event params: spinner (indexed), epochId (indexed), oddsBps, amount
  let spinnerAddress = event.params.spinner
  let epochId = event.params.epochId
  let oddsBps = event.params.oddsBps
  let amount = convertTokenToDecimal(event.params.amount, BI_18)

  // Get winner account
  let winner = getOrCreateAccount(spinnerAddress)
  winner.totalWon = winner.totalWon.plus(amount)
  winner.save()

  // Update SpinRig stats
  spinRig.totalWins = spinRig.totalWins.plus(ONE_BI)
  spinRig.totalWonAmount = spinRig.totalWonAmount.plus(amount)
  if (spinRig.prizePool.gt(amount)) {
    spinRig.prizePool = spinRig.prizePool.minus(amount)
  } else {
    spinRig.prizePool = ZERO_BD
  }
  spinRig.save()

  // Update the original Spin entity with win results
  let spinId = rigAddress + '-' + epochId.toString()
  let spin = Spin.load(spinId)
  if (spin !== null) {
    spin.won = true
    spin.winAmount = amount
    spin.oddsBps = oddsBps
    spin.save()
  }

  rig.lastActivityAt = event.block.timestamp
  rig.save()

  unit.lastRigActivityAt = event.block.timestamp
  unit.lastActivityAt = event.block.timestamp
  unit.save()
}

export function handleSpinEmissionMinted(event: EmissionMintedEvent): void {
  let rigAddress = event.address.toHexString()
  let spinRig = SpinRig.load(rigAddress)
  if (spinRig === null) return

  let rig = Rig.load(rigAddress)
  if (rig === null) return

  let unit = Unit.load(rig.unit)
  if (unit === null) return

  let amount = convertTokenToDecimal(event.params.amount, BI_18)

  // Emissions are newly minted Unit tokens added to the prize pool.
  spinRig.prizePool = spinRig.prizePool.plus(amount)
  spinRig.save()

  rig.totalMinted = rig.totalMinted.plus(amount)
  rig.save()

  unit.totalMinted = unit.totalMinted.plus(amount)
  unit.save()

  let protocol = getOrCreateProtocol()
  protocol.totalMinted = protocol.totalMinted.plus(amount)
  protocol.lastUpdated = event.block.timestamp
  protocol.save()
}

export function handleSpinTreasuryFee(event: TreasuryFeeEvent): void {
  // Event params: treasury (indexed), epochId (indexed), amount
  let rigAddress = event.address.toHexString()
  let amount = convertTokenToDecimal(event.params.amount, BI_6)

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
  let amount = convertTokenToDecimal(event.params.amount, BI_6)

  let rig = Rig.load(rigAddress)
  if (rig === null) return

  rig.teamRevenue = rig.teamRevenue.plus(amount)
  rig.save()
}

export function handleSpinProtocolFee(event: ProtocolFeeEvent): void {
  // Event params: protocol (indexed), epochId (indexed), amount
  let rigAddress = event.address.toHexString()
  let amount = convertTokenToDecimal(event.params.amount, BI_6)

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

export function handleSpinUriSet(event: UriSetEvent): void {
  let rigAddress = event.address.toHexString()
  let rig = Rig.load(rigAddress)
  if (rig === null) return

  rig.uri = event.params.uri
  rig.save()
}
