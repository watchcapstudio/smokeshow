// The app's one screen: how bad is the air here, and when does it clear.
//
// Reading order matches the web, deliberately — a user who has both must not
// have to re-learn the product: place, level word, headline, reading, trend,
// curve, five days, what the instruments say, and the explainer.
//
// Every string on it is server-rendered. There is no `if pm25 > 35` in this
// file, and there must never be one.

import SwiftUI
import SmokeshowKit
#if os(iOS)
import CoreLocation
#endif

struct VerdictScreen: View {
    @EnvironmentObject private var model: AppModel
    @Binding var showsExplain: Bool
    @Binding var showsSettings: Bool
    @State private var showsPlaces = false
    @State private var showsMapInfo = false
    /// Bumped to re-read the saved-places list after a chip is removed.
    @State private var savedTick = 0

    /// One shared scrub index (nil = now) drives the sky verdict AND the map.
    /// That is the whole idea of the unified screen: the drag bar is the
    /// constant, and the canvas above it — sky or map — swaps beneath the same
    /// scrubbed moment.
    @State private var scrubbed: Int?
    @State private var isPlaying = false

    enum CanvasMode { case sky, map }
    @State private var canvas: CanvasMode = .sky

    #if os(iOS)
    @State private var domains: [SmokeDomain] = []
    @State private var frame: SmokeFramePayload?
    @State private var mapStatus: MapStatus = .loading
    private let mapTheme: SmokeDomain.Theme = .dark

    enum MapStatus: Equatable {
        case loading, painted(String), noCoverage, unavailable
    }
    #endif

    private var forecast: Forecast? { model.forecast }
    private var nowHour: Forecast.Hour? { forecast?.nowHour }

    /// What the screen is: a real forecast, the wait for the first one, an
    /// offline dead-end, or a prompt to pick a place. Every no-forecast state
    /// used to collapse into the same "Forecast unavailable" headline, which
    /// read as broken even while a fetch was in flight.
    enum Phase { case ready, loading, offline, needsPlace }

    private var phase: Phase {
        if forecast != nil { return .ready }
        if model.place == nil { return .needsPlace }
        // No forecast yet: offline only once a load has actually failed.
        // Before/while the first fetch runs there is no error, so this reads as
        // loading rather than flashing "Can't reach the forecast".
        if model.loadError != nil { return .offline }
        return .loading
    }

    /// Only a transport failure is "no internet". A service or version error is
    /// the server's problem, not the connection's, and gets its own in-body
    /// message rather than the offline bar.
    private var isOffline: Bool {
        if case .transport = model.loadError { return true }
        return false
    }

    /// Where the curve window starts inside `hours`, so a curve index can be
    /// turned back into the hour it belongs to.
    private var curveStart: Int {
        guard let forecast else { return 0 }
        return max(0, forecast.now.index - TimelineBuilder.curveLookback)
    }

    /// The hour the screen is currently describing: the scrubbed one while a
    /// thumb is on the curve, otherwise now.
    private var shownHour: Forecast.Hour? {
        guard let forecast, let scrubbed else { return nowHour }
        let index = curveStart + scrubbed
        guard forecast.hours.indices.contains(index) else { return nowHour }
        return forecast.hours[index]
    }

    /// Dragging the curve moves the sun. Every hour carries its own sky in the
    /// payload, so scrubbing forward into tonight genuinely sets it — this is
    /// the thing that made the demo feel like a window rather than a chart.
    private var sky: Forecast.Sky? { shownHour?.sky }

    /// The 61-hour curve (−12h … +48h). One source for the scrubber; the map's
    /// frame time is read off the same index.
    private var points: [CurvePoint] {
        guard let forecast else { return [] }
        return TimelineBuilder.curve(around: forecast.now.index, in: forecast)
    }
    private var nowIndex: Int {
        guard let forecast else { return 0 }
        return min(forecast.now.index, TimelineBuilder.curveLookback)
    }
    private var currentIndex: Int {
        let i = scrubbed ?? nowIndex
        return points.indices.contains(i) ? i : nowIndex
    }
    private var validTime: Date {
        let base = points.indices.contains(currentIndex)
            ? points[currentIndex].t
            : (forecast?.now.exactUTC ?? Date())
        return Calendar(identifier: .gregorian)
            .date(bySetting: .minute, value: 0, of: base) ?? base
    }

    /// Foreground ink follows the canvas: the sky decides on the window, the
    /// dark map is always light-inked.
    private var canvasInk: Color {
        #if os(iOS)
        if canvas == .map { return Palette.dark.text }
        #endif
        return sky?.ink ?? Palette.dark.text
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            canvasLayer

            // One scrubber, pinned to the bottom, identical on both canvases.
            if forecast != nil {
                scrubberBar
                    .padding(16)
            }
        }
        .foregroundStyle(canvasInk)
        .task(id: isPlaying) { await run() }
        .task(id: mapReloadKey) {
            #if os(iOS)
            guard canvas == .map else { return }
            if domains.isEmpty { await loadDomains() }
            await loadFrame()
            #endif
        }
        .sheet(isPresented: $showsPlaces) {
            PlacePickerView()
                .environmentObject(model)
        }
    }

    @ViewBuilder private var canvasLayer: some View {
        #if os(iOS)
        switch canvas {
        case .sky: windowCanvas
        case .map: mapCanvas
        }
        #else
        windowCanvas
        #endif
    }

    // MARK: - Sky canvas (the window)

    /// Sky, verdict, ridge, days — the demo's window. The curve moved into the
    /// bottom scrubber, so the ridge and the days move up into the space it
    /// left, and the ridge sits on the horizon above the days rather than
    /// bleeding through them.
    private var windowCanvas: some View {
        ZStack {
            // Sky and stars, full-bleed. The sun moved into the ridge band
            // below so it can set *behind* the hill, so the backdrop no longer
            // paints its own disc. While the first forecast is loading there is
            // no server sky yet, so a warm dawn stands in — the screen breathes
            // instead of sitting dark.
            if phase == .loading {
                LoadingSky().ignoresSafeArea()
            } else {
                SkyBackdrop(sky: sky, showsSun: false)
                    .ignoresSafeArea()
            }

            VStack(alignment: .leading, spacing: 0) {
                header

                Spacer(minLength: 12)
                verdictBlock
                Spacer(minLength: 16)

                // The ridge, in its settled place above the days — same layout
                // the app shipped. What is new is behind it: the sun sets
                // behind the near hill, and once it is down the moon rises at
                // tonight's phase.
                HorizonBand(sky: sky, pm25: shownHour?.pm25)
                .frame(height: 96)
                .padding(.horizontal, -20)

                Spacer(minLength: 14)

                if let forecast {
                    FiveDayBlock(
                        forecast: forecast,
                        selection: $scrubbed,
                        ink: sky?.ink ?? Palette.dark.text
                    )
                }

                if phase == .needsPlace {
                    choosePlaceButton
                }
            }
            .padding(20)
            // Reserve the pinned scrubber's footprint so the days clear it.
            .padding(.bottom, forecast == nil ? 20 : 224)
        }
    }

    private var choosePlaceButton: some View {
        Button { showsPlaces = true } label: {
            Text("Choose a place")
                .font(Typography.md)
                .padding(.horizontal, 18)
                .padding(.vertical, 12)
                .frame(maxWidth: .infinity)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(.white.opacity(0.14))
                )
        }
        .buttonStyle(.plain)
        .padding(.top, 12)
    }

    // MARK: - The shared scrubber

    private var scrubberBar: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                #if os(iOS)
                canvasToggle
                #endif
                placeChips
            }

            HStack {
                Text(whenLabel).font(Typography.md)
                Spacer()
                if scrubbed != nil {
                    Button("Now") {
                        isPlaying = false
                        scrubbed = nil
                    }
                    .font(Typography.eyebrow)
                    .buttonStyle(.plain)
                    .opacity(0.7)
                }
            }

            // The shape of the smoke is the track. The same CurveView the days
            // and the map both read — one control, one state.
            CurveView(
                points: points,
                nowIndex: nowIndex,
                ink: canvasInk,
                selection: $scrubbed
            )
            .frame(height: 84)

            HStack {
                Text("−12h").font(Typography.eyebrow).opacity(0.5)
                Spacer()
                Button { togglePlay() } label: {
                    Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                        .font(.system(size: 15, weight: .semibold))
                        .frame(width: 40, height: 40)
                        .background(Circle().fill(Palette.dark.accent.opacity(0.22)))
                }
                .buttonStyle(.plain)
                Spacer()
                Text("+48h").font(Typography.eyebrow).opacity(0.5)
            }
        }
        .padding(16)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    // MARK: - Saved-place chips

    /// The saved list, with the current place folded in if it was reached by
    /// search and never saved, so the row always shows where you are.
    private var savedPlaces: [Place] {
        _ = savedTick
        var list = PlaceStore.shared.places
        if let current = model.place, !list.contains(where: { $0.id == current.id }) {
            list.insert(current, at: 0)
        }
        return list
    }

    /// A scrollable row of places to the right of the Sky/Map toggle: tap to
    /// switch, the × to drop one, the ＋ to add another. Replaces the single
    /// place button, which could only ever show one and hid the rest in a sheet.
    private var placeChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(savedPlaces) { place in
                    placeChip(place)
                }
                Button { showsPlaces = true } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 11, weight: .semibold))
                        .padding(.horizontal, 11)
                        .padding(.vertical, 7)
                        .background(Capsule().fill(canvasInk.opacity(0.10)))
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func placeChip(_ place: Place) -> some View {
        let isCurrent = place.id == model.place?.id
        return HStack(spacing: 5) {
            if place.isCurrentLocation {
                Image(systemName: "location.fill").font(.system(size: 8))
            }
            Text(place.shortName.uppercased()).font(Typography.eyebrow)
            Button { removePlace(place) } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 8, weight: .bold))
                    .opacity(0.6)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Capsule().fill(canvasInk.opacity(isCurrent ? 0.22 : 0.10)))
        .overlay(Capsule().strokeBorder(canvasInk.opacity(isCurrent ? 0.4 : 0), lineWidth: 1))
        .contentShape(Capsule())
        .onTapGesture { Task { await model.select(place) } }
    }

    private func removePlace(_ place: Place) {
        let wasCurrent = place.id == model.place?.id
        PlaceStore.shared.remove(place)
        savedTick += 1
        // Removing the place you're looking at needs a new one to show, or the
        // screen has nothing to describe.
        if wasCurrent, let next = PlaceStore.shared.places.first {
            Task { await model.select(next) }
        }
    }

    private var whenLabel: String {
        guard scrubbed != nil, points.indices.contains(currentIndex) else { return "Now" }
        return readout(for: points[currentIndex])
    }

    private func readout(for point: CurvePoint) -> String {
        let formatter = DateFormatter()
        formatter.timeZone = forecast?.location.timeZone ?? .current
        formatter.dateFormat = "EEE h a"
        let stamp = formatter.string(from: point.t)
        guard let value = point.value else { return "\(stamp) · \(Copy.noData)" }
        switch model.preferences.unit {
        case .microgramsPerCubicMetre:
            return "\(stamp) · \(Int(value.rounded())) µg/m³"
        case .aqi:
            let hour = forecast?.hours.first { $0.t == point.t }
            guard let aqi = hour?.aqi else { return "\(stamp) · \(Copy.noData)" }
            return "\(stamp) · AQI \(aqi) (approx)"
        }
    }

    private func togglePlay() {
        if !isPlaying {
            let count = points.count
            let current = scrubbed ?? nowIndex
            if count > 1, current >= count - 1 { scrubbed = 0 }
        }
        isPlaying.toggle()
    }

    /// The step interval, in seconds. The per-step animation is *linear* and
    /// exactly this long, so consecutive steps abut with no ease pulse — the
    /// dot and the sky glide at constant speed instead of jerking each hour.
    private static let playStep: Double = 0.34

    private func run() async {
        guard isPlaying, points.count > 1 else { return }
        while !Task.isCancelled && isPlaying {
            try? await Task.sleep(for: .seconds(Self.playStep))
            guard !Task.isCancelled, isPlaying else { return }
            let count = points.count
            let current = scrubbed ?? nowIndex
            let next = current >= count - 1 ? 0 : current + 1
            // Glide each step at constant speed — except the loop's rewind to 0,
            // which would sweep the whole day backwards.
            if next == 0 {
                scrubbed = 0
            } else {
                withAnimation(.linear(duration: Self.playStep)) { scrubbed = next }
            }
        }
    }

    private var mapReloadKey: String {
        #if os(iOS)
        return "\(canvas == .map)|\(SmokeFrames.timeKey(for: validTime))|\(model.place?.id.uuidString ?? "-")|\(domains.count)"
        #else
        return ""
        #endif
    }

    #if os(iOS)
    // MARK: - Map canvas

    private var mapCanvas: some View {
        ZStack(alignment: .top) {
            MapLibreCanvas(
                center: model.place.map {
                    CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude)
                },
                frame: frame,
                onLongPress: { coordinate in Task { await move(to: coordinate) } }
            )
            .ignoresSafeArea()

            // Never lose the answer while looking at the smoke: a compact
            // verdict on the left, the model named on the right. The required
            // map credit tucks into the leading "i", out of the way.
            HStack(alignment: .top, spacing: 8) {
                Button { showsMapInfo = true } label: {
                    Image(systemName: "info.circle")
                        .font(.system(size: 15, weight: .medium))
                        .opacity(0.5)
                        .padding(.vertical, 7)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                if let name = forecast?.nowScaleEntry?.name {
                    Text(name.uppercased())
                        .font(Typography.eyebrow)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(Capsule().fill(.ultraThinMaterial))
                }
                Spacer()
                Text(mapStatusLine)
                    .font(Typography.eyebrow)
                    .multilineTextAlignment(.trailing)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Capsule().fill(.ultraThinMaterial))
            }
            .padding(.horizontal, 16)
        }
        .alert("Map data", isPresented: $showsMapInfo) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("© OpenStreetMap contributors · © CARTO")
        }
    }

    /// The sky's own warm accent, so the live stage reads at a glance and the
    /// switch carries the app's identity instead of a grey wash. Constant across
    /// both canvases (the map is always dark-inked), matching the web twin.
    private var toggleAccent: Color { Palette.dark.accent }

    private var canvasToggle: some View {
        HStack(spacing: 2) {
            toggleButton("Sky", on: canvas == .sky) { setCanvas(.sky) }
            toggleButton("Map", on: canvas == .map) { setCanvas(.map) }
        }
        .padding(3)
        .background(Capsule().fill(canvasInk.opacity(0.12)))
    }

    private func toggleButton(_ title: String, on: Bool, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title.uppercased())
                .font(Typography.eyebrow)
                .foregroundStyle(on ? Palette.light.text : canvasInk)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(Capsule().fill(on ? toggleAccent : Color.clear))
                .opacity(on ? 1 : 0.55)
        }
        .buttonStyle(.plain)
    }

    private func setCanvas(_ next: CanvasMode) {
        isPlaying = false
        withAnimation(.easeInOut(duration: 0.28)) { canvas = next }
    }

    private var mapStatusLine: String {
        switch mapStatus {
        case .loading: return "LOADING"
        case .painted(let model): return model.uppercased()
        case .noCoverage: return "NO SMOKE COVERAGE HERE"
        case .unavailable: return "COVERAGE UNAVAILABLE"
        }
    }

    private func loadDomains() async {
        do {
            domains = try await SmokeFrames.fetchDomains()
            if domains.isEmpty { mapStatus = .unavailable }
        } catch {
            mapStatus = .unavailable
        }
    }

    private func loadFrame() async {
        guard !domains.isEmpty, let place = model.place else { return }
        let coordinate = CLLocationCoordinate2D(latitude: place.latitude, longitude: place.longitude)
        guard let match = SmokeFrames.domain(
            for: coordinate,
            at: validTime,
            in: domains,
            theme: mapTheme
        ) else {
            frame = nil
            mapStatus = .noCoverage
            return
        }
        do {
            let image = try await SmokeFrameImage.load(match.frame)
            guard !Task.isCancelled else { return }
            frame = SmokeFramePayload(image: image, bounds: match.domain.bounds)
            mapStatus = .painted(match.domain.model)
        } catch {
            guard !Task.isCancelled, !(error is CancellationError) else { return }
            if (error as NSError).code == NSURLErrorCancelled { return }
            mapStatus = .unavailable
        }
    }

    private func move(to coordinate: CLLocationCoordinate2D) async {
        let name = await Self.name(for: coordinate) ?? "Dropped pin"
        await model.select(
            Place(name: name, latitude: coordinate.latitude, longitude: coordinate.longitude)
        )
    }

    private static func name(for coordinate: CLLocationCoordinate2D) async -> String? {
        let location = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        let placemarks = try? await CLGeocoder().reverseGeocodeLocation(location)
        guard let placemark = placemarks?.first else { return nil }
        return placemark.locality
            ?? placemark.subAdministrativeArea
            ?? placemark.administrativeArea
            ?? placemark.country
    }
    #endif

    private var header: some View {
        HStack(spacing: 8) {
            // The demo's "NOW" — the clock that says which moment the screen
            // is describing. It matters more once the curve can be scrubbed
            // away from the present.
            Text(clockLabel)
                .font(Typography.eyebrow)
                .opacity(0.45)

            Spacer()

            Button { showsSettings = true } label: {
                Image(systemName: "slider.horizontal.3")
                    .font(.system(size: 15, weight: .semibold))
                    .opacity(0.6)
            }
            .buttonStyle(.plain)
        }
    }

    private var clockLabel: String {
        guard let forecast else { return "NOW" }
        let formatter = DateFormatter()
        formatter.timeZone = forecast.location.timeZone
        formatter.dateFormat = "h:mm a"
        return formatter.string(from: forecast.now.exactUTC).uppercased()
    }

    @ViewBuilder
    private var verdictBlock: some View {
        if forecast != nil {
            readyVerdict
        } else {
            statusVerdict
        }
    }

    /// The verdict area before there is a forecast to show. Never the bare
    /// "Forecast unavailable" — that read as broken mid-load. Each phase says
    /// what is actually happening.
    private var statusVerdict: some View {
        VStack(alignment: .leading, spacing: 8) {
            switch phase {
            case .loading:
                LoadingHeadline()
                RotatingLine(phrases: Copy.loadingLines)
            case .offline:
                Text(Copy.offlineHeadline)
                    .font(Typography.display)
                    .minimumScaleFactor(0.6)
                    .lineLimit(2)
                Text(Copy.offlineDetail)
                    .font(Typography.base)
                    .opacity(0.75)
            case .needsPlace:
                Text("Choose a place")
                    .font(Typography.display)
                    .minimumScaleFactor(0.6)
                    .lineLimit(2)
                Text("Smokeshow shows the air where you are.")
                    .font(Typography.base)
                    .opacity(0.75)
            case .ready:
                EmptyView()
            }
        }
    }

    private var readyVerdict: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(forecast?.nowScaleEntry?.name ?? Copy.unavailable)
                .font(Typography.display)
                .minimumScaleFactor(0.6)
                .lineLimit(2)

            if let hour = shownHour, let trend = hour.trend {
                TrendChip(trend: trend)
                    .padding(.bottom, 2)
            }

            // The one sentence guaranteed identical on the phone and the
            // laptop. Rendered verbatim, never re-derived — and given the
            // accent, because "when does it clear" is the whole question.
            Text(forecast?.verdict.headline ?? "")
                .font(Typography.md)
                .foregroundStyle(sky?.accent ?? Palette.dark.accent)

            Text(forecast?.nowScaleEntry?.notice ?? "")
                .font(Typography.base)
                .opacity(0.78)

            Text(readingLine)
                .font(Typography.eyebrow)
                .opacity(0.72)

            explainButton
                .padding(.top, 6)

            // Offline with a forecast still on screen: a clear tag right under
            // the explainer, where the eye already is. The old top banner was
            // too easy to miss; this reads as "these numbers are last-known".
            if isOffline {
                OfflineTag()
                    .padding(.top, 8)
            }

            if model.isStale, let generatedAt = forecast?.generatedAt {
                Text(Copy.asOf(generatedAt))
                    .font(Typography.eyebrow)
                    .opacity(0.5)
            }
        }
    }

    private var readingLine: String {
        guard let hour = shownHour else { return Copy.reading(Copy.noData) }
        switch model.preferences.unit {
        case .microgramsPerCubicMetre:
            guard let pm = hour.pm25 else { return Copy.reading(Copy.noData) }
            return Copy.reading("\(Int(pm.rounded())) µg/m³ PM2.5")
        case .aqi:
            guard let aqi = hour.aqi else { return Copy.reading(Copy.noData) }
            return Copy.reading("AQI \(aqi) (approx)")
        }
    }

    /// A text link, not a pill. On a screen that is meant to read as a window,
    /// a bordered control is the one thing that looks pasted on — and this is
    /// also where the instrument rows and the disclaimer now live.
    private var explainButton: some View {
        Button { showsExplain = true } label: {
            Text("What this means ›")
                .font(Typography.sm)
                .opacity(0.75)
        }
        .buttonStyle(.plain)
    }
}

/// `hours[].trend` is already verdict-guarded server-side: it is muted to
/// "steady" wherever it would contradict the headline, so the chip can never
/// read "Improving" next to "No clear air in the 5-day window" (contract §4).
struct TrendChip: View {
    let trend: Forecast.HourTrend

    private var label: String {
        switch trend {
        case .rising: return "Getting worse"
        case .falling: return "Improving"
        case .steady: return "Holding steady"
        case .unknown: return "Holding steady"
        }
    }

    private var color: Color {
        switch trend {
        case .rising: return Color(Tokens.Color.Dark.tastes)
        case .falling: return Color(Tokens.Color.Dark.allClear)
        case .steady, .unknown: return Color(Tokens.Color.Dark.textDim)
        }
    }

    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 7, height: 7)
            Text(label).font(Typography.sm)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(Capsule().fill(Color.black.opacity(0.14)))
    }
}

struct TimelineBlock: View {
    let forecast: Forecast
    let unit: MeasurementUnit

    /// Owned by the screen, not by this block: the sky, the ridge and the
    /// reading all follow the scrubbed hour, so the state has to live above
    /// all of them.
    @Binding var scrubbed: Int?
    /// The ink of the sky currently *behind* the curve, which is the scrubbed
    /// hour's, not now's. Pinning it to now drew a dark line on a night sky
    /// the moment a daytime reader scrubbed into the small hours.
    var ink: Color = Palette.dark.text

    private var points: [CurvePoint] {
        TimelineBuilder.curve(around: forecast.now.index, in: forecast)
    }

    private var nowIndex: Int {
        min(forecast.now.index, TimelineBuilder.curveLookback)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                if let scrubbed, points.indices.contains(scrubbed) {
                    Text(readout(for: points[scrubbed]))
                        .font(Typography.eyebrow)
                        .opacity(0.8)
                    Spacer()
                    Button("Now") { self.scrubbed = nil }
                        .font(Typography.eyebrow)
                        .buttonStyle(.plain)
                        .opacity(0.6)
                } else {
                    Text("Now").font(Typography.sm)
                    Spacer()
                    Text("−12h · +48h").font(Typography.eyebrow).opacity(0.5)
                }
            }
            CurveView(
                points: points,
                nowIndex: nowIndex,
                ink: ink,
                selection: $scrubbed
            )
            // Was 74pt, which made the whole point of the screen — the shape
            // of the smoke — the smallest thing on it.
            .frame(height: 150)
        }
        .animation(.none, value: scrubbed)
    }

    /// "Sat 9 PM · 24 µg/m³". A null hour prints the dash the contract
    /// requires — scrubbing onto a gap must not invent a number.
    private func readout(for point: CurvePoint) -> String {
        let formatter = DateFormatter()
        formatter.timeZone = forecast.location.timeZone
        formatter.dateFormat = "EEE h a"
        let stamp = formatter.string(from: point.t)

        guard let value = point.value else {
            return "\(stamp) · \(Copy.noData)"
        }
        switch unit {
        case .microgramsPerCubicMetre:
            return "\(stamp) · \(Int(value.rounded())) µg/m³"
        case .aqi:
            let hour = forecast.hours.first { $0.t == point.t }
            guard let aqi = hour?.aqi else { return "\(stamp) · \(Copy.noData)" }
            return "\(stamp) · AQI \(aqi) (approx)"
        }
    }
}

/// The five days, standing on their own under the curve. Each is a tap
/// target: it sends the scrubber to that day's worst hour, which is the hour
/// a person means when they point at a day and ask "what about then?".
///
/// Days past the curve's +48h window cannot be scrubbed to, so they are dimmed
/// rather than silently doing nothing.
struct FiveDayBlock: View {
    let forecast: Forecast
    var selection: Binding<Int?>?
    /// The sky's ink. Pills tinted with white vanish the moment the sky goes
    /// light, which is exactly when scrubbing into daylight makes them matter.
    var ink: Color = Palette.dark.text

    private var points: [CurvePoint] {
        TimelineBuilder.curve(around: forecast.now.index, in: forecast)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                ForEach(forecast.days) { day in
                    dayPill(day)
                }
            }

            if !forecast.pastDays.isEmpty {
                Text("Before today: \(forecast.pastDays.map(\.weekday).joined(separator: " · ")) · \(Copy.modelEstimate)")
                    .font(Typography.eyebrow)
                    .opacity(0.45)
            }
        }
    }

    @ViewBuilder
    private func dayPill(_ day: Forecast.Day) -> some View {
        let target = curveIndex(for: day)
        let isSelected = target != nil && target == selection?.wrappedValue

        Button {
            guard let target else { return }
            selection?.wrappedValue = (selection?.wrappedValue == target) ? nil : target
        } label: {
            VStack(spacing: 5) {
                Text(day.weekday.uppercased())
                    .font(.system(size: 9, weight: .semibold, design: .monospaced))
                    .opacity(0.7)
                Text(forecast.scaleEntry(at: day.levelIndex)?.name ?? Copy.noData)
                    .font(.system(size: 9.5, weight: .medium))
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                    .minimumScaleFactor(0.7)
                    .opacity(0.85)
                HStack(spacing: 2) {
                    ForEach(day.dayParts) { part in
                        RoundedRectangle(cornerRadius: 1.5)
                            .fill(part.bucket.flatMap { Color(serverHex: $0.color) }
                                ?? ink.opacity(0.12))
                            .frame(height: 5)
                    }
                }
            }
            .padding(.vertical, 9)
            .padding(.horizontal, 6)
            .frame(maxWidth: .infinity)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(ink.opacity(isSelected ? 0.16 : 0.07))
            )
            .opacity(target == nil ? 0.45 : 1)
        }
        .buttonStyle(.plain)
        .disabled(target == nil)
    }

    /// The day's worst hour, expressed as a curve index. Nil when the day
    /// falls outside the scrubbable window.
    private func curveIndex(for day: Forecast.Day) -> Int? {
        var formatter: DateFormatter {
            let f = DateFormatter()
            f.timeZone = forecast.location.timeZone
            f.dateFormat = "yyyy-MM-dd"
            return f
        }
        let key = formatter
        let matches = points.enumerated().filter { key.string(from: $0.element.t) == day.key }
        guard !matches.isEmpty else { return nil }
        let worst = matches.max { ($0.element.value ?? -1) < ($1.element.value ?? -1) }
        return worst?.offset
    }
}

/// The dawn that stands in for the sky while the first forecast loads. There
/// is no server sky yet, so the colours are fixed — a slow, warm sunrise that
/// reads as "on its way" rather than the dark, dead panel a nil sky paints.
struct LoadingSky: View {
    @State private var risen = false

    var body: some View {
        GeometryReader { geo in
            let size = geo.size
            ZStack {
                LinearGradient(
                    colors: [
                        Color(.sRGB, red: 0.10, green: 0.14, blue: 0.26, opacity: 1),
                        Color(.sRGB, red: 0.36, green: 0.29, blue: 0.38, opacity: 1),
                        Color(.sRGB, red: 0.84, green: 0.55, blue: 0.33, opacity: 1),
                    ],
                    startPoint: .top, endPoint: .bottom
                )
                // A soft sun low on the horizon, easing up and down so the
                // screen breathes while the numbers are still on their way.
                RadialGradient(
                    colors: [
                        Color(.sRGB, red: 1.0, green: 0.86, blue: 0.60, opacity: 0.95),
                        Color(.sRGB, red: 1.0, green: 0.70, blue: 0.40, opacity: 0.45),
                        .clear,
                    ],
                    center: .center, startRadius: 0, endRadius: size.width * 0.45
                )
                .frame(width: size.width * 0.9, height: size.width * 0.9)
                .position(x: size.width * 0.5, y: size.height * (risen ? 0.70 : 0.82))
                .opacity(risen ? 0.95 : 0.7)
                .animation(.easeInOut(duration: 2.6).repeatForever(autoreverses: true), value: risen)
            }
        }
        .onAppear { risen = true }
    }
}

/// "Pulling forecast" at the display size the verdict normally fills, with an
/// ellipsis that pulses beneath it so the big headline reads as active.
struct LoadingHeadline: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(Copy.loadingHeadline)
                .font(Typography.display)
                .minimumScaleFactor(0.6)
                .lineLimit(2)
            PulsingDots()
        }
    }
}

/// The offline indicator that lives under "What this means", where the eye
/// already rests. A material capsule so it reads on any sky, light or dark.
struct OfflineTag: View {
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "wifi.slash")
                .font(.system(size: 11, weight: .semibold))
            Text(Copy.offlineTag)
                .font(Typography.eyebrow)
                .fontWeight(.semibold)
            Text(Copy.offlineTagDetail)
                .font(Typography.eyebrow)
                .opacity(0.7)
        }
        .padding(.horizontal, 11)
        .padding(.vertical, 7)
        .background(Capsule().fill(.ultraThinMaterial))
        .overlay(Capsule().strokeBorder(Color.primary.opacity(0.12), lineWidth: 1))
    }
}

/// The loading subline, rotating through a few plainspoken steps so the wait
/// reads as work in progress. Driven off the clock; crossfades on each change.
struct RotatingLine: View {
    let phrases: [String]
    private let period: Double = 1.2

    var body: some View {
        TimelineView(.periodic(from: .now, by: period)) { context in
            let i = Int(context.date.timeIntervalSinceReferenceDate / period) % max(phrases.count, 1)
            Text(phrases[i])
                .font(Typography.base)
                .opacity(0.7)
                .id(i)
                .transition(.opacity)
                .animation(.easeInOut(duration: 0.4), value: i)
        }
    }
}

/// Three dots cycling to signal work, driven off the clock so there is no
/// animation state to reset between redraws.
struct PulsingDots: View {
    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.3)) { context in
            let active = Int(context.date.timeIntervalSinceReferenceDate / 0.3) % 3
            HStack(spacing: 6) {
                ForEach(0..<3, id: \.self) { i in
                    Circle()
                        .frame(width: 7, height: 7)
                        .opacity(i == active ? 1 : 0.3)
                }
            }
        }
    }
}

