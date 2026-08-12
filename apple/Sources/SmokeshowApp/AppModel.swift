// The app's one piece of state.
//
// It owns the place, the payload, the entitlement snapshot, and the widget
// reloads — and it owns exactly none of the forecast maths. Every string this
// object hands a view came from `/api/forecast`.

import Foundation
import SwiftUI
import SmokeshowKit
#if canImport(WidgetKit)
import WidgetKit
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
    @Published public private(set) var entitlement: EntitlementSnapshot

    public let push: PushCoordinator
    private let repository: ForecastRepository
    private let entitlementProvider: EntitlementProviding
    private let locationProvider: LocationProviding

    /// `push` defaults to the shared coordinator, but not as a default
    /// *argument*: `PushCoordinator.shared` is main-actor isolated and a
    /// default argument is evaluated in the caller's context, which need not be.
    public init(
        repository: ForecastRepository = .shared,
        entitlementProvider: EntitlementProviding,
        locationProvider: LocationProviding = LocationProvider(),
        push: PushCoordinator? = nil
    ) {
        self.repository = repository
        self.entitlementProvider = entitlementProvider
        self.locationProvider = locationProvider
        self.push = push ?? PushCoordinator.shared
        preferences = PreferencesStore.shared.current
        entitlement = EntitlementCache.shared.snapshot
        place = PlaceStore.shared.selected
    }

    // MARK: Lifecycle

    public func onLaunch() async {
        await refreshEntitlement()
        if place == nil { await useCurrentLocation() }
        await refresh()
    }

    public func onForeground() async {
        await refreshEntitlement()
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
        // forecast on screen, a refresh must never blank or stall it.
        let showsLoadingScreen = forecast == nil
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
                preferences: preferences,
                entitlement: entitlement
            )
        }
        #endif
    }

    public func select(_ newPlace: Place) async {
        place = newPlace
        PlaceStore.shared.upsert(newPlace)
        PlaceStore.shared.selected = newPlace
        await refresh()
        reloadWidgets()
        await push.syncRegistration()
    }

    public func useCurrentLocation() async {
        guard let resolved = await locationProvider.currentPlace() else { return }
        await select(resolved)
    }

    // MARK: Entitlement

    public func refreshEntitlement() async {
        entitlement = await entitlementProvider.refresh()
        // The widget reads the snapshot, so a lapse must reach the home screen
        // immediately rather than at the widget's next natural refresh.
        reloadWidgets()
    }

    public func product() async -> PaywallProduct? {
        await entitlementProvider.product()
    }

    public func subscribe() async -> PurchaseOutcome? {
        do {
            let outcome = try await entitlementProvider.purchase()
            if case .purchased(let snapshot) = outcome {
                entitlement = snapshot
                TrialInstrumentation.record(.converted)
                reloadWidgets()
            }
            return outcome
        } catch {
            return nil
        }
    }

    public func restore() async {
        entitlement = (try? await entitlementProvider.restore()) ?? entitlement
        reloadWidgets()
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
