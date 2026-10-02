// Tips and the supporter subscription, via RevenueCat over StoreKit 2.
//
// Behind a protocol so the widget target, the tests, and previews never link
// a billing SDK. The RevenueCat implementation compiles only where the package
// is present (`#if canImport(RevenueCat)`), so `swift test` runs without it.
//
// RevenueCat stays for one reason: the subscribers from the paid builds are
// already known to it by their anonymous device ID. Swapping billing stacks in
// the same release that changes what the purchase means is two migrations at
// once.

import Foundation

public enum StoreConfiguration {
    /// The paid builds' subscription, now "Smokeshow Supporter". Must match
    /// Configuration/Smokeshow.storekit and App Store Connect.
    public static let monthlyProductID = "earth.smokeshow.subscription.monthly"
    /// Consumable tips, smallest first. Must match App Store Connect.
    public static let tipProductIDs = [
        "earth.smokeshow.tip.small",
        "earth.smokeshow.tip.medium",
        "earth.smokeshow.tip.large",
    ]
    public static let subscriptionGroup = "smokeshow"
    /// The RevenueCat entitlement the monthly product grants.
    public static let entitlementID = "smokeshow_pro"
    public static let monthlyPriceFallback = "$2.99"
    public static let tipPriceFallbacks = ["$2.99", "$5.99", "$11.99"]

    /// Where an App Store subscriber manages or cancels.
    public static let manageSubscriptionsURL = URL(string: "https://apps.apple.com/account/subscriptions")!
}

public struct SupportProduct: Sendable, Equatable, Identifiable {
    public enum Kind: Sendable, Equatable { case tip, monthly }

    public let id: String
    public let kind: Kind
    public let displayName: String
    /// Store-localised, e.g. "$2.99". App Review reads this screen in the
    /// storefront's own currency, so copy never hardcodes a price.
    public let localizedPrice: String

    public init(id: String, kind: Kind, displayName: String, localizedPrice: String) {
        self.id = id
        self.kind = kind
        self.displayName = displayName
        self.localizedPrice = localizedPrice
    }

    /// What the Support screen shows before (or without) the store.
    public static let fallbacks: [SupportProduct] = {
        var products: [SupportProduct] = []
        for index in StoreConfiguration.tipProductIDs.indices {
            products.append(SupportProduct(
                id: StoreConfiguration.tipProductIDs[index],
                kind: .tip,
                displayName: Copy.Support.tipFallbackNames[index],
                localizedPrice: StoreConfiguration.tipPriceFallbacks[index]
            ))
        }
        products.append(SupportProduct(
            id: StoreConfiguration.monthlyProductID,
            kind: .monthly,
            displayName: "Smokeshow Supporter",
            localizedPrice: StoreConfiguration.monthlyPriceFallback
        ))
        return products
    }()

    /// Tips in configured order, then the monthly product.
    static func ordered(_ products: [SupportProduct]) -> [SupportProduct] {
        let order = StoreConfiguration.tipProductIDs + [StoreConfiguration.monthlyProductID]
        return products.sorted {
            (order.firstIndex(of: $0.id) ?? .max) < (order.firstIndex(of: $1.id) ?? .max)
        }
    }
}

public enum PurchaseOutcome: Sendable, Equatable {
    case purchased(SupporterSnapshot)
    case cancelled
    case pending
}

public protocol SupportProviding: AnyObject, Sendable {
    /// Last known answer. Cheap, synchronous, never blocks a view body.
    var snapshot: SupporterSnapshot { get }
    /// Tips and the monthly product, as the store prices them.
    func products() async -> [SupportProduct]
    @discardableResult func refresh() async -> SupporterSnapshot
    func purchase(_ product: SupportProduct) async throws -> PurchaseOutcome
    func restore() async throws -> SupporterSnapshot
}

/// Deterministic provider for tests, previews, the simulator, and the app when
/// RevenueCat is not configured. Supporter state gates nothing, so a missing
/// store costs a reader the icons and nothing else.
public final class StubSupportProvider: SupportProviding, @unchecked Sendable {
    private var state: SupporterSnapshot
    private let cache: SupporterCache

    public init(
        snapshot: SupporterSnapshot = SupporterSnapshot(status: .notSupporting),
        cache: SupporterCache = .shared
    ) {
        state = snapshot
        self.cache = cache
        cache.snapshot = snapshot
    }

    public var snapshot: SupporterSnapshot { state }

    public func products() async -> [SupportProduct] { SupportProduct.fallbacks }

    @discardableResult
    public func refresh() async -> SupporterSnapshot {
        cache.snapshot = state
        return state
    }

    public func purchase(_ product: SupportProduct) async throws -> PurchaseOutcome {
        switch product.kind {
        case .tip:
            if !state.status.isSubscribed { state = SupporterSnapshot(status: .tipped) }
        case .monthly:
            state = SupporterSnapshot(status: .subscribed(renewsAt: Date().addingTimeInterval(30 * 86400)))
        }
        cache.snapshot = state
        return .purchased(state)
    }

    public func restore() async throws -> SupporterSnapshot {
        await refresh()
    }

    /// Test seam.
    public func override(_ status: SupporterStatus) {
        state = SupporterSnapshot(status: status)
        cache.snapshot = state
    }
}

#if canImport(RevenueCat)
import RevenueCat

public final class RevenueCatSupportProvider: SupportProviding, @unchecked Sendable {

    private var storeProducts: [String: StoreProduct] = [:]

    public init(apiKey: String, appUserID: String?) {
        Purchases.logLevel = .warn
        // Anonymous identity: the device ID from DeviceIdentity, never an
        // email. It is also how the paid builds' subscribers are recognised.
        Purchases.configure(with: Configuration.builder(withAPIKey: apiKey)
            .with(appUserID: appUserID)
            .build())
    }

    public var snapshot: SupporterSnapshot { SupporterCache.shared.snapshot }

    public func products() async -> [SupportProduct] {
        let ids = StoreConfiguration.tipProductIDs + [StoreConfiguration.monthlyProductID]
        let fetched = await Purchases.shared.products(ids)
        guard !fetched.isEmpty else { return SupportProduct.fallbacks }
        for product in fetched { storeProducts[product.productIdentifier] = product }
        return SupportProduct.ordered(fetched.map { product in
            SupportProduct(
                id: product.productIdentifier,
                kind: product.productIdentifier == StoreConfiguration.monthlyProductID ? .monthly : .tip,
                displayName: product.localizedTitle,
                localizedPrice: product.localizedPriceString
            )
        })
    }

    @discardableResult
    public func refresh() async -> SupporterSnapshot {
        guard let info = try? await Purchases.shared.customerInfo() else { return snapshot }
        return store(Self.snapshot(from: info))
    }

    public func purchase(_ product: SupportProduct) async throws -> PurchaseOutcome {
        if storeProducts[product.id] == nil { _ = await products() }
        guard let storeProduct = storeProducts[product.id] else { return .pending }

        let result = try await Purchases.shared.purchase(product: storeProduct)
        if result.userCancelled { return .cancelled }
        return .purchased(store(Self.snapshot(from: result.customerInfo)))
    }

    public func restore() async throws -> SupporterSnapshot {
        store(Self.snapshot(from: try await Purchases.shared.restorePurchases()))
    }

    private func store(_ snapshot: SupporterSnapshot) -> SupporterSnapshot {
        SupporterCache.shared.snapshot = snapshot
        return snapshot
    }

    static func snapshot(from info: CustomerInfo) -> SupporterSnapshot {
        if let entitlement = info.entitlements[StoreConfiguration.entitlementID], entitlement.isActive {
            return SupporterSnapshot(status: .subscribed(renewsAt: entitlement.expirationDate))
        }
        if info.activeSubscriptions.contains(StoreConfiguration.monthlyProductID) {
            return SupporterSnapshot(status: .subscribed(
                renewsAt: info.expirationDate(forProductIdentifier: StoreConfiguration.monthlyProductID)
            ))
        }
        // Consumable tips cannot be restored through StoreKit; RevenueCat
        // keeps the record against the device ID, which is what this reads.
        if !info.nonSubscriptions.isEmpty {
            return SupporterSnapshot(status: .tipped)
        }
        return SupporterSnapshot(status: .notSupporting)
    }
}
#endif
