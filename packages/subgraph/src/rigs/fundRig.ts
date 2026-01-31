import { BigDecimal, BigInt, Address } from '@graphprotocol/graph-ts'
import {
  FundRig__Funded as FundedEvent,
  FundRig__Claimed as ClaimedEvent,
  FundRig__ProtocolFee as ProtocolFeeEvent,
} from '../../generated/templates/FundRig/FundRig'
import {
  Rig,
  FundRig,
  CharityDayData,
  Donation,
  CharityClaim,
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

// Fee constants for FundRig (basis points)
const RECIPIENT_BPS = BigInt.fromI32(5000) // 50%
const TREASURY_BPS = BigInt.fromI32(4500) // 45%
const TEAM_BPS = BigInt.fromI32(500) // 5%
const DIVISOR = BigInt.fromI32(10000)

function calculateFee(amount: BigDecimal, feeBps: BigInt): BigDecimal {
  return amount.times(feeBps.toBigDecimal()).div(DIVISOR.toBigDecimal())
}

// Helper to get or create CharityDayData
function getOrCreateCharityDayData(fundRig: FundRig, day: BigInt, timestamp: BigInt): CharityDayData {
  let id = fundRig.id + '-' + day.toString()
  let dayData = CharityDayData.load(id)
  if (dayData === null) {
    dayData = new CharityDayData(id)
    dayData.fundRig = fundRig.id
    dayData.day = day
    dayData.totalDonated = ZERO_BD
    dayData.donorCount = ZERO_BI
    dayData.emission = ZERO_BD // Could calculate from contract params
    dayData.timestamp = timestamp
  }
  return dayData
}

export function handleFunded(event: FundedEvent): void {
  let rigAddress = event.address.toHexString()
  let fundRig = FundRig.load(rigAddress)
  if (fundRig === null) return

  let rig = Rig.load(rigAddress)
  if (rig === null) return

  let unit = Unit.load(rig.unit)
  if (unit === null) return

  // Event params: account (indexed), amount, day
  let donorAddress = event.params.account
  let amount = convertTokenToDecimal(event.params.amount, BI_18)
  let day = event.params.day

  // Get or create donor account
  let donor = getOrCreateAccount(donorAddress)
  donor.totalRigSpend = donor.totalRigSpend.plus(amount)
  donor.lastActivityAt = event.block.timestamp
  donor.save()

  // Calculate fee splits
  let recipientAmount = calculateFee(amount, RECIPIENT_BPS)
  let treasuryAmount = calculateFee(amount, TREASURY_BPS)
  let teamAmount = calculateFee(amount, TEAM_BPS)

  // Create Donation entity
  let donationId = event.transaction.hash.toHexString() + '-' + event.logIndex.toString()
  let donation = new Donation(donationId)
  donation.fundRig = fundRig.id
  donation.donor = donor.id
  donation.day = day
  donation.amount = amount
  donation.recipientAmount = recipientAmount
  donation.treasuryAmount = treasuryAmount
  donation.teamAmount = teamAmount
  donation.timestamp = event.block.timestamp
  donation.blockNumber = event.block.number
  donation.txHash = event.transaction.hash
  donation.save()

  // Update CharityDayData
  let dayData = getOrCreateCharityDayData(fundRig, day, event.block.timestamp)
  dayData.totalDonated = dayData.totalDonated.plus(amount)
  dayData.donorCount = dayData.donorCount.plus(ONE_BI)
  dayData.save()

  // Update FundRig state
  fundRig.currentDay = day
  fundRig.totalDonated = fundRig.totalDonated.plus(amount)
  fundRig.uniqueDonors = fundRig.uniqueDonors.plus(ONE_BI) // Simplified - would need tracking for true unique
  fundRig.save()

  // Update Rig revenue (treasury portion)
  rig.treasuryRevenue = rig.treasuryRevenue.plus(treasuryAmount)
  rig.teamRevenue = rig.teamRevenue.plus(teamAmount)
  rig.lastActivityAt = event.block.timestamp
  rig.save()

  // Update Unit activity
  unit.lastRigActivityAt = event.block.timestamp
  unit.lastActivityAt = event.block.timestamp
  unit.save()

  // Update Protocol stats
  let protocol = getOrCreateProtocol()
  protocol.totalTreasuryRevenue = protocol.totalTreasuryRevenue.plus(treasuryAmount)
  protocol.lastUpdated = event.block.timestamp
  protocol.save()
}

export function handleCharityClaimed(event: ClaimedEvent): void {
  let rigAddress = event.address.toHexString()
  let fundRig = FundRig.load(rigAddress)
  if (fundRig === null) return

  let rig = Rig.load(rigAddress)
  if (rig === null) return

  let unit = Unit.load(rig.unit)
  if (unit === null) return

  // Event params: account (indexed), amount, day
  let claimerAddress = event.params.account
  let amount = convertTokenToDecimal(event.params.amount, BI_18)
  let day = event.params.day

  // Get claimer account
  let claimer = getOrCreateAccount(claimerAddress)
  claimer.totalMined = claimer.totalMined.plus(amount)
  claimer.lastActivityAt = event.block.timestamp
  claimer.save()

  // Create CharityClaim entity
  let claimId = event.transaction.hash.toHexString() + '-' + event.logIndex.toString()
  let claim = new CharityClaim(claimId)
  claim.fundRig = fundRig.id
  claim.claimer = claimer.id
  claim.day = day
  claim.amount = amount
  claim.timestamp = event.block.timestamp
  claim.blockNumber = event.block.number
  claim.txHash = event.transaction.hash
  claim.save()

  // Update FundRig total minted
  fundRig.totalMinted = fundRig.totalMinted.plus(amount)
  fundRig.save()

  // Update Rig total minted
  rig.totalMinted = rig.totalMinted.plus(amount)
  rig.lastActivityAt = event.block.timestamp
  rig.save()

  // Update Unit total minted
  unit.totalMinted = unit.totalMinted.plus(amount)
  unit.lastRigActivityAt = event.block.timestamp
  unit.lastActivityAt = event.block.timestamp
  unit.save()

  // Update Protocol total minted
  let protocol = getOrCreateProtocol()
  protocol.totalMinted = protocol.totalMinted.plus(amount)
  protocol.lastUpdated = event.block.timestamp
  protocol.save()
}

export function handleFundProtocolFee(event: ProtocolFeeEvent): void {
  // Event params: protocol (indexed), amount, day
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
