// The horizon band: the ridge, with the sun or moon behind it.
//
// A drop-in enrichment of the shipped `RidgeView` slot — same in-flow strip,
// same place above the day pills, so the settled layout (days tucked just under
// the mountains) does not move. All this adds is what is *behind* the ridge: a
// sun that sets behind the near hill with a warm afterglow, and, once it is
// down, a moon rising at tonight's real phase. The sky gradient and stars are a
// separate full-bleed layer (`SkyBackdrop`, showsSun: false).
//
//   • the near hill is solid, feathered and rim-lit — the sun sets *behind* it;
//   • the far hill stays translucent and haze-eaten by PM2.5 — the visibility
//     gauge survives;
//   • the moon phase is computed here for now, but it belongs in the payload
//     next to the sun (contract §4), and this file is where it plugs in.

import SwiftUI

public struct HorizonBand: View {
    private let sky: Forecast.Sky?
    private let pm25: Double?
    private let date: Date
    /// The observer, for the moon's altitude/azimuth. Temporary: the moon's
    /// position belongs in the payload next to the sun (contract §4), computed
    /// once on the edge like everything else in `Sky`.
    private let latitude: Double?
    private let longitude: Double?

    public init(sky: Forecast.Sky?, pm25: Double?, date: Date, latitude: Double? = nil, longitude: Double? = nil) {
        self.sky = sky
        self.pm25 = pm25
        self.date = date
        self.latitude = latitude
        self.longitude = longitude
    }

    public var body: some View {
        GeometryReader { geo in
            let size = geo.size
            let crest = size.height * 0.30 // where the near ridge tops out
            ZStack {
                // The moon is often a daytime object (a waning crescent rides
                // the day sky), so it is drawn whenever it is above the horizon,
                // pale by day and bright at night — not only when the sun is
                // down. It renders nothing when the moon is set.
                moon(in: size, crest: crest)
                if let sky, sky.sun.visible {
                    bloom(for: sky, in: size, crest: crest)
                    sunDisc(for: sky, in: size, crest: crest)
                }
                hills(in: size, crest: crest)
            }
        }
        .allowsHitTesting(false)
    }

    // MARK: Sun

    /// The disc descends from just above the band down behind the ridge as the
    /// server's `yFrac` grows, and never leaves the band — the sun stays a
    /// horizon event, never climbing behind the copy above it.
    private func sunY(for sky: Forecast.Sky, height: CGFloat, crest: CGFloat) -> CGFloat {
        let t = clamp((sky.sun.yFrac - 0.12) / (0.60 - 0.12))
        return lerp(-height * 0.35, crest + (height - crest) * 0.45, t)
    }

    /// Horizontal position straight off the raw azimuth (east 90 → left, south
    /// 180 → centre, west 270 → right), *unclamped*. The server's `xFrac` pins
    /// it to the edges outside 90–270, which makes the sun climb the left rail
    /// then jump right; this lets it arc across continuously instead. It runs a
    /// little off-frame at the horizon ends, where the sun is behind the ridge
    /// anyway.
    private func azimuthX(_ azimuthDeg: Double) -> CGFloat {
        // A gentle span, not the full width: enough drift to read as a
        // traverse, but the arc stays central so the disc rises up from behind
        // the ridge rather than sliding in from the screen's side edge.
        let span = 0.42
        return CGFloat(min(max(0.5 + (azimuthDeg - 180) / 180 * span, 0.06), 0.94))
    }

    private func sunDisc(for sky: Forecast.Sky, in size: CGSize, crest: CGFloat) -> some View {
        let dim = sky.sun.dim
        let core = Color(
            .sRGB,
            red: lerp(1.0, 0.808, dim),
            green: lerp(0.965, 0.431, dim),
            blue: lerp(0.878, 0.188, dim),
            opacity: 1
        )
        let diameter = size.height * 0.72
        let y = sunY(for: sky, height: size.height, crest: crest)
        // Soften as it drops toward the horizon: a low sun is dimmer and gentler
        // than a midday one, so it does not read as a hot orange dot at sunset.
        let top = -size.height * 0.35
        let descent = clamp((y - top) / (crest - top)) // 0 high … 1 at the crest
        // Then dissolve past the crest, so it melts into the feathered ridge
        // instead of bleeding through the translucent lower slopes. The glow
        // carries the set from there.
        let fade = clamp((y - crest) / (size.height * 0.30))
        return RadialGradient(
            colors: [core.opacity(1 - 0.35 * descent), core.opacity(0.9 - 0.4 * descent), .clear],
            center: .center,
            startRadius: 0,
            endRadius: diameter * (0.5 - 0.18 * dim) * (1 - 0.15 * descent)
        )
        .frame(width: diameter, height: diameter)
        .opacity(Double((1 - fade) * (1 - 0.5 * descent)))
        .position(x: size.width * azimuthX(sky.sun.azimuthDeg), y: y)
    }

    /// The warm afterglow pooled on the ridgeline where the sun is. This, not
    /// the disc, is what reads as a sunset once the sun is behind the hill.
    private func bloom(for sky: Forecast.Sky, in size: CGSize, crest: CGFloat) -> some View {
        let discY = sunY(for: sky, height: size.height, crest: crest)
        let low = self.low(discY: discY, crest: crest, height: size.height)
        let warm = Color(.sRGB, red: 0.94, green: 0.58, blue: 0.29, opacity: 1)
        let diameter = size.width * 0.7
        return RadialGradient(
            colors: [warm.opacity(0.5 * low + 0.12), warm.opacity(0.24 * low), .clear],
            center: .center,
            startRadius: 0,
            endRadius: diameter * 0.5
        )
        .frame(width: diameter, height: diameter)
        .position(x: size.width * azimuthX(sky.sun.azimuthDeg), y: min(discY + size.height * 0.1, crest + size.height * 0.2))
    }

    /// How far the sun has sunk toward/behind the ridge, 0…1.
    private func low(discY: CGFloat, crest: CGFloat, height: CGFloat) -> CGFloat {
        clamp((discY + height * 0.35) / (crest + height * 0.35))
    }

    // MARK: Moon

    /// The moon travels the same band the sun does: it climbs from behind the
    /// ridge as it rises and sinks back behind it as it sets, mapped from a real
    /// altitude/azimuth. Below the horizon it is simply absent.
    @ViewBuilder
    private func moon(in size: CGSize, crest: CGFloat) -> some View {
        if let latitude, let longitude {
            let pos = Self.moonPosition(date: date, latitude: latitude, longitude: longitude)
            let t = clamp((pos.yFrac - 0.12) / (0.60 - 0.12))
            let y = lerp(-size.height * 0.35, crest + (size.height - crest) * 0.45, t)
            let x = size.width * azimuthX(pos.azimuthDeg)
            // Dissolve into the ridge at the horizon ends, like the sun.
            let fade = clamp((y - crest) / (size.height * 0.30))
            let risen = clamp((pos.altitudeDeg + 2) / 6)
            // Pale in daylight, full at night.
            let daylight: CGFloat = (sky?.sun.visible ?? false) ? 0.5 : 1
            let diameter = size.height * 0.34
            let phase = Self.moonPhaseFraction(date)
            ZStack {
                Circle()
                    .fill(RadialGradient(
                        colors: [Color(white: 0.92).opacity(0.26), .clear],
                        center: .center, startRadius: 0, endRadius: diameter
                    ))
                    .frame(width: diameter * 2.6, height: diameter * 2.6)
                MoonShape(phase: phase)
                    .fill(Color(.sRGB, red: 0.94, green: 0.95, blue: 0.90, opacity: 1))
                    .frame(width: diameter, height: diameter)
            }
            .opacity(Double((1 - fade) * risen * daylight))
            .position(x: x, y: y)
        }
    }

    /// Low-precision lunar position (Schlyter) → screen fractions matching the
    /// server's sun mapping. Temporary; belongs on the edge next to the sun.
    /// Returns azimuth° (0 N, 90 E, 180 S, 270 W), yFrac (0 top … 1 horizon),
    /// and altitude°.
    static func moonPosition(date: Date, latitude: Double, longitude: Double) -> (azimuthDeg: Double, yFrac: Double, altitudeDeg: Double) {
        let rad = Double.pi / 180
        func rev(_ x: Double) -> Double { let r = x.truncatingRemainder(dividingBy: 360); return r < 0 ? r + 360 : r }

        // Days since the epoch 2000 Jan 0.0 UT (JD 2451543.5).
        let d = date.timeIntervalSince1970 / 86_400 + 2_440_587.5 - 2_451_543.5

        // Moon's orbital elements.
        let N = rev(125.1228 - 0.0529538083 * d) * rad
        let i = 5.1454 * rad
        let w = rev(318.0634 + 0.1643573223 * d) * rad
        let a = 60.2666
        let e = 0.054900
        let M = rev(115.3654 + 13.0649929509 * d) * rad

        var E = M + e * sin(M) * (1 + e * cos(M))
        E -= (E - e * sin(E) - M) / (1 - e * cos(E))

        let xv = a * (cos(E) - e)
        let yv = a * (sqrt(1 - e * e) * sin(E))
        let v = atan2(yv, xv)
        let r = sqrt(xv * xv + yv * yv)

        let xh = r * (cos(N) * cos(v + w) - sin(N) * sin(v + w) * cos(i))
        let yh = r * (sin(N) * cos(v + w) + cos(N) * sin(v + w) * cos(i))
        let zh = r * (sin(v + w) * sin(i))

        let lonEcl = atan2(yh, xh)
        let latEcl = atan2(zh, sqrt(xh * xh + yh * yh))
        let ecl = (23.4393 - 3.563e-7 * d) * rad

        // Ecliptic → equatorial.
        let xe = cos(lonEcl) * cos(latEcl)
        let ye = sin(lonEcl) * cos(latEcl) * cos(ecl) - sin(latEcl) * sin(ecl)
        let ze = sin(lonEcl) * cos(latEcl) * sin(ecl) + sin(latEcl) * cos(ecl)
        let ra = atan2(ye, xe)
        let dec = atan2(ze, sqrt(xe * xe + ye * ye))

        // Local sidereal time.
        let ws = rev(282.9404 + 4.70935e-5 * d)
        let Ms = rev(356.0470 + 0.9856002585 * d)
        let gmst0 = rev(ws + Ms + 180)
        let utHours = (date.timeIntervalSince1970 / 3600).truncatingRemainder(dividingBy: 24)
        let lst = rev(gmst0 + utHours * 15 + longitude) * rad
        let ha = lst - ra

        let lat = latitude * rad
        let sinAlt = sin(lat) * sin(dec) + cos(lat) * cos(dec) * cos(ha)
        let alt = asin(min(max(sinAlt, -1), 1))
        var azimuth = atan2(sin(ha), cos(ha) * sin(lat) - tan(dec) * cos(lat)) / rad + 180
        azimuth = rev(azimuth) // 0 N, 90 E, 180 S, 270 W — matches the sun

        let altSin = sin(alt)
        // `azimuthX` (shared with the sun) maps this to a screen fraction.
        let yFrac = min(max(1 - min(max(altSin * 1.4, 0), 1), 0), 1) * 0.4 + 0.12
        return (azimuth, yFrac, alt / rad)
    }

    /// Days since a known new moon, as a 0…1 fraction of the synodic month.
    /// 0 = new, 0.5 = full.
    static func moonPhaseFraction(_ date: Date) -> Double {
        let jd = date.timeIntervalSince1970 / 86_400 + 2_440_587.5
        let synodic = 29.530588853
        var age = (jd - 2_451_550.1).truncatingRemainder(dividingBy: synodic)
        if age < 0 { age += synodic }
        return age / synodic
    }

    // MARK: Hills

    /// The shipped ridge, unchanged: two silhouettes filled with a gradient
    /// that is densest at the crest and feathers to nothing downward — no hard
    /// horizon, no outline. Haze pools in the valleys and the far ridge
    /// dissolves first, which is the visibility gauge. The sun sitting *behind*
    /// this is veiled most at the dense crest and melts as it sinks.
    private func hills(in size: CGSize, crest: CGFloat) -> some View {
        let value = pm25 ?? 0
        let strength: CGFloat = 0.62
        let far = (1 - clamp((value - 6) / 26)) * 0.42 * strength
        let near = (1 - clamp((value - 20) / 110)) * 0.58 * strength
        let inkTop = Color(.sRGB, red: 0.118, green: 0.102, blue: 0.078, opacity: 1)

        return ZStack {
            RidgeShape(layer: .far)
                .fill(LinearGradient(
                    colors: [inkTop.opacity(far), inkTop.opacity(0)],
                    startPoint: .top, endPoint: .bottom
                ))
                .frame(width: size.width, height: size.height)

            RidgeShape(layer: .near)
                .fill(LinearGradient(
                    colors: [inkTop.opacity(near), inkTop.opacity(0)],
                    startPoint: .top, endPoint: .bottom
                ))
                .frame(width: size.width, height: size.height)
        }
    }

    private func clamp(_ v: CGFloat) -> CGFloat { min(max(v, 0), 1) }
    private func clamp(_ v: Double) -> Double { min(max(v, 0), 1) }
    private func lerp(_ a: CGFloat, _ b: CGFloat, _ t: CGFloat) -> CGFloat { a + (b - a) * t }
    private func lerp(_ a: Double, _ b: Double, _ t: Double) -> Double { a + (b - a) * t }
}

/// The lit region of the moon at a given phase, sampled as a filled outline so
/// it works for every phase without elliptical-arc bookkeeping. No dark disc —
/// only the lit sliver, floating.
///
/// `phase`: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter.
struct MoonShape: Shape {
    let phase: Double

    func path(in rect: CGRect) -> Path {
        let r = min(rect.width, rect.height) / 2
        let cx = rect.midX
        let cy = rect.midY
        let k = cos(2 * .pi * phase)          // +1 new → −1 full
        let s: CGFloat = phase < 0.5 ? 1 : -1 // lit limb: right waxing, left waning
        let steps = 48

        var limb: [CGPoint] = []
        var term: [CGPoint] = []
        for i in 0...steps {
            let u = CGFloat(i) / CGFloat(steps) * 2 - 1 // −1 top … 1 bottom
            let w = (1 - u * u).squareRoot()
            let y = cy + r * u
            limb.append(CGPoint(x: cx + s * r * w, y: y))
            term.append(CGPoint(x: cx + s * CGFloat(k) * r * w, y: y))
        }

        var path = Path()
        path.move(to: limb[0])
        for p in limb.dropFirst() { path.addLine(to: p) }
        for p in term.reversed() { path.addLine(to: p) }
        path.closeSubpath()
        return path
    }
}
