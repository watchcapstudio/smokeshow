// Where a tap goes.
//
// A widget tap always lands on the verdict for that place. There is no paywall
// to route to: the app is free, and `support` is only ever reached on purpose.

import Foundation

public enum DeepLink {
    public static let scheme = "smokeshow"

    public enum Destination: Equatable, Sendable {
        case verdict(place: String?)
        case support
        case widgetSetup
        case settings
    }

    public static func widgetTap(place: String?) -> URL? {
        url(.verdict(place: place))
    }

    public static func url(_ destination: Destination) -> URL? {
        var components = URLComponents()
        components.scheme = scheme
        switch destination {
        case .verdict(let place):
            components.host = "verdict"
            if let place { components.queryItems = [URLQueryItem(name: "place", value: place)] }
        case .support:
            components.host = "support"
        case .widgetSetup:
            components.host = "add-widget"
        case .settings:
            components.host = "settings"
        }
        return components.url
    }

    public static func destination(for url: URL) -> Destination? {
        guard url.scheme == scheme else { return nil }
        switch url.host {
        case "verdict":
            let place = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "place" })?.value
            return .verdict(place: place)
        // `subscribe` is what lapsed-trial widgets from the paid builds still
        // carry until their timeline reloads. Land them somewhere useful.
        case "support", "subscribe": return .support
        case "add-widget": return .widgetSetup
        case "settings": return .settings
        default: return nil
        }
    }
}
