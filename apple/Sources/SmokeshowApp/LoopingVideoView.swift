// A silent, auto-looping video for the onboarding map screen.
//
// The whole point is that there is no wait: the clip ships in the bundle, and
// the player is built and started the moment onboarding launches, off-screen,
// so by the time the reader swipes to the map screen it is already mid-loop.
// The card just attaches the running player's layer — a cheap operation — so
// nothing spins up while the screen is on.

#if os(iOS)

import SwiftUI
import AVFoundation

/// Owns the player for onboarding's lifetime. Built once, plays immediately.
/// `shared` is warmed at app launch (see `AppDelegate`), so by the time the
/// walkthrough reaches the map screen the clip is already running — no spin-up.
final class OnboardingVideo: ObservableObject {
    static let shared = OnboardingVideo(resource: "onboarding-map", ext: "mp4")

    let player = AVQueuePlayer()
    private var looper: AVPlayerLooper?

    init(resource: String, ext: String) {
        guard let url = Bundle.main.url(forResource: resource, withExtension: ext) else { return }
        player.isMuted = true
        player.automaticallyWaitsToMinimizeStalling = false
        let item = AVPlayerItem(url: url)
        looper = AVPlayerLooper(player: player, templateItem: item)
        player.play()
    }
}

/// Attaches an already-running player to a layer. No setup cost at display time.
struct PlayerLayerView: UIViewRepresentable {
    let player: AVQueuePlayer

    func makeUIView(context: Context) -> PlayerView {
        let view = PlayerView()
        view.playerLayer.player = player
        view.playerLayer.videoGravity = .resizeAspectFill
        return view
    }

    func updateUIView(_ uiView: PlayerView, context: Context) {
        uiView.playerLayer.player = player
    }

    final class PlayerView: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    }
}

#endif
