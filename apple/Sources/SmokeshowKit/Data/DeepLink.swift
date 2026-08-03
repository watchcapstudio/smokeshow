// Where a tap goes.
//
// A tap on a lapsed widget must land on the paywall, not the home screen —
// that tile is the conversion prompt, and bouncing the user into an app that
// then tells them the same thing is a wasted moment (platform plan §4).

import Foundation

public enum DeepLink {
    public static let scheme = "smokeshow"

    public enum Destination: Equatable, Sendable {
        case verdict(place: String?)
        case paywall
        case widgetSetup
        case settings
    }

    public static func widgetTap(place: String?, lapsed: Bool) -> URL? {
        lapsed ? url(.paywall) : url(.verdict(place: place))
    }

    public static func url(_ destination: Destination) -> URL? {
        var components = URLComponents()
        components.scheme = scheme
        switch destination {
        case .verdict(let place):
            components.host = "verdict"
            if let place { components.queryItems = [URLQueryItem(name: "place", value: place)] }
        case .paywall:
            components.host = "subscribe"
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
        case "subscribe": return .paywall
        case "add-widget": return .widgetSetup
        case "settings": return .settings
        default: return nil
        }
    }
}
