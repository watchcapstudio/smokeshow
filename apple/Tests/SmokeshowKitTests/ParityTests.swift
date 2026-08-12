// Parity guards: the tests that fail when the Apple apps start drifting away
// from the web, the brief, or the contract.
//
// Three of them, one per way drift actually happens:
//   1. copy pasted into Swift and then edited (the disclaimer);
//   2. a colour or a size typed by hand instead of read from the tokens;
//   3. someone reimplementing the verdict maths "just for the widget".

import XCTest
@testable import SmokeshowKit

final class ParityTests: XCTestCase {

    /// apple/Tests/SmokeshowKitTests/ParityTests.swift → repository root.
    private var repositoryRoot: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // SmokeshowKitTests
            .deletingLastPathComponent() // Tests
            .deletingLastPathComponent() // apple
            .deletingLastPathComponent() // repo root
    }

    // MARK: 1 · The disclaimer ships verbatim

    func testDisclaimerMatchesTheBriefWordForWord() throws {
        // CLAUDE.md: "disclaimer and explainer copy in the brief ship verbatim".
        let briefURL = repositoryRoot.appendingPathComponent("docs/smokeshow-build-brief.md")
        let brief = try String(contentsOf: briefURL, encoding: .utf8)

        let paragraph = try XCTUnwrap(
            brief
                .components(separatedBy: "## Disclaimer copy (drop in as-is)")
                .dropFirst().first?
                .components(separatedBy: "\n---").first,
            "the brief no longer has a disclaimer section under that heading"
        )

        XCTAssertEqual(normalized(paragraph), normalized(Copy.disclaimer))
    }

    /// Markdown emphasis and line wrapping are formatting, not copy.
    private func normalized(_ text: String) -> String {
        text
            .replacingOccurrences(of: "**", with: "")
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }

    // MARK: 2 · Design tokens come from design/tokens.json

    func testGeneratedTokensMatchTheDesignSource() throws {
        let tokensURL = repositoryRoot.appendingPathComponent("design/tokens.json")
        let data = try Data(contentsOf: tokensURL)
        let json = try XCTUnwrap(
            JSONSerialization.jsonObject(with: data) as? [String: Any]
        )

        let colors = try XCTUnwrap(json["color"] as? [String: [String: String]])
        let dark = try XCTUnwrap(colors["dark"])

        XCTAssertEqual(hex(Tokens.Color.Dark.bg), dark["bg"])
        XCTAssertEqual(hex(Tokens.Color.Dark.text), dark["text"])
        XCTAssertEqual(hex(Tokens.Color.Dark.accent), dark["accent"])
        XCTAssertEqual(hex(Tokens.Color.Dark.allClear), dark["allClear"])
        XCTAssertEqual(hex(Tokens.Color.Dark.smokeshow), dark["smokeshow"])

        let typeScale = try XCTUnwrap(json["typeScale"] as? [String: String])
        // rem → points at a 16pt root, the conversion the generator applies.
        XCTAssertEqual(Tokens.TypeScale.display, rem(typeScale["display"]), accuracy: 0.01)
        XCTAssertEqual(Tokens.TypeScale.base, rem(typeScale["base"]), accuracy: 0.01)

        let motion = try XCTUnwrap(json["motion"] as? [String: [String: String]])
        let baseDuration = try XCTUnwrap(motion["base"]?["duration"])
        XCTAssertEqual(
            Tokens.Motion.base.duration,
            try XCTUnwrap(Double(baseDuration.replacingOccurrences(of: "s", with: ""))),
            accuracy: 0.001
        )
    }

    private func hex(_ token: Tokens.TokenColor) -> String {
        String(format: "#%06x", token.hex)
    }

    private func rem(_ value: String?) -> CGFloat {
        CGFloat(Double(value?.replacingOccurrences(of: "rem", with: "") ?? "0") ?? 0) * 16
    }

    // MARK: 3 · No client-side verdict maths

    /// The rating ladder lives in `scale[]`, the clear-time in `verdict`, and
    /// the trend in `hours[].trend`. A Swift file that hardcodes 35 µg/m³, the
    /// 6-hour hold, or a level boundary has started the drift this whole
    /// architecture exists to prevent (contract §6).
    func testNoSourceFileReimplementsTheThresholds() throws {
        let sourcesRoot = repositoryRoot.appendingPathComponent("apple/Sources")
        let forbidden = [
            "35",   // the "Hazy" threshold
            "12.1", // the AQI breakpoint table
            "55.4",
            "150.4",
        ]
        // Display scales that legitimately carry numbers, and the one file
        // allowed to name the contract's own constants in prose.
        let allowedFiles: Set<String> = [
            "Tokens.generated.swift",
        ]

        let enumerator = try XCTUnwrap(
            FileManager.default.enumerator(at: sourcesRoot, includingPropertiesForKeys: nil)
        )

        for case let url as URL in enumerator where url.pathExtension == "swift" {
            guard !allowedFiles.contains(url.lastPathComponent) else { continue }
            let text = try String(contentsOf: url, encoding: .utf8)

            for (number, line) in text.split(separator: "\n", omittingEmptySubsequences: false)
                .enumerated()
                .map({ ($0.offset + 1, String($0.element)) }) {

                // Comments quote the contract constantly; that is documentation,
                // not arithmetic.
                let code = line.components(separatedBy: "//").first ?? line
                for needle in forbidden where containsNumber(code, needle) {
                    XCTFail("""
                        \(url.lastPathComponent):\(number) contains the literal \(needle) in code. \
                        Thresholds are server-side: read scale[], verdict, or hours[].levelIndex.
                        """)
                }
            }
        }
    }

    /// Matches the number as a standalone literal, so `350` and `1.35` do not
    /// trip the guard.
    private func containsNumber(_ code: String, _ needle: String) -> Bool {
        guard let regex = try? NSRegularExpression(
            pattern: "(?<![0-9.])\(NSRegularExpression.escapedPattern(for: needle))(?![0-9.])"
        ) else { return false }
        return regex.firstMatch(in: code, range: NSRange(code.startIndex..., in: code)) != nil
    }
}
