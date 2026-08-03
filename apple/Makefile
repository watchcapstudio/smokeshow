# Build entry points for the Apple apps.
#
#   make generate   XcodeGen → Smokeshow.xcodeproj
#   make test       swift test (SmokeshowKit, no Xcode project needed)
#   make tokens     regenerate Tokens.generated.swift from design/tokens.json
#   make fixtures   regenerate the mock payloads from src/lib/forecast.js
#   make sync       tokens + fixtures, the two generated inputs
#   make ios/mac    build the app for a simulator / for macOS

REPO_ROOT := $(shell cd .. && pwd)
SCHEME := Smokeshow
IOS_DESTINATION ?= platform=iOS Simulator,name=iPhone 16 Pro

.PHONY: generate test tokens fixtures sync ios mac watch clean

generate:
	@command -v xcodegen >/dev/null || { echo "xcodegen not found: brew install xcodegen"; exit 1; }
	xcodegen generate --spec project.yml

# The shared framework and all its tests build without the Xcode project, so
# CI can run them on any Swift toolchain.
test:
	swift test

tokens:
	cd $(REPO_ROOT) && node scripts/generate-apple-tokens.mjs

fixtures:
	cd $(REPO_ROOT) && node scripts/generate-apple-fixtures.mjs

sync: tokens fixtures

ios: generate
	xcodebuild -project Smokeshow.xcodeproj -scheme $(SCHEME) \
		-destination '$(IOS_DESTINATION)' build

mac: generate
	xcodebuild -project Smokeshow.xcodeproj -scheme $(SCHEME) \
		-destination 'platform=macOS' build

watch: generate
	xcodebuild -project Smokeshow.xcodeproj -scheme SmokeshowWatch \
		-destination 'platform=watchOS Simulator,name=Apple Watch Series 10 (46mm)' build

clean:
	rm -rf Smokeshow.xcodeproj .build
