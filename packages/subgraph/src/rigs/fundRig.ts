import { BigDecimal, BigInt, Address } from '@graphprotocol/graph-ts'
import {
  FundRig__Funded as FundedEvent,
  FundRig__Claimed as ClaimedEvent,
  FundRig__ProtocolFee as ProtocolFeeEvent,
  FundRig__RecipientSet as RecipientSetEvent,
  FundRig__UriSet as UriSetEvent,
  FundRig__TreasurySet as TreasurySetEvent,
  FundRig__TeamSet as TeamSetEvent,
  FundRig as FundRigContract,
} from '../../generated/templates/FundRig/FundRig'
import { FundCore as FundCoreContract } from '../../generated/templates/FundRig/FundCore'
import {
  Rig,
  FundRig,
  FundDayData,
  Donation,
  FundClaim,
  FundDonor,
  FundDayDonor,
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
  ADDRESS_ZERO,
} from '../constants'
import {
  convertTokenToDecimal,
  getOrCreateProtocol,
  getOrCreateAccount,
} from '../helpers'

// Fee constants for FundRig (basis points)
const RECIPIENT_BPS = BigInt.fromI32(5000) // 50%
const TEAM_BPS = BigInt.fromI32(400) // 4%
const PROTOCOL_BPS = BigInt.fromI32(100) // 1%
const DIVISOR = BigInt.fromI32(10000)

function calculateFee(amount: BigDecimal, feeBps: BigInt): BigDecimal {
  return amount.times(feeBps.toBigDecimal()).div(DIVISOR.toBigDecimal())
}

function isZeroAddress(address: Address): bool {
  return address.toHexString() == ADDRESS_ZERO
}

function getFundDonorId(fundRigId: string, donorId: string): string {
  return fundRigId + '-' + donorId
}

function getFundDayDonorId(fundRigId: string, day: BigInt, donorId: string): string {
  return fundRigId + '-' + day.toString() + '-' + donorId
}

// Helper to get or create FundDayData
function getOrCreateFundDayData(fundRig: FundRig, day: BigInt, timestamp: BigInt): FundDayData {
  let id = fundRig.id + '-' + day.toString()
  let dayData = FundDayData.load(id)
  if (dayData === null) {
    dayData = new FundDayData(id)
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
  let amount = convertTokenToDecimal(event.params.amount, BI_6)
  let day = event.params.day

  // Get or create donor account
  let donor = getOrCreateAccount(donorAddress)
  donor.totalRigSpend = donor.totalRigSpend.plus(amount)
  donor.lastActivityAt = event.block.timestamp
  donor.save()

  let fundRigContract = FundRigContract.bind(event.address)

  // Resolve dynamic fee toggles (team/protocol can be disabled by setting address(0))
  let teamResult = fundRigContract.try_team()
  let hasTeam = !teamResult.reverted && !isZeroAddress(teamResult.value)

  let hasProtocol = false
  let coreResult = fundRigContract.try_core()
  if (!coreResult.reverted) {
    let coreContract = FundCoreContract.bind(coreResult.value)
    let protocolResult = coreContract.try_protocolFeeAddress()
    hasProtocol = !protocolResult.reverted && !isZeroAddress(protocolResult.value)
  }

  // Calculate fee splits to match contract logic.
  let recipientAmount = calculateFee(amount, RECIPIENT_BPS)
  let teamAmount = hasTeam ? calculateFee(amount, TEAM_BPS) : ZERO_BD
  let protocolAmount = hasProtocol ? calculateFee(amount, PROTOCOL_BPS) : ZERO_BD
  let treasuryAmount = amount.minus(recipientAmount).minus(teamAmount).minus(protocolAmount)

  // Create Donation entity
  let donationId = event.transaction.hash.toHexString() + '-' + event.logIndex.toString()
  let donation = new Donation(donationId)
  donation.fundRig = fundRig.id
  donation.donor = donor.id
  donation.day = day
  donation.amount = amount
  donation.uri = event.params.uri
  donation.recipientAmount = recipientAmount
  donation.treasuryAmount = treasuryAmount
  donation.teamAmount = teamAmount
  donation.timestamp = event.block.timestamp
  donation.blockNumber = event.block.number
  donation.txHash = event.transaction.hash
  donation.save()

  // Update FundDayData
  let dayData = getOrCreateFundDayData(fundRig, day, event.block.timestamp)
  let dayEmissionResult = fundRigContract.try_getDayEmission(day)
  if (!dayEmissionResult.reverted) {
    dayData.emission = convertTokenToDecimal(dayEmissionResult.value, BI_18)
  }

  // Track unique donor for this day.
  let dayDonorId = getFundDayDonorId(fundRig.id, day, donor.id)
  let dayDonor = FundDayDonor.load(dayDonorId)
  if (dayDonor === null) {
    dayDonor = new FundDayDonor(dayDonorId)
    dayDonor.fundRig = fundRig.id
    dayDonor.day = day
    dayDonor.donor = donor.id
    dayDonor.firstDonationAt = event.block.timestamp
    dayDonor.save()
    dayData.donorCount = dayData.donorCount.plus(ONE_BI)
  }

  dayData.totalDonated = dayData.totalDonated.plus(amount)
  dayData.save()

  // Update FundRig state
  fundRig.currentDay = day
  fundRig.totalDonated = fundRig.totalDonated.plus(amount)
  let fundDonorId = getFundDonorId(fundRig.id, donor.id)
  let fundDonor = FundDonor.load(fundDonorId)
  if (fundDonor === null) {
    fundDonor = new FundDonor(fundDonorId)
    fundDonor.fundRig = fundRig.id
    fundDonor.donor = donor.id
    fundDonor.firstDonationAt = event.block.timestamp
    fundDonor.save()
    fundRig.uniqueDonors = fundRig.uniqueDonors.plus(ONE_BI)
  }
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

export function handleFundClaimed(event: ClaimedEvent): void {
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

  // Create FundClaim entity
  let claimId = event.transaction.hash.toHexString() + '-' + event.logIndex.toString()
  let claim = new FundClaim(claimId)
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

export function handleFundRecipientSet(event: RecipientSetEvent): void {
  let rigAddress = event.address.toHexString()
  let fundRig = FundRig.load(rigAddress)
  if (fundRig === null) return

  fundRig.recipient = event.params.recipient
  fundRig.save()
}

export function handleFundUriSet(event: UriSetEvent): void {
  let rigAddress = event.address.toHexString()
  let rig = Rig.load(rigAddress)
  if (rig === null) return

  rig.uri = event.params.uri
  rig.save()
}

export function handleFundTreasurySet(event: TreasurySetEvent): void {
  let rigAddress = event.address.toHexString()
  let fundRig = FundRig.load(rigAddress)
  if (fundRig === null) return

  fundRig.treasury = event.params.treasury
  fundRig.save()
}

export function handleFundTeamSet(event: TeamSetEvent): void {
  let rigAddress = event.address.toHexString()
  let fundRig = FundRig.load(rigAddress)
  if (fundRig === null) return

  fundRig.team = event.params.team
  fundRig.save()
}
