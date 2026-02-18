import { Address, BigInt } from '@graphprotocol/graph-ts'
import { FundCore__Launched as FundCoreLaunchedEvent } from '../../generated/FundCore/FundCore'
import { FundRig as FundRigContract } from '../../generated/FundCore/FundRig'
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
  BI_6,
  BI_18,
  RIG_TYPE_FUND,
} from '../constants'
import {
  getOrCreateProtocol,
  getOrCreateAccount,
  createUnit,
  convertTokenToDecimal,
} from '../helpers'

const DEFAULT_MIN_DONATION = BigInt.fromI32(10_000)

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
  // launcher (indexed), rig (indexed), unit (indexed), recipient, auction, lpToken, quoteToken,
  // tokenName, tokenSymbol, uri, usdcAmount, unitAmount, initialEmission, minEmission,
  // minDonation, halvingPeriod, auctionInitPrice, auctionEpochPeriod, auctionPriceMultiplier, auctionMinInitPrice

  let unitAddress = event.params.unit
  let rigAddress = event.params.rig
  let lpPairAddress = event.params.lpToken
  let quoteToken = event.params.quoteToken
  let recipientAddress = event.params.recipient

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
  rig.rigType = RIG_TYPE_FUND
  rig.launcher = launcher.id
  rig.auction = event.params.auction
  rig.quoteToken = quoteToken
  rig.uri = event.params.uri
  rig.usdcAmount = convertTokenToDecimal(event.params.usdcAmount, BI_6)
  rig.unitAmount = convertTokenToDecimal(event.params.unitAmount, BI_18)
  rig.initialUps = event.params.initialEmission
  rig.tailUps = event.params.minEmission
  rig.halvingPeriod = event.params.halvingPeriod
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
  fundRig.initialEmission = event.params.initialEmission
  fundRig.minEmission = event.params.minEmission
  let fundRigContract = FundRigContract.bind(rigAddress)
  let minDonationResult = fundRigContract.try_MIN_DONATION()
  fundRig.minDonation = minDonationResult.reverted ? DEFAULT_MIN_DONATION : minDonationResult.value
  fundRig.halvingPeriod = event.params.halvingPeriod
  fundRig.epochDuration = event.params.epochDuration
  let treasuryResult = fundRigContract.try_treasury()
  fundRig.treasury = treasuryResult.reverted ? Address.zero() : treasuryResult.value
  let teamResult = fundRigContract.try_team()
  fundRig.team = teamResult.reverted ? Address.zero() : teamResult.value
  fundRig.currentDay = ZERO_BI
  fundRig.totalDonated = ZERO_BD
  fundRig.totalMinted = ZERO_BD
  fundRig.uniqueDonors = ZERO_BI
  fundRig.save()

  // Note: initial FundRecipient entity is created by the RecipientSet event handler
  // (emitted from the FundRig constructor)

  // Link rig to fundRig
  rig.fundRig = fundRig.id
  rig.save()

  // Link unit to rig
  // Set initial totalSupply from launch unitAmount — Transfer events fire before
  // the Unit template is active, so the initial LP mint is missed by handleUnitTransfer
  unit.rig = rig.id
  unit.totalSupply = convertTokenToDecimal(event.params.unitAmount, BI_18)
  unit.save()

  // Start indexing events from the new contracts
  PairTemplate.create(lpPairAddress)
  FundRigTemplate.create(rigAddress)
  UnitTemplate.create(unitAddress)
}
