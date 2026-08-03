// StoreKit 2 via RevenueCat, behind a protocol.
//
// The protocol is not ceremony: the widget target, the tests, and the previews
// all need an entitlement answer and none of them should link a billing SDK.
// The RevenueCat implementation is compiled only where the package is present
// (`#if canImport(RevenueCat)`), so this repository builds and its tests run
// without the dependency resolved.
//
// Pricing and the offer, per the platform plan §4:
//   • $2.99/month, subscribe-to-use, no permanent free tier.
//   • 14-day free trial configured as a StoreKit *introductory offer* on the
//     subscription, so the store enforces eligibility — one trial per Apple ID
//     per subscription group. The app never tracks trial eligibility itself.
//   • Entitlement is also checked server-side, from the RevenueCat webhook,
//     before the notification worker fans out to a device (B7).

import Foundation

public struct PaywallProduct: Sendable, Equatable {
    public let identifier: String
    /// Store-localised price, e.g. "$2.99". Never hardcode this in copy —
    /// App Review reads the paywall in the storefront's own currency.
    public let localizedPrice: String
    public let localizedPeriod: String
    /// Nil when this Apple ID is not eligible for the introductory offer.
    public let introductoryOfferDays: Int?

    public init(
        identifier: String,
        localizedPrice: String,
        localizedPeriod: String,
        introductoryOfferDays: Int?
    ) {
        self.identifier = identifier
        self.localizedPrice = localizedPrice
        self.localizedPeriod = localizedPeriod
        self.introductoryOfferDays = introductoryOfferDays
    }

    public static let preview = PaywallProduct(
        identifier: StoreConfiguration.monthlyProductID,
        localizedPrice: TrialPolicy.monthlyPriceFallback,
        localizedPeriod: "month",
        introductoryOfferDays: TrialPolicy.trialDays
    )
}

public enum StoreConfiguration {
    /// Must match Configuration/Smokeshow.storekit and App Store Connect.
    public static let monthlyProductID = "earth.smokeshow.subscription.monthly"
    public static let subscriptionGroup = "smokeshow"
    /// The RevenueCat entitlement identifier the offering grants.
    public static let entitlementID = "smokeshow_pro"
}

public enum PurchaseOutcome: Sendable, Equatable {
    case purchased(EntitlementSnapshot)
    case cancelled
    case pending
}

public protocol EntitlementProviding: AnyObject, Sendable {
    /// Last known answer. Cheap, synchronous, never blocks a view body.
    var snapshot: EntitlementSnapshot { get }
    /// Product for the paywall, loaded from the store.
    func product() async -> PaywallProduct?
    @discardableResult func refresh() async -> EntitlementSnapshot
    func purchase() async throws -> PurchaseOutcome
    func restore() async throws -> EntitlementSnapshot
}

/// Deterministic provider for tests, previews, and the simulator. Also the
/// implementation the app falls back to if RevenueCat fails to configure —
/// `.unknown` keeps the product usable rather than locking a paying user out.
public final class StubEntitlementProvider: EntitlementProviding, @unchecked Sendable {
    private var state: EntitlementSnapshot
    private let productStub: PaywallProduct?

    public init(
        snapshot: EntitlementSnapshot = EntitlementSnapshot(status: .trial(
            endsAt: Date().addingTimeInterval(Double(TrialPolicy.trialDays) * 86400)
        )),
        product: PaywallProduct? = .preview
    ) {
        state = snapshot
        productStub = product
        EntitlementCache.shared.snapshot = snapshot
    }

    public var snapshot: EntitlementSnapshot { state }

    public func product() async -> PaywallProduct? { productStub }

    @discardableResult
    public func refresh() async -> EntitlementSnapshot {
        EntitlementCache.shared.snapshot = state
        return state
    }

    public func purchase() async throws -> PurchaseOutcome {
        state = EntitlementSnapshot(status: .subscribed(renewsAt: Date().addingTimeInterval(30 * 86400)))
        EntitlementCache.shared.snapshot = state
        return .purchased(state)
    }

    public func restore() async throws -> EntitlementSnapshot {
        await refresh()
    }

    /// Test seam for the lapse states — the whole point of designing them.
    public func override(_ status: EntitlementStatus) {
        state = EntitlementSnapshot(status: status)
        EntitlementCache.shared.snapshot = state
    }
}

#if canImport(RevenueCat)
import RevenueCat

/// RevenueCat over StoreKit 2. It handles receipt validation, the entitlement
/// webhook B7's push worker gates on, and reports the store-native
/// introductory offer uniformly — which is why v1 does not hand-roll StoreKit.
public final class RevenueCatEntitlementProvider: EntitlementProviding, @unchecked Sendable {

    public init(apiKey: String, appUserID: String?) {
        Purchases.logLevel = .warn
        // Anonymous identity: the device ID from DeviceIdentity, never an
        // email. No accounts, no signup step in the funnel (plan §4).
        Purchases.configure(with: Configuration.builder(withAPIKey: apiKey)
            .with(appUserID: appUserID)
            .build())
    }

    public var snapshot: EntitlementSnapshot { EntitlementCache.shared.snapshot }

    public func product() async -> PaywallProduct? {
        guard let offerings = try? await Purchases.shared.offerings(),
              let package = offerings.current?.availablePackages.first(where: {
                  $0.storeProduct.productIdentifier == StoreConfiguration.monthlyProductID
              }) ?? offerings.current?.availablePackages.first
        else { return nil }

        let storeProduct = package.storeProduct
        let eligibility = await Purchases.shared.checkTrialOrIntroDiscountEligibility(
            product: storeProduct
        )
        let introDays: Int?
        if eligibility == .eligible, let intro = storeProduct.introductoryDiscount {
            introDays = Self.days(in: intro.subscriptionPeriod)
        } else {
            introDays = nil
        }

        return PaywallProduct(
            identifier: storeProduct.productIdentifier,
            localizedPrice: storeProduct.localizedPriceString,
            localizedPeriod: storeProduct.subscriptionPeriod?.unit.debugDescription ?? "month",
            introductoryOfferDays: introDays
        )
    }

    @discardableResult
    public func refresh() async -> EntitlementSnapshot {
        guard let info = try? await Purchases.shared.customerInfo() else { return snapshot }
        let updated = Self.snapshot(from: info)
        EntitlementCache.shared.snapshot = updated
        return updated
    }

    public func purchase() async throws -> PurchaseOutcome {
        guard let offerings = try? await Purchases.shared.offerings(),
              let package = offerings.current?.availablePackages.first
        else { return .pending }

        let result = try await Purchases.shared.purchase(package: package)
        if result.userCancelled { return .cancelled }
        let updated = Self.snapshot(from: result.customerInfo)
        EntitlementCache.shared.snapshot = updated
        return .purchased(updated)
    }

    public func restore() async throws -> EntitlementSnapshot {
        let info = try await Purchases.shared.restorePurchases()
        let updated = Self.snapshot(from: info)
        EntitlementCache.shared.snapshot = updated
        return updated
    }

    private static func snapshot(from info: CustomerInfo) -> EntitlementSnapshot {
        let entitlement = info.entitlements[StoreConfiguration.entitlementID]
        let hadTrial = info.entitlements.all[StoreConfiguration.entitlementID]?
            .periodType == .trial

        guard let entitlement, entitlement.isActive else {
            let everSubscribed = !info.allPurchasedProductIdentifiers.isEmpty
            return EntitlementSnapshot(
                status: everSubscribed
                    ? .lapsed(endedAt: entitlement?.expirationDate, hadTrial: hadTrial)
                    : .never
            )
        }

        if entitlement.periodType == .trial {
            return EntitlementSnapshot(
                status: .trial(endsAt: entitlement.expirationDate
                    ?? Date().addingTimeInterval(Double(TrialPolicy.trialDays) * 86400))
            )
        }
        return EntitlementSnapshot(status: .subscribed(renewsAt: entitlement.expirationDate))
    }

    private static func days(in period: SubscriptionPeriod) -> Int {
        switch period.unit {
        case .day: return period.value
        case .week: return period.value * 7
        case .month: return period.value * 30
        case .year: return period.value * 365
        @unknown default: return period.value
        }
    }
}
#endif
