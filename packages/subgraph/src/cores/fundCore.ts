import { Address } from '@graphprotocol/graph-ts'
import { FundCore__Launched as FundCoreLaunchedEvent } from '../../generated/FundCore/FundCore'
import {
  UniswapV2Pair as PairTemplate,
  FundRig as FundRigTemplate,
  Unit as UnitTemplate,
} from '../../generated/templates'
import { Protocol, Unit, Rig, FundRig, Account } from '../../generated/schema'
import {
  ZERO_BI,
  ONE_BI,
  ZERO_BD,
  PROTOCOL_ID,
  BI_18,
  RIG_TYPE_CHARITY,
} from '../constants'
import {
  getOrCreateProtocol,
  getOrCreateAccount,
  createUnit,
  convertTokenToDecimal,
} from '../helpers'

export function handleFundCoreLaunched(event: FundCoreLaunchedEvent): void {
  // Load or create Protocol entity (singleton)
  let protocol = getOrCreateProtocol()
  protocol.totalUnits = protocol.totalUnits.plus(ONE_BI)
  protocol.totalRigs = protocol.totalRigs.plus(ONE_BI)
  protocol.lastUpdated = event.block.timestamp
  protocol.save()

  // Load or create launcher Account
  let launcher = getOrCreateAccount(event.params.launcher)

  // Event params for FundCore:
  // launcher (indexed), rig (indexed), unit (indexed), auction, lpToken, quoteToken,
  // tokenName, tokenSymbol, donutAmount, unitAmount, initialEmission, minEmission,
  // minDonation, auctionInitPrice, auctionEpochPeriod, auctionPriceMultiplier, auctionMinInitPrice

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
  rig.rigType = RIG_TYPE_CHARITY
  rig.launcher = launcher.id
  rig.auction = event.params.auction
  rig.quoteToken = quoteToken
  rig.uri = '' // FundCore doesn't have uri param
  rig.initialUps = event.params.initialEmission
  rig.tailUps = event.params.minEmission
  rig.halvingPeriod = ZERO_BI // FundRig uses daily emissions, not halving
  rig.treasuryRevenue = ZERO_BD
  rig.teamRevenue = ZERO_BD
  rig.protocolRevenue = ZERO_BD
  rig.totalMinted = ZERO_BD
  rig.lastActivityAt = event.block.timestamp
  rig.createdAt = event.block.timestamp
  rig.createdAtBlock = event.block.number
  rig.save()

  // Create FundRig specialized entity
  let fundRig = new FundRig(rigAddress.toHexString())
  fundRig.rig = rig.id
  fundRig.currentDay = ZERO_BI
  fundRig.totalDonated = ZERO_BD
  fundRig.totalMinted = ZERO_BD
  fundRig.uniqueDonors = ZERO_BI
  fundRig.save()

  // Link rig to fundRig
  rig.fundRig = fundRig.id
  rig.save()

  // Link unit to rig
  unit.rig = rig.id
  unit.save()

  // Start indexing events from the new contracts
  PairTemplate.create(lpPairAddress)
  FundRigTemplate.create(rigAddress)
  UnitTemplate.create(unitAddress)
}
