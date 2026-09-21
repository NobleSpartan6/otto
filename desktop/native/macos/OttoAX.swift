import AppKit
import ApplicationServices
import Foundation

struct HelperError: Error { let message: String }

@MainActor
final class OttoAX {
    struct Target {
        let element: AXUIElement
        let pid: pid_t
        let role: String
        let label: String
        let actions: [String]
        let value: String
    }
    var allowed: [String: NSRunningApplication] = [:]
    var targets: [String: Target] = [:]
    var windowIdentities: [String: (element: AXUIElement, token: String)] = [:]
    var controlIdentities: [String: (windowToken: String, elements: [(element: AXUIElement, token: String)])] = [:]
    var documentIdentities: [String: (windowToken: String, value: String, token: String)] = [:]
    var snapshotId = ""
    var snapshotTime = Date.distantPast
    var snapshotApp = ""
    var snapshotWindow: AXUIElement?
    var snapshotBounds: [String: CGFloat]?
    var snapshotImage: String?
    var screenshotSize: [String: Int]?
    var snapshotWindowID: Int?
    var protectedBounds: [[String: CGFloat]] = []
    let parentPID = pid_t(ProcessInfo.processInfo.environment["OTTO_PARENT_PID"] ?? "0") ?? 0
    let deniedBundles = Set(["com.apple.systempreferences", "com.apple.SecurityAgent", "com.apple.loginwindow", "com.apple.keychainaccess"])

    func permissions() -> [String: Any] {
        ["accessibility": AXIsProcessTrusted(), "screenCapture": CGPreflightScreenCaptureAccess(), "platform": "darwin"]
    }
    func eligible(_ app: NSRunningApplication) -> Bool {
        app.activationPolicy == .regular && !app.isTerminated && app.processIdentifier != parentPID &&
        !deniedBundles.contains(app.bundleIdentifier ?? "") && app.bundleIdentifier != "ai.otto.desktop"
    }
    func appInfo(_ app: NSRunningApplication) -> [String: Any] {
        ["id": String(app.processIdentifier), "pid": app.processIdentifier, "name": app.localizedName ?? "Application"]
    }
    func invalidate() { snapshotId = ""; targets.removeAll(); snapshotWindow = nil; snapshotBounds = nil; snapshotImage = nil; screenshotSize = nil; snapshotWindowID = nil; protectedBounds = [] }
    func app(_ id: String) throws -> NSRunningApplication {
        guard let app = allowed[id], eligible(app),
              NSRunningApplication(processIdentifier: app.processIdentifier)?.launchDate == app.launchDate else {
            throw HelperError(message: "The selected app closed or changed. Select it again.")
        }
        return app
    }
    func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
        var result: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, name as CFString, &result) == .success else { return nil }
        return result
    }
    func string(_ element: AXUIElement, _ name: String) -> String { attribute(element, name) as? String ?? "" }
    func nativeActions(_ element: AXUIElement) -> [String] {
        var values: CFArray?
        guard AXUIElementCopyActionNames(element, &values) == .success else { return [] }
        return values as? [String] ?? []
    }
    func isSensitive(_ element: AXUIElement) -> Bool {
        let role = string(element, kAXRoleAttribute)
        let subrole = string(element, kAXSubroleAttribute)
        let description = [kAXTitleAttribute, kAXDescriptionAttribute, "AXPlaceholderValue"].map { string(element, $0) }.joined(separator: " ")
        return role == "AXSecureTextField" || subrole == "AXSecureTextField" ||
            description.range(of: "password|passcode|one.time code|verification code|security code|cvv|credit card|api key|private key|recovery phrase", options: .regularExpression.union(.caseInsensitive)) != nil
    }
    func label(_ element: AXUIElement) -> String {
        for name in [kAXTitleAttribute, kAXDescriptionAttribute, kAXHelpAttribute, "AXPlaceholderValue"] {
            let value = string(element, name)
            if !value.isEmpty { return String(value.prefix(240)) }
        }
        return string(element, kAXRoleAttribute)
    }
    func bounds(_ element: AXUIElement) -> [String: CGFloat]? {
        guard let p = attribute(element, kAXPositionAttribute), CFGetTypeID(p) == AXValueGetTypeID(),
              let s = attribute(element, kAXSizeAttribute), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
        var point = CGPoint.zero
        var size = CGSize.zero
        guard AXValueGetValue(p as! AXValue, .cgPoint, &point), AXValueGetValue(s as! AXValue, .cgSize, &size) else { return nil }
        return ["x": point.x, "y": point.y, "width": size.width, "height": size.height]
    }
    func capabilities(_ element: AXUIElement) -> [String] {
        if isSensitive(element) { return [] }
        let actual = nativeActions(element)
        var result: [String] = []
        if actual.contains(kAXPressAction) { result.append("press") }
        let role = string(element, kAXRoleAttribute)
        var settable = DarwinBoolean(false)
        if ["AXTextField", "AXTextArea", "AXComboBox"].contains(role),
           AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable) == .success,
           settable.boolValue { result.append("fill") }
        if actual.contains("AXScrollUp") { result.append("scrollUp") }
        if actual.contains("AXScrollDown") { result.append("scrollDown") }
        return result
    }
    func selectedWindow(_ app: NSRunningApplication) throws -> AXUIElement {
        let root = AXUIElementCreateApplication(app.processIdentifier)
        if let focused = attribute(root, kAXFocusedWindowAttribute), CFGetTypeID(focused) == AXUIElementGetTypeID() {
            return focused as! AXUIElement
        }
        if let windows = attribute(root, kAXWindowsAttribute) as? [AXUIElement], let first = windows.first { return first }
        throw HelperError(message: "The app has no accessible window. Open a window, then try again.")
    }
    func screenshot(_ app: NSRunningApplication, window: AXUIElement) -> String? {
        guard CGPreflightScreenCaptureAccess(), let info = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return nil }
        guard let expected = bounds(window) else { return nil }
        let candidates = info.filter { candidate in
            guard (candidate[kCGWindowOwnerPID as String] as? Int) == Int(app.processIdentifier), (candidate[kCGWindowLayer as String] as? Int) == 0,
                  let raw = candidate[kCGWindowBounds as String] as? NSDictionary, let frame = CGRect(dictionaryRepresentation: raw) else { return false }
            return abs(frame.minX - (expected["x"] ?? 0)) < 2 && abs(frame.minY - (expected["y"] ?? 0)) < 2 &&
                abs(frame.width - (expected["width"] ?? 0)) < 2 && abs(frame.height - (expected["height"] ?? 0)) < 2 &&
                (snapshotWindowID == nil || (candidate[kCGWindowNumber as String] as? Int) == snapshotWindowID)
        }
        guard candidates.count == 1, let windowID = candidates[0][kCGWindowNumber as String] as? Int else { return nil }
        snapshotWindowID = windowID
        let directory = ProcessInfo.processInfo.environment["OTTO_CAPTURE_DIR"].map { URL(fileURLWithPath: $0, isDirectory: true) } ?? FileManager.default.temporaryDirectory
        let file = directory.appendingPathComponent("otto-\(UUID().uuidString).jpg")
        defer { try? FileManager.default.removeItem(at: file) }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        process.arguments = ["-x", "-o", "-l", String(windowID), "-t", "jpg", file.path]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do { try process.run(); process.waitUntilExit() } catch { return nil }
        guard process.terminationStatus == 0, let image = NSImage(contentsOf: file) else { return nil }
        let scale = min(1, 1440 / max(1, image.size.width))
        let size = NSSize(width: image.size.width * scale, height: image.size.height * scale)
        guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size.width), pixelsHigh: Int(size.height), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
              let graphics = NSGraphicsContext(bitmapImageRep: bitmap) else { return nil }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = graphics
        image.draw(in: NSRect(origin: .zero, size: size))
        NSColor.black.setFill()
        for field in protectedBounds {
            let x = ((field["x"] ?? 0) - (expected["x"] ?? 0)) / (expected["width"] ?? 1) * size.width
            let y = ((field["y"] ?? 0) - (expected["y"] ?? 0)) / (expected["height"] ?? 1) * size.height
            let w = (field["width"] ?? 0) / (expected["width"] ?? 1) * size.width
            let h = (field["height"] ?? 0) / (expected["height"] ?? 1) * size.height
            NSRect(x: x, y: size.height - y - h, width: w, height: h).fill()
        }
        NSGraphicsContext.restoreGraphicsState()
        guard let data = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.65]) else { return nil }
        screenshotSize = ["width": Int(size.width), "height": Int(size.height)]
        return "data:image/jpeg;base64," + data.base64EncodedString()
    }
    func observe(_ id: String) throws -> [String: Any] {
        guard AXIsProcessTrusted() else { throw HelperError(message: "Enable Accessibility permission for Otto in System Settings.") }
        let selected = try app(id)
        let window = try selectedWindow(selected)
        let windowToken: String
        if let previous = windowIdentities[id], CFEqual(previous.element, window) {
            windowToken = previous.token
        } else {
            windowToken = UUID().uuidString
            windowIdentities[id] = (element: window, token: windowToken)
        }
        let previousControls = controlIdentities[id]?.windowToken == windowToken ? controlIdentities[id]!.elements : []
        var nextControls: [(element: AXUIElement, token: String)] = []
        let document = string(window, kAXDocumentAttribute)
        if document.isEmpty { documentIdentities.removeValue(forKey: id) }
        else if documentIdentities[id]?.windowToken != windowToken || documentIdentities[id]?.value != document {
            documentIdentities[id] = (windowToken: windowToken, value: document, token: UUID().uuidString)
        }
        invalidate()
        snapshotId = UUID().uuidString
        snapshotTime = Date()
        snapshotApp = id
        snapshotWindow = window
        snapshotBounds = bounds(window)
        var controls: [[String: Any]] = []
        var text: [String] = []
        var visited: [CFHashCode: [AXUIElement]] = [:]
        var count = 0
        var partialCoverage = false
        func children(_ element: AXUIElement) -> [AXUIElement] {
            var value: CFTypeRef?
            let status = AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &value)
            if status == .noValue || status == .attributeUnsupported { return [] }
            guard status == .success, let result = value as? [AXUIElement] else {
                partialCoverage = true
                return []
            }
            return result
        }
        func visit(_ element: AXUIElement, depth: Int) {
            guard depth < 18, count < 1200, controls.count < 180 else { partialCoverage = true; return }
            let hash = CFHash(element)
            for previous in visited[hash] ?? [] {
                if CFEqual(previous, element) { return }
            }
            visited[hash, default: []].append(element)
            count += 1
            let role = string(element, kAXRoleAttribute)
            if role.isEmpty { partialCoverage = true }
            // Closed menu trees can expose off-screen items and recent-document
            // labels. Only collect menu controls that are currently visible.
            if ["AXMenu", "AXMenuItem", "AXMenuBarItem"].contains(role) {
                guard (attribute(element, "AXHidden") as? Bool) != true,
                      let rect = bounds(element), rect.values.allSatisfy({ $0.isFinite }),
                      (rect["width"] ?? 0) > 0, (rect["height"] ?? 0) > 0 else { return }
            }
            if isSensitive(element) {
                if let rect = bounds(element) { protectedBounds.append(rect) }
                return
            }
            let label = label(element)
            let value = String(string(element, kAXValueAttribute).prefix(2001))
            if !label.isEmpty && label != role { text.append(label) }
            if !value.isEmpty && value != label { text.append(value) }
            let actions = capabilities(element)
            let enabled = (attribute(element, kAXEnabledAttribute) as? Bool) ?? true
            if !actions.isEmpty && enabled {
                let targetId = "control-\(controls.count)"
                let identity = previousControls.first(where: { CFEqual($0.element, element) })?.token ?? UUID().uuidString
                nextControls.append((element: element, token: identity))
                targets[targetId] = Target(element: element, pid: selected.processIdentifier, role: role, label: label, actions: actions, value: string(element, kAXValueAttribute))
                var control: [String: Any] = ["id": targetId, "identity": identity, "role": role, "label": label, "value": value, "enabled": true,
                    "actions": actions, "editable": actions.contains("fill"), "sensitive": false, "source": "accessibility"]
                if let b = bounds(element) { control["bounds"] = b }
                controls.append(control)
            }
            for child in children(element) { visit(child, depth: depth + 1) }
        }
        visit(window, depth: 0)
        // The first standard menu is the global Apple menu, not selected-app
        // context. Never visit it or its system-wide recent-items descendants.
        let appRoot = AXUIElementCreateApplication(selected.processIdentifier)
        var menu: CFTypeRef?
        let menuStatus = AXUIElementCopyAttributeValue(appRoot, kAXMenuBarAttribute as CFString, &menu)
        if menuStatus == .success {
            if let menu = menu, CFGetTypeID(menu) == AXUIElementGetTypeID() {
                for item in children(menu as! AXUIElement).dropFirst() { visit(item, depth: 0) }
            } else { partialCoverage = true }
        } else if menuStatus != .noValue && menuStatus != .attributeUnsupported {
            partialCoverage = true
        }
        controlIdentities[id] = (windowToken: windowToken, elements: nextControls)
        var result: [String: Any] = ["controlCoverage": partialCoverage ? "partial" : "complete", "snapshotId": snapshotId, "windowToken": windowToken, "app": appInfo(selected), "title": string(window, kAXTitleAttribute),
            "text": String(text.joined(separator: "\n").prefix(16000)), "controls": controls,
            "capturedAt": ISO8601DateFormatter().string(from: snapshotTime)]
        if let documentIdentity = documentIdentities[id] { result["documentToken"] = documentIdentity.token }
        if let image = screenshot(selected, window: window) {
            snapshotImage = image
            result["screenshot"] = image
            result["screenshotSize"] = screenshotSize
            result["windowBounds"] = snapshotBounds
            result["protectedBounds"] = protectedBounds
        }
        return result
    }
    func imagePatch(_ image: String, point: CGPoint, rect: [String: CGFloat]) -> [UInt8]? {
        guard let encoded = image.split(separator: ",", maxSplits: 1).last, let data = Data(base64Encoded: String(encoded)),
              let bitmap = NSBitmapImageRep(data: data), let source = bitmap.cgImage,
              let width = rect["width"], let height = rect["height"], width > 0, height > 0 else { return nil }
        let px = (point.x - (rect["x"] ?? 0)) / width * CGFloat(source.width)
        let py = (point.y - (rect["y"] ?? 0)) / height * CGFloat(source.height)
        let area = CGRect(x: max(0, px - 25), y: max(0, py - 12), width: 50, height: 24)
        guard let cropped = source.cropping(to: area) else { return nil }
        var pixels = [UInt8](repeating: 0, count: 16 * 8)
        guard let context = CGContext(data: &pixels, width: 16, height: 8, bitsPerComponent: 8, bytesPerRow: 16,
                                      space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return nil }
        context.draw(cropped, in: CGRect(x: 0, y: 0, width: 16, height: 8))
        return pixels
    }
    func click(_ selected: NSRunningApplication, action: [String: Any]) throws -> [String: Any] {
        let modifiers: CGEventFlags = [.maskShift, .maskControl, .maskAlternate, .maskCommand]
        guard CGEventSource.flagsState(.combinedSessionState).intersection(modifiers).isEmpty else {
            throw HelperError(message: "Release modifier keys before approving native input.")
        }
        guard let position = action["point"] as? [String: Double], let x = position["x"], let y = position["y"], x.isFinite, y.isFinite,
              let oldRect = snapshotBounds, let image = snapshotImage, let oldWindow = snapshotWindow,
              CFEqual(try selectedWindow(selected), oldWindow), bounds(oldWindow) == oldRect,
              let left = oldRect["x"], let top = oldRect["y"], let width = oldRect["width"], let height = oldRect["height"],
              x >= left, y >= top, x < left + width, y < top + height else { throw HelperError(message: "The OCR target changed. Observe the app again.") }
        let point = CGPoint(x: x, y: y)
        guard selected.activate(options: []) else { throw HelperError(message: "Could not activate the selected app.") }
        let deadline = Date().addingTimeInterval(0.6)
        while NSWorkspace.shared.frontmostApplication?.processIdentifier != selected.processIdentifier && Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.02))
        }
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier == selected.processIdentifier,
              bounds(oldWindow) == oldRect,
              let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
            throw HelperError(message: "App focus changed. Observe the app again.")
        }
        let hit = windows.first { info in
            guard (info[kCGWindowLayer as String] as? Int) == 0,
                  let raw = info[kCGWindowBounds as String] as? NSDictionary,
                  let frame = CGRect(dictionaryRepresentation: raw) else { return false }
            return frame.contains(point)
        }
        guard (hit?[kCGWindowOwnerPID as String] as? Int) == Int(selected.processIdentifier),
              (hit?[kCGWindowNumber as String] as? Int) == snapshotWindowID,
              let fresh = screenshot(selected, window: oldWindow),
              let before = imagePatch(image, point: point, rect: oldRect), let after = imagePatch(fresh, point: point, rect: oldRect) else {
            throw HelperError(message: "The OCR target is obscured or unavailable.")
        }
        let difference = zip(before, after).reduce(0) { $0 + abs(Int($1.0) - Int($1.1)) } / before.count
        guard difference < 12 else { throw HelperError(message: "The text under this OCR target changed. Observe again.") }
        guard CGEventSource.flagsState(.combinedSessionState).intersection(modifiers).isEmpty else { throw HelperError(message: "Release modifier keys before clicking.") }
        guard let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left),
              let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left) else {
            throw HelperError(message: "Could not create native input.")
        }
        invalidate()
        down.flags = []; up.flags = []
        down.post(tap: .cghidEventTap); up.post(tap: .cghidEventTap)
        return [:]
    }
    func act(_ action: [String: Any]) throws -> [String: Any] {
        guard let requested = action["snapshotId"] as? String, requested == snapshotId, !snapshotId.isEmpty,
              Date().timeIntervalSince(snapshotTime) < 30 else { throw HelperError(message: "The observation expired. Observe the app again.") }
        guard let appId = action["appId"] as? String, let kind = action["kind"] as? String else { throw HelperError(message: "Invalid action.") }
        let selected = try app(appId)
        if kind == "key" {
            let modifiers: CGEventFlags = [.maskShift, .maskControl, .maskAlternate, .maskCommand]
            guard CGEventSource.flagsState(.combinedSessionState).intersection(modifiers).isEmpty else {
                throw HelperError(message: "Release modifier keys before approving native input.")
            }
            let keys: [String: CGKeyCode] = ["enter": 36, "tab": 48, "escape": 53]
            guard appId == snapshotApp, let value = action["value"] as? String, let code = keys[value],
                  let oldWindow = snapshotWindow, CFEqual(try selectedWindow(selected), oldWindow) else {
                throw HelperError(message: "The keyboard target changed. Observe again.")
            }
            guard selected.activate(options: []) else { throw HelperError(message: "Could not activate the selected app.") }
            let deadline = Date().addingTimeInterval(0.6)
            while NSWorkspace.shared.frontmostApplication?.processIdentifier != selected.processIdentifier && Date() < deadline {
                RunLoop.current.run(until: Date().addingTimeInterval(0.02))
            }
            guard NSWorkspace.shared.frontmostApplication?.processIdentifier == selected.processIdentifier,
                  CFEqual(try selectedWindow(selected), oldWindow),
                  CGEventSource.flagsState(.combinedSessionState).intersection(modifiers).isEmpty,
                  let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true),
                  let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false) else {
                throw HelperError(message: "Could not verify the keyboard target.")
            }
            down.flags = []; up.flags = []
            invalidate(); down.post(tap: .cghidEventTap); up.post(tap: .cghidEventTap)
            return [:]
        }
        if kind == "click" {
            guard appId == snapshotApp else { throw HelperError(message: "The OCR target is outside the selected app.") }
            return try click(selected, action: action)
        }
        if kind == "activate" {
            invalidate()
            guard selected.activate(options: []) else { throw HelperError(message: "Could not activate the selected app.") }
            return [:]
        }
        guard appId == snapshotApp, let targetId = action["targetId"] as? String, let target = targets[targetId],
              target.pid == selected.processIdentifier, !isSensitive(target.element),
              string(target.element, kAXRoleAttribute) == target.role, label(target.element) == target.label,
              string(target.element, kAXValueAttribute) == target.value,
              ((attribute(target.element, kAXEnabledAttribute) as? Bool) ?? false),
              let oldWindow = snapshotWindow, CFEqual(try selectedWindow(selected), oldWindow) else {
            throw HelperError(message: "The selected control changed. Observe the app again.")
        }
        var actualPID: pid_t = 0
        guard AXUIElementGetPid(target.element, &actualPID) == .success, actualPID == selected.processIdentifier else {
            throw HelperError(message: "The control process changed. Observe again.")
        }
        let requestedAction = action["nativeAction"] as? String ?? kind
        guard target.actions.contains(requestedAction), capabilities(target.element).contains(requestedAction) else { throw HelperError(message: "That native action is unavailable.") }
        let actual: String
        switch (kind, requestedAction) {
        case ("press", "press"): actual = kAXPressAction
        case ("fill", "fill"): actual = "fill"
        case ("scroll", "scrollUp"): actual = "AXScrollUp"
        case ("scroll", "scrollDown"): actual = "AXScrollDown"
        default: throw HelperError(message: "Unsupported action.")
        }
        let value = action["value"] as? String ?? ""
        guard value.count <= 2000 else { throw HelperError(message: "Text is too long.") }
        // Consume before dispatch: AX errors may be ambiguous, and must never be retried.
        invalidate()
        guard selected.activate(options: []) else { throw HelperError(message: "Could not activate the selected app.") }
        let result: AXError = actual == "fill"
            ? AXUIElementSetAttributeValue(target.element, kAXValueAttribute as CFString, value as CFString)
            : AXUIElementPerformAction(target.element, actual as CFString)
        guard result == .success else { throw HelperError(message: "The app did not confirm the action. Inspect the app before trying again.") }
        return [:]
    }
    func handle(_ request: [String: Any]) throws -> Any {
        switch request["op"] as? String {
        case "permissions": return permissions()
        case "requestPermission":
            if request["kind"] as? String == "accessibility" {
                let options = ["AXTrustedCheckOptionPrompt": true] as CFDictionary
                _ = AXIsProcessTrustedWithOptions(options)
            } else if request["kind"] as? String == "screenCapture" { _ = CGRequestScreenCaptureAccess() }
            else { throw HelperError(message: "Unknown permission.") }
            return permissions()
        case "apps": return ["apps": NSWorkspace.shared.runningApplications.filter(eligible).map(appInfo), "permissions": permissions()]
        case "configure":
            allowed = [:]; windowIdentities.removeAll(); controlIdentities.removeAll(); documentIdentities.removeAll(); invalidate()
            guard let ids = request["appIds"] as? [String], ids.count <= 4 else { throw HelperError(message: "Select up to four apps.") }
            let running = NSWorkspace.shared.runningApplications.filter(eligible)
            var next: [String: NSRunningApplication] = [:]
            for id in ids {
                guard let found = running.first(where: { String($0.processIdentifier) == id }) else { throw HelperError(message: "Selected app is unavailable.") }
                next[id] = found
            }
            allowed = next; invalidate(); return [:]
        case "observe": return try observe(request["appId"] as? String ?? "")
        case "act": return try act(request["action"] as? [String: Any] ?? [:])
        default: throw HelperError(message: "Unknown operation.")
        }
    }
}

@main
struct Main {
    @MainActor static func main() {
        let helper = OttoAX()
        while let line = readLine() {
            var id = ""
            let reply: [String: Any]
            do {
                guard line.utf8.count <= 16000, let data = line.data(using: .utf8),
                      let input = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let requestId = input["id"] as? String else { throw HelperError(message: "Invalid request.") }
                id = requestId
                reply = ["id": id, "ok": true, "result": try helper.handle(input)]
            } catch let error as HelperError { reply = ["id": id, "ok": false, "error": error.message] }
            catch { reply = ["id": id, "ok": false, "error": "Native helper failed."] }
            if let data = try? JSONSerialization.data(withJSONObject: reply, options: [.sortedKeys]), let output = String(data: data, encoding: .utf8) {
                print(output); fflush(stdout)
            }
        }
    }
}
