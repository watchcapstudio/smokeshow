// Onboarding *is* widget installation.
//
// "The trial's job is to get a widget onto the home screen on day 0. A trial
// that never becomes a glance never converts — the product's value is ambient,
// and it can't be felt from inside the app." (platform plan §4.)
//
// So this screen is shown on the first session, not buried in settings, and it
// checks afterwards whether a widget actually appeared — WidgetKit will tell
// us, and that is the only honest measure of whether it worked.

import SwiftUI
import SmokeshowKit

struct WidgetOnboardingView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var installedCount = 0

    var body: some View {
        ZStack {
            Palette.dark.bg.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text(Copy.Onboarding.widgetTitle)
                        .font(Typography.xl)
                    Text(Copy.Onboarding.widgetBody)
                        .font(Typography.base)
                        .opacity(0.75)

                    WidgetShowcase()

                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(Array(Copy.Onboarding.widgetSteps.enumerated()), id: \.offset) { index, step in
                            HStack(alignment: .top, spacing: 10) {
                                Text("\(index + 1)")
                                    .font(Typography.sm)
                                    .fontWeight(.bold)
                                    .frame(width: 20, height: 20)
                                    .background(Circle().fill(Palette.dark.accent))
                                    .foregroundStyle(Color.black)
                                Text(step).font(Typography.base).opacity(0.85)
                            }
                        }
                    }

                    #if os(iOS)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(Copy.Onboarding.lockScreenTitle)
                            .font(Typography.md)
                        Text(Copy.Onboarding.lockScreenBody)
                            .font(Typography.sm)
                            .opacity(0.7)
                    }
                    #endif

                    if installedCount > 0 {
                        Label(
                            "\(installedCount) widget\(installedCount == 1 ? "" : "s") installed",
                            systemImage: "checkmark.circle.fill"
                        )
                        .font(Typography.sm)
                        .foregroundStyle(Color(Tokens.Color.Dark.allClear))
                    }

                    Button {
                        dismiss()
                    } label: {
                        HStack {
                            Spacer()
                            Text(installedCount > 0 ? "Done" : "I'll do it now")
                                .font(Typography.md)
                                .fontWeight(.semibold)
                            Spacer()
                        }
                        .padding(.vertical, 13)
                        .background(
                            RoundedRectangle(cornerRadius: Tokens.Radius.md)
                                .fill(Palette.dark.accent)
                        )
                        .foregroundStyle(Color.black)
                    }
                    .buttonStyle(.plain)
                }
                .padding(22)
            }
        }
        .foregroundStyle(Palette.dark.text)
        .task {
            installedCount = await model.installedWidgetCount()
            if installedCount > 0 { TrialInstrumentation.record(.widgetInstalled) }
        }
    }
}
