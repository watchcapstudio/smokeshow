import XCTest
@testable import SmokeshowKit

final class DeviceRegistryTests: XCTestCase {
    private var session: URLSession!
    private var credentials: MemoryCredentials!

    override func setUp() {
        super.setUp()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [RegistryURLProtocol.self]
        session = URLSession(configuration: configuration)
        credentials = MemoryCredentials()
        RegistryURLProtocol.requests = []
        RegistryURLProtocol.responses = []
    }

    override func tearDown() {
        session.invalidateAndCancel()
        RegistryURLProtocol.requests = []
        RegistryURLProtocol.responses = []
        super.tearDown()
    }

    func testFirstSyncRegistersAndStoresIssuedCredentials() async throws {
        RegistryURLProtocol.responses = [
            .init(status: 201, body: #"{"deviceId":"dev_server","deviceSecret":"secret_once"}"#)
        ]
        let client = makeClient()

        try await client.register(registration(token: "apns-token"))

        let request = try XCTUnwrap(RegistryURLProtocol.requests.first)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/v1/devices")
        let body = try XCTUnwrap(request.capturedBody)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(json["pushToken"] as? String, "apns-token")
        XCTAssertEqual(json["appUserId"] as? String, "local-revenuecat-id")
        XCTAssertEqual(json["timezone"] as? String, "America/Denver")
        let types = try XCTUnwrap(json["notificationTypes"] as? [String: Bool])
        XCTAssertEqual(types, ["inbound": true, "peak": true, "clear": true])
        XCTAssertNil(json["deviceId"])
        XCTAssertEqual(credentials.load(), .init(deviceId: "dev_server", deviceSecret: "secret_once"))
    }

    func testLaterSyncPatchesWithBearerCredential() async throws {
        credentials.save(.init(deviceId: "dev_server", deviceSecret: "secret_once"))
        RegistryURLProtocol.responses = [.init(status: 200, body: "{}")]

        try await makeClient().register(registration(token: "new-token"))

        let request = try XCTUnwrap(RegistryURLProtocol.requests.first)
        XCTAssertEqual(request.httpMethod, "PATCH")
        XCTAssertEqual(request.url?.path, "/v1/devices/dev_server")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer secret_once")
    }

    func testMissingServerRecordRecoversWithFreshRegistration() async throws {
        credentials.save(.init(deviceId: "dev_old", deviceSecret: "old_secret"))
        RegistryURLProtocol.responses = [
            .init(status: 404, body: "{}"),
            .init(status: 201, body: #"{"deviceId":"dev_new","deviceSecret":"new_secret"}"#),
        ]

        try await makeClient().register(registration(token: "apns-token"))

        XCTAssertEqual(RegistryURLProtocol.requests.map(\.httpMethod), ["PATCH", "POST"])
        XCTAssertEqual(credentials.load(), .init(deviceId: "dev_new", deviceSecret: "new_secret"))
    }

    func testDeregisterAuthenticatesThenForgetsLocalCredential() async throws {
        credentials.save(.init(deviceId: "dev_server", deviceSecret: "secret_once"))
        RegistryURLProtocol.responses = [.init(status: 200, body: "{}")]

        try await makeClient().deregister()

        let request = try XCTUnwrap(RegistryURLProtocol.requests.first)
        XCTAssertEqual(request.httpMethod, "DELETE")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer secret_once")
        XCTAssertNil(credentials.load())
    }

    private func makeClient() -> DeviceRegistryClient {
        DeviceRegistryClient(
            baseURL: URL(string: "https://notify.example")!,
            session: session,
            credentials: credentials
        )
    }

    private func registration(token: String?) -> DeviceRegistration {
        DeviceRegistration(
            platform: "ios",
            pushToken: token,
            appUserId: "local-revenuecat-id",
            locations: [.init(lat: 39.7, lon: -105.0, label: "Home")],
            quietHours: .init(enabled: true),
            sensitiveHousehold: false,
            timezone: "America/Denver"
        )
    }
}

private final class MemoryCredentials: DeviceRegistryCredentialStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var value: DeviceRegistryCredentials?

    func load() -> DeviceRegistryCredentials? {
        lock.withLock { value }
    }

    func save(_ credentials: DeviceRegistryCredentials) {
        lock.withLock { value = credentials }
    }

    func clear() {
        lock.withLock { value = nil }
    }
}

private final class RegistryURLProtocol: URLProtocol, @unchecked Sendable {
    struct Stub {
        let status: Int
        let body: String
    }

    static var requests: [URLRequest] = []
    static var responses: [Stub] = []
    private static let lock = NSLock()

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let stub = Self.lock.withLock { () -> Stub in
            var captured = request
            captured.capturedBody = request.httpBody ?? request.httpBodyStream.flatMap(Self.read)
            Self.requests.append(captured)
            return Self.responses.removeFirst()
        }
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: stub.status,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(stub.body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    private static func read(_ stream: InputStream) -> Data? {
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 1024)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            guard count > 0 else { break }
            data.append(buffer, count: count)
        }
        return data
    }
}

private extension URLRequest {
    private static let bodyKey = "DeviceRegistryTests.capturedBody"

    var capturedBody: Data? {
        get { URLProtocol.property(forKey: Self.bodyKey, in: self) as? Data }
        set {
            let mutable = (self as NSURLRequest).mutableCopy() as! NSMutableURLRequest
            URLProtocol.setProperty(newValue as Any, forKey: Self.bodyKey, in: mutable)
            self = mutable as URLRequest
        }
    }
}
