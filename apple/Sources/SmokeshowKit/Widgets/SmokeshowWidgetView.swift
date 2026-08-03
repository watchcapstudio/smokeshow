// One entry point for every family, so the widget extension and the watch app
// contain no layout decisions of their own — they map their platform's family
// enum onto `WidgetLayout` and hand it here.

import SwiftUI

public struct SmokeshowWidgetView: View {
    private let entry: WidgetEntryModel
    private let layout: WidgetLayout

    public init(entry: WidgetEntryModel, layout: WidgetLayout) {
        self.entry = entry
        self.layout = layout
    }

    public var body: some View {
        switch layout {
        case .systemSmall:
            SmallWidgetView(entry: entry)
        case .systemMedium:
            MediumWidgetView(entry: entry)
        case .systemLarge:
            LargeWidgetView(entry: entry)
        case .systemExtraLarge:
            ExtraLargeWidgetView(entry: entry)
        default:
            accessory
        }
    }

    @ViewBuilder
    private var accessory: some View {
        #if os(iOS) || os(watchOS)
        switch layout {
        case .accessoryInline:
            AccessoryInlineView(entry: entry)
        case .accessoryCircularPM:
            AccessoryCircularPMView(entry: entry)
        case .accessoryCircularCountdown:
            AccessoryCircularCountdownView(entry: entry)
        case .accessoryRectangular:
            AccessoryRectangularView(entry: entry)
        case .accessoryCorner:
            #if os(watchOS)
            AccessoryCornerView(entry: entry)
            #else
            EmptyView()
            #endif
        default:
            EmptyView()
        }
        #else
        // macOS: no lock screen, no accessory families.
        EmptyView()
        #endif
    }
}
