// The tip jar.
//
// Everything in Smokeshow is free. This screen is only ever opened on purpose,
// from Settings or a `smokeshow://support` link, and nothing elsewhere in the
// app changes based on what happens here except the app icon.
//
// The monthly option is the paid builds' subscription, renamed. App Review
// still wants price, period, and auto-renewal stated next to its button, and
// `Copy.Support.monthlyTerms` carries all three.

import SwiftUI
import SmokeshowKit

struct SupportView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var products: [SupportProduct] = SupportProduct.fallbacks
    @State private var purchasing: String?
    @State private var message: String?

    private var tips: [SupportProduct] { products.filter { $0.kind == .tip } }
    private var monthly: SupportProduct? { products.first { $0.kind == .monthly } }

    var body: some View {
        ZStack {
            Palette.dark.bg.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack {
                        Spacer()
                        Button("Done") { dismiss() }
                            .font(Typography.sm)
                            .opacity(0.6)
                    }

                    Text(Copy.Support.title)
                        .font(Typography.xl)

                    Text(Copy.Support.body)
                        .font(Typography.base)
                        .opacity(0.75)

                    if let line = statusLine {
                        Text(line)
                            .font(Typography.sm)
                            .fontWeight(.semibold)
                    }

                    section(Copy.Support.tipsHeading) {
                        HStack(spacing: 10) {
                            ForEach(tips) { tip in
                                tipButton(tip)
                            }
                        }
                        Text(Copy.Support.reward)
                            .font(Typography.xs)
                            .opacity(0.6)
                    }

                    if model.supportsAlternateIcons {
                        iconPicker
                    }

                    monthlySection

                    if let message {
                        Text(message).font(Typography.sm).opacity(0.8)
                    }

                    Text(Copy.Support.noAccounts)
                        .font(Typography.xs)
                        .opacity(0.5)

                    HStack(spacing: 16) {
                        Button(Copy.Support.restore) { Task { await model.restore() } }
                        Link("Terms", destination: Copy.Support.termsURL)
                        Link("Privacy", destination: Copy.Support.privacyURL)
                    }
                    .font(Typography.xs)
                    .opacity(0.6)
                }
                .padding(22)
            }
        }
        .foregroundStyle(Palette.dark.text)
        .task {
            products = await model.supportProducts()
        }
    }

    private var statusLine: String? {
        switch model.supporter.status {
        case .subscribed: return Copy.Support.subscribedLine
        case .tipped: return Copy.Support.tippedLine
        case .unknown, .notSupporting: return nil
        }
    }

    // MARK: Tips

    private func tipButton(_ tip: SupportProduct) -> some View {
        Button {
            buy(tip)
        } label: {
            VStack(spacing: 2) {
                if purchasing == tip.id {
                    ProgressView().tint(.black)
                } else {
                    Text(tip.localizedPrice)
                        .font(Typography.md)
                        .fontWeight(.semibold)
                    Text(tip.displayName)
                        .font(Typography.xs)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .opacity(0.7)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(
                RoundedRectangle(cornerRadius: Tokens.Radius.md)
                    .fill(Palette.dark.accent)
            )
            .foregroundStyle(Color.black)
        }
        .buttonStyle(.plain)
        .disabled(purchasing != nil)
    }

    // MARK: Icons

    private var iconPicker: some View {
        section(Copy.Support.iconsHeading) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 58), spacing: 12)], spacing: 12) {
                ForEach(SupporterIcon.allCases) { icon in
                    iconCell(icon)
                }
            }
            if !model.supporter.status.isSupporter {
                Text(Copy.Support.iconsLocked)
                    .font(Typography.xs)
                    .opacity(0.6)
            }
        }
    }

    private func iconCell(_ icon: SupporterIcon) -> some View {
        let locked = icon.requiresSupport && !model.supporter.status.isSupporter
        let selected = model.appIcon == icon
        return Button {
            Task { await model.setAppIcon(icon) }
        } label: {
            VStack(spacing: 4) {
                Image(icon.previewAssetName)
                    .resizable()
                    .aspectRatio(1, contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 13, style: .continuous)
                            .stroke(Palette.dark.accent, lineWidth: selected ? 2.5 : 0)
                    )
                    .overlay(alignment: .bottomTrailing) {
                        if locked {
                            Image(systemName: "lock.fill")
                                .font(.system(size: 11, weight: .semibold))
                                .padding(4)
                        }
                    }
                    .opacity(locked ? 0.45 : 1)
                Text(icon.displayName)
                    .font(.system(size: 10))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .opacity(0.7)
            }
        }
        .buttonStyle(.plain)
        .disabled(locked)
        .accessibilityLabel(Text(icon.displayName))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    // MARK: Monthly

    @ViewBuilder
    private var monthlySection: some View {
        if model.supporter.status.isSubscribed {
            section(Copy.Support.monthlyHeading) {
                Link(Copy.Support.manageSubscription, destination: StoreConfiguration.manageSubscriptionsURL)
                    .font(Typography.sm)
            }
        } else if let monthly {
            section(Copy.Support.monthlyHeading) {
                Button {
                    buy(monthly)
                } label: {
                    HStack {
                        Spacer()
                        if purchasing == monthly.id {
                            ProgressView()
                        } else {
                            Text("\(Copy.Support.monthlyButton) · \(monthly.localizedPrice)/month")
                                .font(Typography.sm)
                                .fontWeight(.semibold)
                        }
                        Spacer()
                    }
                    .padding(.vertical, 12)
                    .background(
                        RoundedRectangle(cornerRadius: Tokens.Radius.md)
                            .stroke(Palette.dark.accent, lineWidth: 1.5)
                    )
                }
                .buttonStyle(.plain)
                .disabled(purchasing != nil)

                Text(Copy.Support.monthlyTerms(price: monthly.localizedPrice, period: "month"))
                    .font(Typography.xs)
                    .opacity(0.6)
            }
        }
    }

    // MARK: Buying

    private func buy(_ product: SupportProduct) {
        Task {
            purchasing = product.id
            message = nil
            let outcome = await model.purchase(product)
            purchasing = nil
            switch outcome {
            case .some(.purchased): message = Copy.Support.thanks
            case .some(.pending): message = Copy.Support.pending
            case .some(.cancelled): message = nil
            case .none: message = Copy.Support.failed
            }
        }
    }

    private func section<Content: View>(
        _ title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased())
                .font(Typography.eyebrow)
                .opacity(0.5)
            content()
        }
    }
}

/// Shown once, at launch, to anyone whose subscription from the paid builds
/// is still active. They are still being billed and only they can cancel it,
/// so the app says so plainly and puts the way out one tap away.
struct FreeNoticeView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            Palette.dark.bg.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 18) {
                Text(Copy.Support.freeNoticeTitle)
                    .font(Typography.xl)
                Text(Copy.Support.freeNoticeBody)
                    .font(Typography.base)
                    .opacity(0.8)
                Spacer(minLength: 0)
                Button {
                    dismiss()
                } label: {
                    HStack {
                        Spacer()
                        Text(Copy.Support.freeNoticeKeep)
                            .font(Typography.md)
                            .fontWeight(.semibold)
                        Spacer()
                    }
                    .padding(.vertical, 14)
                    .background(
                        RoundedRectangle(cornerRadius: Tokens.Radius.md)
                            .fill(Palette.dark.accent)
                    )
                    .foregroundStyle(Color.black)
                }
                .buttonStyle(.plain)
                Link(destination: StoreConfiguration.manageSubscriptionsURL) {
                    HStack {
                        Spacer()
                        Text(Copy.Support.manageSubscription).font(Typography.sm)
                        Spacer()
                    }
                }
                .opacity(0.75)
            }
            .padding(22)
        }
        .foregroundStyle(Palette.dark.text)
        .presentationDetents([.medium])
    }
}
