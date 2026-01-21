import { BigDecimal, BigInt, Address } from '@graphprotocol/graph-ts'
import {
  ContentRig__Created as ContentCreatedEvent,
  ContentRig__Collected as ContentCollectedEvent,
  ContentRig__Claimed as ContentClaimedEvent,
} from '../../generated/templates/ContentRig/ContentRig'
import {
  Rig,
  ContentRig,
  Content,
  Collection,
  ContentClaim,
  Account,
  Unit,
  Protocol,
} from '../../generated/schema'
import {
  ZERO_BI,
  ONE_BI,
  ZERO_BD,
  BI_6,
  BI_18,
  PROTOCOL_ID,
} from '../constants'
import {
  convertTokenToDecimal,
  getOrCreateProtocol,
  getOrCreateAccount,
} from '../helpers'

// Fee constants for ContentRig (basis points)
const OWNER_FEE = BigInt.fromI32(8000) // 80%
const CREATOR_FEE = BigInt.fromI32(300) // 3%
const TREASURY_FEE = BigInt.fromI32(1200) // 12% (remainder)
const TEAM_FEE = BigInt.fromI32(400) // 4%
const PROTOCOL_FEE = BigInt.fromI32(100) // 1%
const DIVISOR = BigInt.fromI32(10000)

function calculateFee(amount: BigDecimal, feeBps: BigInt): BigDecimal {
  return amount.times(feeBps.toBigDecimal()).div(DIVISOR.toBigDecimal())
}

// Helper to get content ID
function getContentId(rigAddress: string, tokenId: BigInt): string {
  return rigAddress + '-' + tokenId.toString()
}

export function handleContentCreated(event: ContentCreatedEvent): void {
  let rigAddress = event.address.toHexString()
  let contentRig = ContentRig.load(rigAddress)
  if (contentRig === null) return

  let rig = Rig.load(rigAddress)
  if (rig === null) return

  let unit = Unit.load(rig.unit)
  if (unit === null) return

  // Event params: who (indexed), to (indexed), tokenId (indexed), uri
  let creatorAddress = event.params.to
  let tokenId = event.params.tokenId
  let uri = event.params.uri

  // Get or create creator account
  let creator = getOrCreateAccount(creatorAddress)
  creator.lastActivityAt = event.block.timestamp
  creator.save()

  // Create Content entity
  let contentId = getContentId(rigAddress, tokenId)
  let content = new Content(contentId)
  content.contentRig = contentRig.id
  content.tokenId = tokenId
  content.creator = creator.id
  content.currentOwner = creator.id
  content.uri = uri
  content.stake = ZERO_BD
  content.epochId = ZERO_BI
  content.initPrice = contentRig.minInitPrice
  content.totalCollections = ZERO_BI
  content.totalStaked = ZERO_BD
  content.createdAt = event.block.timestamp
  content.save()

  // Update ContentRig stats
  contentRig.totalContent = contentRig.totalContent.plus(ONE_BI)
  contentRig.save()

  // Update Rig activity
  rig.lastActivityAt = event.block.timestamp
  rig.save()

  // Update Unit activity
  unit.lastRigActivityAt = event.block.timestamp
  unit.lastActivityAt = event.block.timestamp
  unit.save()
}

export function handleContentCollected(event: ContentCollectedEvent): void {
  let rigAddress = event.address.toHexString()
  let contentRig = ContentRig.load(rigAddress)
  if (contentRig === null) return

  let rig = Rig.load(rigAddress)
  if (rig === null) return

  let unit = Unit.load(rig.unit)
  if (unit === null) return

  // Event params: who (indexed), to (indexed), tokenId (indexed), epochId, price
  let collectorAddress = event.params.to
  let tokenId = event.params.tokenId
  let epochId = event.params.epochId
  let price = convertTokenToDecimal(event.params.price, BI_6) // USDC has 6 decimals

  // Load content
  let contentId = getContentId(rigAddress, tokenId)
  let content = Content.load(contentId)
  if (content === null) return

  let prevOwnerAddress = content.currentOwner
  let creatorAddress = content.creator

  // Get or create collector account
  let collector = getOrCreateAccount(collectorAddress)
  collector.totalRigSpend = collector.totalRigSpend.plus(price)
  collector.lastActivityAt = event.block.timestamp
  collector.save()

  // Calculate fees
  let prevOwnerFee = calculateFee(price, OWNER_FEE)
  let creatorFee = calculateFee(price, CREATOR_FEE)
  let treasuryFee = calculateFee(price, TREASURY_FEE)
  let teamFee = calculateFee(price, TEAM_FEE)
  let protocolFee = calculateFee(price, PROTOCOL_FEE)

  // Create Collection entity
  let collectionId = event.transaction.hash.toHexString() + '-' + event.logIndex.toString()
  let collection = new Collection(collectionId)
  collection.contentRig = contentRig.id
  collection.content = content.id
  collection.collector = collector.id
  collection.prevOwner = prevOwnerAddress
  collection.tokenId = tokenId
  collection.epochId = epochId
  collection.price = price
  collection.prevOwnerFee = prevOwnerFee
  collection.creatorFee = creatorFee
  collection.treasuryFee = treasuryFee
  collection.teamFee = teamFee
  collection.protocolFee = protocolFee
  collection.timestamp = event.block.timestamp
  collection.blockNumber = event.block.number
  collection.txHash = event.transaction.hash
  collection.save()

  // Update content state
  content.currentOwner = collector.id
  content.epochId = epochId.plus(ONE_BI)
  content.stake = price
  content.initPrice = price.times(BigDecimal.fromString('2')) // Price doubles after collection
  content.totalCollections = content.totalCollections.plus(ONE_BI)
  content.totalStaked = content.totalStaked.plus(price)
  content.save()

  // Update ContentRig stats
  contentRig.totalCollections = contentRig.totalCollections.plus(ONE_BI)
  contentRig.totalStaked = contentRig.totalStaked.plus(price)
  contentRig.save()

  // Update Rig revenue
  rig.treasuryRevenue = rig.treasuryRevenue.plus(treasuryFee)
  rig.teamRevenue = rig.teamRevenue.plus(teamFee)
  rig.protocolRevenue = rig.protocolRevenue.plus(protocolFee)
  rig.lastActivityAt = event.block.timestamp
  rig.save()

  // Update Unit activity
  unit.lastRigActivityAt = event.block.timestamp
  unit.lastActivityAt = event.block.timestamp
  unit.save()

  // Update Protocol stats
  let protocol = getOrCreateProtocol()
  protocol.totalTreasuryRevenue = protocol.totalTreasuryRevenue.plus(treasuryFee)
  protocol.totalProtocolRevenue = protocol.totalProtocolRevenue.plus(protocolFee)
  protocol.lastUpdated = event.block.timestamp
  protocol.save()
}

export function handleContentClaimed(event: ContentClaimedEvent): void {
  let rigAddress = event.address.toHexString()
  let contentRig = ContentRig.load(rigAddress)
  if (contentRig === null) return

  let rig = Rig.load(rigAddress)
  if (rig === null) return

  let unit = Unit.load(rig.unit)
  if (unit === null) return

  // Event params: account (indexed), amount
  let accountAddress = event.params.account
  let amount = convertTokenToDecimal(event.params.amount, BI_6) // USDC has 6 decimals

  // Get or create account
  let account = getOrCreateAccount(accountAddress)
  account.lastActivityAt = event.block.timestamp
  account.save()

  // Create ContentClaim entity
  let claimId = event.transaction.hash.toHexString() + '-' + event.logIndex.toString()
  let claim = new ContentClaim(claimId)
  claim.contentRig = contentRig.id
  claim.account = account.id
  claim.amount = amount
  claim.timestamp = event.block.timestamp
  claim.blockNumber = event.block.number
  claim.txHash = event.transaction.hash
  claim.save()

  // Update Rig activity
  rig.lastActivityAt = event.block.timestamp
  rig.save()

  // Update Unit activity
  unit.lastRigActivityAt = event.block.timestamp
  unit.lastActivityAt = event.block.timestamp
  unit.save()
}
