import { Address, BigInt } from '@graphprotocol/graph-ts'
import { SlotCore__Launched as SlotCoreLaunchedEvent } from '../../generated/SlotCore/SlotCore'
import {
  UniswapV2Pair as PairTemplate,
  SlotRig as SlotRigTemplate,
  Unit as UnitTemplate,
} from '../../generated/templates'
import { Protocol, Unit, Rig, SlotRig, Account } from '../../generated/schema'
import {
  ZERO_BI,
  ONE_BI,
  ZERO_BD,
  PROTOCOL_ID,
  BI_18,
  RIG_TYPE_SPIN,
} from '../constants'
import {
  getOrCreateProtocol,
  getOrCreateAccount,
  createUnit,
  convertTokenToDecimal,
} from '../helpers'

export function handleSlotCoreLaunched(event: SlotCoreLaunchedEvent): void {
  // Load or create Protocol entity (singleton)
  let protocol = getOrCreateProtocol()
  protocol.totalUnits = protocol.totalUnits.plus(ONE_BI)
  protocol.totalRigs = protocol.totalRigs.plus(ONE_BI)
  protocol.lastUpdated = event.block.timestamp
  protocol.save()

  // Load or create launcher Account
  let launcher = getOrCreateAccount(event.params.launcher)

  // Event params for SlotCore:
  // launcher (indexed), rig (indexed), unit (indexed), auction, lpToken, quoteToken,
  // tokenName, tokenSymbol, donutAmount, unitAmount, initialUps, tailUps, halvingPeriod,
  // rigEpochPeriod, rigPriceMultiplier, rigMinInitPrice, auctionInitPrice, auctionEpochPeriod,
  // auctionPriceMultiplier, auctionMinInitPrice

  let unitAddress = event.params.unit
  let rigAddress = event.params.rig
  let lpPairAddress = event.params.lpToken
  let quoteToken = event.params.quoteToken

  // Create Unit entity
  let unit = createUnit(
    unitAddress,
    lpPairAddress,
    quoteToken,
    launcher,
    event.params.tokenName,
    event.params.tokenSymbol,
    event
  )

  // Create general Rig entity
  let rig = new Rig(rigAddress.toHexString())
  rig.unit = unit.id
  rig.rigType = RIG_TYPE_SPIN
  rig.launcher = launcher.id
  rig.auction = event.params.auction
  rig.quoteToken = quoteToken
  rig.uri = '' // SlotCore doesn't have uri param
  rig.initialUps = event.params.initialUps
  rig.tailUps = event.params.tailUps
  rig.halvingPeriod = event.params.halvingPeriod
  rig.treasuryRevenue = ZERO_BD
  rig.teamRevenue = ZERO_BD
  rig.protocolRevenue = ZERO_BD
  rig.totalMinted = ZERO_BD
  rig.lastActivityAt = event.block.timestamp
  rig.createdAt = event.block.timestamp
  rig.createdAtBlock = event.block.number
  rig.save()

  // Create SlotRig specialized entity
  let slotRig = new SlotRig(rigAddress.toHexString())
  slotRig.rig = rig.id
  slotRig.epochPeriod = event.params.rigEpochPeriod
  slotRig.priceMultiplier = convertTokenToDecimal(event.params.rigPriceMultiplier, BI_18)
  slotRig.minInitPrice = convertTokenToDecimal(event.params.rigMinInitPrice, BI_18)

  // Dutch auction state
  slotRig.currentEpochId = ZERO_BI
  slotRig.initPrice = slotRig.minInitPrice
  slotRig.slotStartTime = event.block.timestamp

  // Prize pool
  slotRig.prizePool = ZERO_BD
  slotRig.currentOdds = new Array<BigInt>()

  // Stats
  slotRig.totalSlots = ZERO_BI
  slotRig.totalWins = ZERO_BI
  slotRig.totalWonAmount = ZERO_BD
  slotRig.totalSpent = ZERO_BD
  slotRig.save()

  // Link rig to slotRig
  rig.slotRig = slotRig.id
  rig.save()

  // Link unit to rig
  unit.rig = rig.id
  unit.save()

  // Start indexing events from the new contracts
  PairTemplate.create(lpPairAddress)
  SlotRigTemplate.create(rigAddress)
  UnitTemplate.create(unitAddress)
}
