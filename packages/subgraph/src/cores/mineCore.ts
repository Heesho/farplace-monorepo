import { Address } from '@graphprotocol/graph-ts'
import { MineCore__Launched as CoreLaunchedEvent } from '../../generated/MineCore/MineCore'
import {
  UniswapV2Pair as PairTemplate,
  MineRig as MineRigTemplate,
  Unit as UnitTemplate,
} from '../../generated/templates'
import { Protocol, Unit, Rig, MineRig, Account } from '../../generated/schema'
import {
  ZERO_BI,
  ONE_BI,
  ZERO_BD,
  PROTOCOL_ID,
  BI_18,
  RIG_TYPE_MINE,
} from '../constants'
import {
  getOrCreateProtocol,
  getOrCreateAccount,
  createUnit,
  convertTokenToDecimal,
} from '../helpers'

export function handleMineCoreLaunched(event: CoreLaunchedEvent): void {
  // Load or create Protocol entity (singleton)
  let protocol = getOrCreateProtocol()
  protocol.totalUnits = protocol.totalUnits.plus(ONE_BI)
  protocol.totalRigs = protocol.totalRigs.plus(ONE_BI)
  protocol.lastUpdated = event.block.timestamp
  protocol.save()

  // Load or create launcher Account
  let launcher = getOrCreateAccount(event.params.launcher)

  // Event params for MineCore:
  // launcher, quoteToken, unit, rig, auction, lpToken, tokenName, tokenSymbol, uri,
  // donutAmount, unitAmount, initialUps, tailUps, halvingAmount, rigEpochPeriod,
  // rigPriceMultiplier, rigMinInitPrice, auctionInitPrice, auctionEpochPeriod, auctionPriceMultiplier, auctionMinInitPrice

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
  rig.rigType = RIG_TYPE_MINE
  rig.launcher = launcher.id
  rig.auction = event.params.auction
  rig.quoteToken = quoteToken
  rig.uri = event.params.uri
  rig.initialUps = event.params.initialUps
  rig.tailUps = event.params.tailUps
  rig.halvingPeriod = event.params.halvingAmount
  rig.treasuryRevenue = ZERO_BD
  rig.teamRevenue = ZERO_BD
  rig.protocolRevenue = ZERO_BD
  rig.totalMinted = ZERO_BD
  rig.lastActivityAt = event.block.timestamp
  rig.createdAt = event.block.timestamp
  rig.createdAtBlock = event.block.number
  rig.save()

  // Create MineRig specialized entity
  let mineRig = new MineRig(rigAddress.toHexString())
  mineRig.rig = rig.id
  mineRig.initialUps = event.params.initialUps
  mineRig.tailUps = event.params.tailUps
  mineRig.halvingAmount = event.params.halvingAmount
  mineRig.capacity = ONE_BI // Default, updated via CapacitySet event
  mineRig.epochPeriod = event.params.rigEpochPeriod
  mineRig.priceMultiplier = convertTokenToDecimal(event.params.rigPriceMultiplier, BI_18)
  mineRig.minInitPrice = convertTokenToDecimal(event.params.rigMinInitPrice, BI_18)
  mineRig.activeMiners = ZERO_BI
  mineRig.totalMines = ZERO_BI
  mineRig.save()

  // Link rig to mineRig
  rig.mineRig = mineRig.id
  rig.save()

  // Link unit to rig
  unit.rig = rig.id
  unit.save()

  // Start indexing events from the new contracts
  PairTemplate.create(lpPairAddress)
  MineRigTemplate.create(rigAddress)
  UnitTemplate.create(unitAddress)
}
