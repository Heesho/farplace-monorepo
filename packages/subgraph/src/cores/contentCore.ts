import { Address } from '@graphprotocol/graph-ts'
import { ContentCore__Launched as ContentCoreLaunchedEvent } from '../../generated/ContentCore/ContentCore'
import {
  UniswapV2Pair as PairTemplate,
  ContentRig as ContentRigTemplate,
  Unit as UnitTemplate,
} from '../../generated/templates'
import { Protocol, Unit, Rig, ContentRig, Account } from '../../generated/schema'
import {
  ZERO_BI,
  ONE_BI,
  ZERO_BD,
  PROTOCOL_ID,
  BI_18,
  BI_6,
  RIG_TYPE_CONTENT,
} from '../constants'
import {
  getOrCreateProtocol,
  getOrCreateAccount,
  createUnit,
  convertTokenToDecimal,
} from '../helpers'

export function handleContentCoreLaunched(event: ContentCoreLaunchedEvent): void {
  // Load or create Protocol entity (singleton)
  let protocol = getOrCreateProtocol()
  protocol.totalUnits = protocol.totalUnits.plus(ONE_BI)
  protocol.totalRigs = protocol.totalRigs.plus(ONE_BI)
  protocol.lastUpdated = event.block.timestamp
  protocol.save()

  // Load or create launcher Account
  let launcher = getOrCreateAccount(event.params.launcher)

  // Event params for ContentCore:
  // launcher (indexed), rig (indexed), unit (indexed), minter, rewarder, auction, lpToken,
  // tokenName, tokenSymbol, uri, donutAmount, unitAmount, initialUps, tailUps, halvingPeriod,
  // contentMinInitPrice, contentIsModerated, auctionInitPrice, auctionEpochPeriod,
  // auctionPriceMultiplier, auctionMinInitPrice

  let unitAddress = event.params.unit
  let rigAddress = event.params.rig
  let lpPairAddress = event.params.lpToken

  // Create Unit entity - ContentRig uses USDC (6 decimals) as quote token typically
  let unit = createUnit(
    unitAddress,
    lpPairAddress,
    Address.zero(), // ContentRig doesn't have quoteToken in launched event directly
    launcher,
    event.params.tokenName,
    event.params.tokenSymbol,
    event
  )

  // Create general Rig entity
  let rig = new Rig(rigAddress.toHexString())
  rig.unit = unit.id
  rig.rigType = RIG_TYPE_CONTENT
  rig.launcher = launcher.id
  rig.auction = event.params.auction
  rig.quoteToken = Address.zero() // ContentRig uses USDC for content collection
  rig.uri = event.params.uri
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

  // Create ContentRig specialized entity
  let contentRig = new ContentRig(rigAddress.toHexString())
  contentRig.rig = rig.id
  contentRig.minInitPrice = convertTokenToDecimal(event.params.contentMinInitPrice, BI_6)
  contentRig.isModerated = event.params.contentIsModerated
  contentRig.minter = event.params.minter
  contentRig.rewarder = event.params.rewarder
  contentRig.totalContent = ZERO_BI
  contentRig.totalCollections = ZERO_BI
  contentRig.totalStaked = ZERO_BD
  contentRig.save()

  // Link rig to contentRig
  rig.contentRig = contentRig.id
  rig.save()

  // Link unit to rig
  unit.rig = rig.id
  unit.save()

  // Start indexing events from the new contracts
  PairTemplate.create(lpPairAddress)
  ContentRigTemplate.create(rigAddress)
  UnitTemplate.create(unitAddress)
}
