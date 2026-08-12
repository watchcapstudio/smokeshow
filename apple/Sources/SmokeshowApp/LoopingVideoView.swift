// A silent, auto-looping video, for onboarding illustrations only.
//
// AVPlayerLooper is the one API that loops without a gap or a seek stutter, and
// it needs an AVQueuePlayer, which is UIKit-adjacent enough that the whole thing
// is a UIViewRepresentable rather than anything in SwiftUI's vocabulary. The clip
// ships in the bundle; there is no network path here.

#if os(iOS)

import SwiftUI
import AVFoundation

struct LoopingVideoView: UIViewRepresentable {
    /// A resource in the app bundle, e.g. "onboarding-map" / "mp4".
    let resource: String
    let ext: String

    func makeUIView(context: Context) -> PlayerView {
        let view = PlayerView()
        guard let url = Bundle.main.url(forResource: resource, withExtension: ext) else {
            return view
        }
        let item = AVPlayerItem(url: url)
        let queue = AVQueuePlayer()
        queue.isMuted = true
        // Retain the looper on the coordinator; a dropped looper stops the loop.
        context.coordinator.looper = AVPlayerLooper(player: queue, templateItem: item)
        view.playerLayer.player = queue
        view.playerLayer.videoGravity = .resizeAspectFill
        queue.play()
        context.coordinator.player = queue
        return view
    }

    func updateUIView(_ uiView: PlayerView, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator {
        var player: AVQueuePlayer?
        var looper: AVPlayerLooper?
    }

    /// A UIView whose backing layer is the player layer, so it resizes cleanly.
    final class PlayerView: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    }
}

#endif
