// The app's one piece of state.
//
// It owns the place, the payload, the supporter snapshot, and the widget
// reloads — and it owns exactly none of the forecast maths. Every string this
// object hands a view came from `/api/forecast`.

import Foundation
import SwiftUI
import SmokeshowKit
#if canImport(WidgetKit)
import WidgetKit
#endif
#if os(iOS)
import UIKit
#endif

@MainActor
public final class AppModel: ObservableObject {

    @Published public private(set) var forecast: Forecast?
    @Published public private(set) var loadError: ForecastUnavailable?
    @Published public private(set) var isLoading = false
    @Published public private(set) var isStale = false
    @Published public var place: Place?
    @Published public var preferences: Preferences {
        didSet {
            PreferencesStore.shared.current = preferences
            reloadWidgets()
            if preferences.source != oldValue.source {
                // The verdict is computed on the anchored series, so a source
                // change is a refetch — not a client-side recalculation
                // (contract §5).
                Task { await refresh(force: true) }
            }
            Task { await push.syncRegistration() }
        }
    }
    /// Tips and the supporter subscription. Gates nothing but the icons.
    @Published public private(set) var supporter: SupporterSnapshot
    @Published public private(set) var appIcon: SupporterIcon = .standard

    public let push: PushCoordinator
    private let repository: ForecastRepository
    private let supportProvider: SupportProviding
    private let locationProvider: LocationProviding

    /// `push` defaults to the shared coordinator, but not as a default
    /// *argument*: `PushCoordinator.shared` is main-actor isolated and a
    /// default argument is evaluated in the caller's context, which need not be.
    public init(
        repository: ForecastRepository = .shared,
        supportProvider: SupportProviding,
        locationProvider: LocationProviding = LocationProvider(),
        push: PushCoordinator? = nil
    ) {
        self.repository = repository
        self.supportProvider = supportProvider
        self.locationProvider = locationProvider
        self.push = push ?? PushCoordinator.shared
        preferences = PreferencesStore.shared.current
        supporter = SupporterCache.shared.snapshot
        place = PlaceStore.shared.selected
    }

    // MARK: Lifecycle

    public func onLaunch() async {
        #if os(iOS)
        appIcon = SupporterIcon(assetName: UIApplication.shared.alternateIconName)
        #endif
        await refreshSupporter()
        if place == nil { await useCurrentLocation() }
        await refresh()
    }

    public func onForeground() async {
        await refreshSupporter()
        await refresh()
        // Foreground is a free reload: the widget gets the payload the app
        // just fetched instead of spending one of its own.
        reloadWidgets()
    }

    // MARK: Forecast

    /// The first load, with nothing cached, gets a deliberate loading screen
    /// rather than a sub-second flash of one. A cached load never waits — it
    /// paints instantly — so this only ever costs the very first open.
    static let minimumFirstLoadDuration: TimeInterval = 2.5

    public func refresh(force: Bool = false) async {
        guard let place else {
            loadError = .noLocation
            return
        }
        // Only the empty-handed case earns the hold; if we already have a
        // forecast on screen, a refresh must never blank or stall it. Clearing
        // the error means an empty (re)load reads as "loading", not a stale
        // "offline", while it is in flight.
        let showsLoadingScreen = forecast == nil
        if showsLoadingScreen { loadError = nil }
        let startedAt = Date()
        isLoading = true
        defer { isLoading = false }

        let request = ForecastRequest(place: place, source: preferences.source)
        let result = await repository.load(request, force: force)

        if showsLoadingScreen {
            let elapsed = Date().timeIntervalSince(startedAt)
            let remaining = Self.minimumFirstLoadDuration - elapsed
            if remaining > 0 { try? await Task.sleep(for: .seconds(remaining)) }
        }

        forecast = result.forecast
        loadError = result.error
        isStale = result.isStale

        #if canImport(ActivityKit) && os(iOS)
        if let forecast = result.forecast {
            await LiveActivityController.shared.sync(
                forecast: forecast,
                place: place,
                preferences: preferences
            )
        }
        #endif
    }

    /// - Parameter fetch: when false, sets the place but leaves the forecast
    ///   fetch to a later `refresh()`. Onboarding uses this so the very first
    ///   fetch runs while the main screen is on-screen — otherwise the loading
    ///   screen's minimum hold burns behind the "Finding you…" button and the
    ///   forecast is already loaded by the time the screen appears.
    public func select(_ newPlace: Place, fetch: Bool = true) async {
        place = newPlace
        PlaceStore.shared.upsert(newPlace)
        PlaceStore.shared.selected = newPlace
        if fetch { await refresh() }
        reloadWidgets()
        await push.syncRegistration()
    }

    public func useCurrentLocation(fetch: Bool = true) async {
        guard let resolved = await locationProvider.currentPlace() else { return }
        await select(resolved, fetch: fetch)
    }

    // MARK: Support

    public func refreshSupporter() async {
        supporter = await supportProvider.refresh()
    }

    public func supportProducts() async -> [SupportProduct] {
        await supportProvider.products()
    }

    /// Nil means the purchase failed; the store has already told the user why.
    public func purchase(_ product: SupportProduct) async -> PurchaseOutcome? {
        do {
            let outcome = try await supportProvider.purchase(product)
            if case .purchased(let snapshot) = outcome {
                supporter = snapshot
                // Someone who subscribes from the Support screen in this build
                // knows the app is free; the notice is for the paid builds'
                // subscribers only.
                if product.kind == .monthly { SupporterCache.shared.hasShownFreeNotice = true }
            }
            return outcome
        } catch {
            return nil
        }
    }

    public func restore() async {
        supporter = (try? await supportProvider.restore()) ?? supporter
    }

    public var supportsAlternateIcons: Bool {
        #if os(iOS)
        return UIApplication.shared.supportsAlternateIcons
        #else
        return false
        #endif
    }

    /// Supporter icons only for supporters; the standard icon for anyone.
    public func setAppIcon(_ icon: SupporterIcon) async {
        guard !icon.requiresSupport || supporter.status.isSupporter else { return }
        #if os(iOS)
        guard UIApplication.shared.supportsAlternateIcons,
              UIApplication.shared.alternateIconName != icon.assetName
        else { return }
        do {
            try await UIApplication.shared.setAlternateIconName(icon.assetName)
            appIcon = icon
        } catch {
            appIcon = SupporterIcon(assetName: UIApplication.shared.alternateIconName)
        }
        #endif
    }

    // MARK: Widgets

    public func reloadWidgets() {
        #if canImport(WidgetKit)
        WidgetCenter.shared.reloadAllTimelines()
        #endif
    }

    /// Has the user actually installed one? WidgetKit will tell us, and it is
    /// the only honest measure of whether onboarding worked.
    ///
    /// The async `currentConfigurations()` is iOS 18+; the completion-handler
    /// form goes back to iOS 14, which is what a deployment target of 17 can use.
    public func installedWidgetCount() async -> Int {
        #if canImport(WidgetKit)
        return await withCheckedContinuation { continuation in
            WidgetCenter.shared.getCurrentConfigurations { result in
                switch result {
                case .success(let widgets): continuation.resume(returning: widgets.count)
                case .failure: continuation.resume(returning: 0)
                }
            }
        }
        #else
        return 0
        #endif
    }
}
