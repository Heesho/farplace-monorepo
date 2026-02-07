import { BigDecimal, BigInt, Address } from '@graphprotocol/graph-ts'
import {
  MineRig__Mine as MineEvent,
  MineRig__MinerFee as MinerFeeEvent,
  MineRig__Mint as MintEvent,
  MineRig__TreasuryFee as TreasuryFeeEvent,
  MineRig__TeamFee as TeamFeeEvent,
  MineRig__ProtocolFee as ProtocolFeeEvent,
  MineRig__CapacitySet as CapacitySetEvent,
  MineRig__UriSet as UriSetEvent,
  MineRig__Claimed as ClaimedEvent,
} from '../../generated/templates/MineRig/MineRig'
import {
  Rig,
  MineRig,
  MineSlot,
  MineAction,
  MineClaim,
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

// Helper to get slot ID
function getSlotId(rigAddress: string, slotIndex: BigInt): string {
  return rigAddress + '-' + slotIndex.toString()
}

// Helper to get mine action ID (one action per rig/slot/epoch)
function getMineActionId(rigAddress: string, slotIndex: BigInt, epochId: BigInt): string {
  return rigAddress + '-' + slotIndex.toString() + '-' + epochId.toString()
}

// Helper to get or create a slot
function getOrCreateSlot(mineRig: MineRig, slotIndex: BigInt): MineSlot {
  let slotId = getSlotId(mineRig.id, slotIndex)
  let slot = MineSlot.load(slotId)
  if (slot === null) {
    slot = new MineSlot(slotId)
    slot.mineRig = mineRig.id
    slot.index = slotIndex
    slot.epochId = ZERO_BI
    slot.currentMiner = null
    slot.uri = ''
    slot.initPrice = ZERO_BD
    slot.startTime = ZERO_BI
    slot.minted = ZERO_BD
    slot.lastMined = ZERO_BI
  }
  return slot
}

export function handleMine(event: MineEvent): void {
  let rigAddress = event.address.toHexString()
  let mineRig = MineRig.load(rigAddress)
  if (mineRig === null) return

  let rig = Rig.load(rigAddress)
  if (rig === null) return

  let unit = Unit.load(rig.unit)
  if (unit === null) return

  // Event params: sender (address), miner (indexed), index (indexed), epochId (indexed), price, uri
  let senderAddress = event.params.sender
  let minerAddress = event.params.miner
  let slotIndex = event.params.index
  let epochId = event.params.epochId
  let price = convertTokenToDecimal(event.params.price, BI_6)
  let uri = event.params.uri

  // Get or create accounts
  let miner = getOrCreateAccount(minerAddress)
  miner.totalRigSpend = miner.totalRigSpend.plus(price)
  miner.lastActivityAt = event.block.timestamp
  miner.save()

  // Get or create slot
  let slot = getOrCreateSlot(mineRig, slotIndex)
  let prevMinerAccount = slot.currentMiner

  // Create MineAction for this mine.
  // earned/minted will be filled in when this miner is DISPLACED (by a future
  // MinerFee/Mint event targeting epochId - 1).
  let mineId = getMineActionId(rigAddress, slotIndex, epochId)
  let mine = new MineAction(mineId)
  mine.mineRig = mineRig.id
  mine.slot = slot.id
  mine.miner = miner.id
  mine.prevMiner = prevMinerAccount
  mine.slotIndex = slotIndex
  mine.epochId = epochId
  mine.uri = uri
  mine.price = price
  mine.minted = ZERO_BD
  mine.earned = ZERO_BD
  mine.timestamp = event.block.timestamp
  mine.blockNumber = event.block.number
  mine.txHash = event.transaction.hash
  mine.save()

  // Update slot state
  slot.epochId = epochId.plus(ONE_BI)
  slot.currentMiner = miner.id
  slot.uri = uri
  slot.startTime = event.block.timestamp
  slot.lastMined = event.block.timestamp
  // initPrice mirrors on-chain logic: price * priceMultiplier, clamped to minInitPrice
  let computedInitPrice = price.times(mineRig.priceMultiplier)
  if (computedInitPrice.lt(mineRig.minInitPrice)) {
    computedInitPrice = mineRig.minInitPrice
  }
  slot.initPrice = computedInitPrice
  slot.save()

  // Update MineRig stats
  mineRig.totalMines = mineRig.totalMines.plus(ONE_BI)
  // Update active miners (if this is a new slot being filled)
  if (prevMinerAccount === null) {
    mineRig.activeMiners = mineRig.activeMiners.plus(ONE_BI)
  }
  mineRig.save()

  // Update Rig activity
  rig.lastActivityAt = event.block.timestamp
  rig.save()

  // Update Unit activity
  unit.lastRigActivityAt = event.block.timestamp
  unit.lastActivityAt = event.block.timestamp
  unit.save()
}

export function handleMineMinerFee(event: MinerFeeEvent): void {
  // Event params: miner (indexed), index (indexed), epochId (indexed), amount
  // The fee goes to the PREVIOUS miner (being displaced). The epochId in the event
  // is the current epoch; the previous miner's MineAction is at epochId - 1.
  let rigAddress = event.address.toHexString()
  let slotIndex = event.params.index
  let epochId = event.params.epochId
  let amount = convertTokenToDecimal(event.params.amount, BI_6)

  if (epochId.gt(ZERO_BI)) {
    let prevMineId = getMineActionId(rigAddress, slotIndex, epochId.minus(ONE_BI))
    let prevAction = MineAction.load(prevMineId)
    if (prevAction !== null) {
      prevAction.earned = prevAction.earned.plus(amount)
      prevAction.save()
    }
  }
}

export function handleMineMint(event: MintEvent): void {
  // Event params: miner (indexed), index (indexed), epochId (indexed), amount
  // Tokens are minted to the PREVIOUS miner (being displaced). The epochId in the
  // event is the current epoch; the previous miner's MineAction is at epochId - 1.
  let rigAddress = event.address.toHexString()
  let minerAddress = event.params.miner
  let slotIndex = event.params.index
  let epochId = event.params.epochId
  let amount = convertTokenToDecimal(event.params.amount, BI_18)

  let rig = Rig.load(rigAddress)
  if (rig === null) return

  let mineRig = MineRig.load(rigAddress)
  if (mineRig === null) return

  let unit = Unit.load(rig.unit)
  if (unit === null) return

  // Update miner stats
  let miner = getOrCreateAccount(minerAddress)
  miner.totalMined = miner.totalMined.plus(amount)
  miner.save()

  // Update the PREVIOUS epoch's MineAction with minted tokens
  if (epochId.gt(ZERO_BI)) {
    let prevMineId = getMineActionId(rigAddress, slotIndex, epochId.minus(ONE_BI))
    let prevAction = MineAction.load(prevMineId)
    if (prevAction !== null) {
      prevAction.minted = prevAction.minted.plus(amount)
      prevAction.save()
    }
  }

  // Update slot minted
  let slot = getOrCreateSlot(mineRig, slotIndex)
  slot.minted = slot.minted.plus(amount)
  slot.save()

  // Update Rig total minted
  rig.totalMinted = rig.totalMinted.plus(amount)
  rig.save()

  // Update Unit total minted
  unit.totalMinted = unit.totalMinted.plus(amount)
  unit.save()

  // Update Protocol total minted
  let protocol = getOrCreateProtocol()
  protocol.totalMinted = protocol.totalMinted.plus(amount)
  protocol.lastUpdated = event.block.timestamp
  protocol.save()
}

export function handleMineTreasuryFee(event: TreasuryFeeEvent): void {
  // Event params: treasury (indexed), index (indexed), epochId (indexed), amount
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

export function handleMineTeamFee(event: TeamFeeEvent): void {
  // Event params: team (indexed), index (indexed), epochId (indexed), amount
  let rigAddress = event.address.toHexString()
  let amount = convertTokenToDecimal(event.params.amount, BI_6)

  let rig = Rig.load(rigAddress)
  if (rig === null) return

  rig.teamRevenue = rig.teamRevenue.plus(amount)
  rig.save()
}

export function handleMineProtocolFee(event: ProtocolFeeEvent): void {
  // Event params: protocol (indexed), index (indexed), epochId (indexed), amount
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

export function handleMineCapacitySet(event: CapacitySetEvent): void {
  let rigAddress = event.address.toHexString()
  let mineRig = MineRig.load(rigAddress)
  if (mineRig === null) return

  mineRig.capacity = event.params.capacity
  mineRig.save()
}

export function handleMineUriSet(event: UriSetEvent): void {
  let rigAddress = event.address.toHexString()
  let rig = Rig.load(rigAddress)
  if (rig === null) return

  rig.uri = event.params.uri
  rig.save()
}

export function handleMineClaimed(event: ClaimedEvent): void {
  let rigAddress = event.address.toHexString()
  let mineRig = MineRig.load(rigAddress)
  if (mineRig === null) return

  let claimerAddress = event.params.account
  let amount = convertTokenToDecimal(event.params.amount, BI_6)

  let claimer = getOrCreateAccount(claimerAddress)
  claimer.lastActivityAt = event.block.timestamp
  claimer.save()

  let claimId = event.transaction.hash.toHexString() + '-' + event.logIndex.toString()
  let claim = new MineClaim(claimId)
  claim.mineRig = mineRig.id
  claim.claimer = claimer.id
  claim.amount = amount
  claim.timestamp = event.block.timestamp
  claim.blockNumber = event.block.number
  claim.txHash = event.transaction.hash
  claim.save()
}
