import { Address, BigInt } from '@graphprotocol/graph-ts'
import { SpinCore__Launched as SpinCoreLaunchedEvent } from '../../generated/SpinCore/SpinCore'
import {
  UniswapV2Pair as PairTemplate,
  SpinRig as SpinRigTemplate,
  Unit as UnitTemplate,
} from '../../generated/templates'
import { Protocol, Unit, Rig, SpinRig, Account } from '../../generated/schema'
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

export function handleSpinCoreLaunched(event: SpinCoreLaunchedEvent): void {
  // Load or create Protocol entity (singleton)
  let protocol = getOrCreateProtocol()
  protocol.totalUnits = protocol.totalUnits.plus(ONE_BI)
  protocol.totalRigs = protocol.totalRigs.plus(ONE_BI)
  protocol.lastUpdated = event.block.timestamp
  protocol.save()

  // Load or create launcher Account
  let launcher = getOrCreateAccount(event.params.launcher)

  // Event params for SpinCore:
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
  rig.uri = '' // SpinCore doesn't have uri param
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

  // Create SpinRig specialized entity
  let spinRig = new SpinRig(rigAddress.toHexString())
  spinRig.rig = rig.id
  spinRig.initialUps = event.params.initialUps
  spinRig.tailUps = event.params.tailUps
  spinRig.halvingPeriod = event.params.halvingPeriod
  spinRig.epochPeriod = event.params.rigEpochPeriod
  spinRig.priceMultiplier = convertTokenToDecimal(event.params.rigPriceMultiplier, BI_18)
  spinRig.minInitPrice = convertTokenToDecimal(event.params.rigMinInitPrice, BI_18)

  // Dutch auction state
  spinRig.currentEpochId = ZERO_BI
  spinRig.initPrice = spinRig.minInitPrice
  spinRig.slotStartTime = event.block.timestamp

  // Prize pool
  spinRig.prizePool = ZERO_BD
  spinRig.currentOdds = new Array<BigInt>()

  // Stats
  spinRig.totalSpins = ZERO_BI
  spinRig.totalWins = ZERO_BI
  spinRig.totalWonAmount = ZERO_BD
  spinRig.totalSpent = ZERO_BD
  spinRig.save()

  // Link rig to spinRig
  rig.spinRig = spinRig.id
  rig.save()

  // Link unit to rig
  unit.rig = rig.id
  unit.save()

  // Start indexing events from the new contracts
  PairTemplate.create(lpPairAddress)
  SpinRigTemplate.create(rigAddress)
  UnitTemplate.create(unitAddress)
}
