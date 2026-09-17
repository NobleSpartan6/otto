import AppKit
import Foundation

// Disposable test surface: these controls have no file, network, or other-app effects.
@MainActor
final class OCRLabel: NSView {
    override func draw(_ dirtyRect: NSRect) {
        NSColor.white.setFill()
        bounds.fill()
        ("OCR Geometry Sample" as NSString).draw(at: NSPoint(x: 12, y: 16), withAttributes: [
            .font: NSFont.systemFont(ofSize: 22), .foregroundColor: NSColor.black
        ])
    }
}

@MainActor
final class Fixture: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private let input = NSTextField(string: "Initial fixture text")
    private let status = NSTextField(labelWithString: "Ready")

    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 240, y: 240, width: 560, height: 320),
                          styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "Otto Native Smoke Fixture"
        window.isReleasedWhenClosed = false
        guard let content = window.contentView else { return }
        let heading = NSTextField(labelWithString: "Disposable native-control test")
        heading.frame = NSRect(x: 24, y: 266, width: 500, height: 26)
        content.addSubview(heading)
        input.frame = NSRect(x: 24, y: 217, width: 500, height: 30)
        input.setAccessibilityIdentifier("otto-smoke-input")
        input.setAccessibilityLabel("Fixture text input")
        content.addSubview(input)
        let apply = NSButton(title: "Apply fixture text", target: self, action: #selector(applyText))
        apply.frame = NSRect(x: 24, y: 165, width: 220, height: 34)
        apply.bezelStyle = .rounded
        apply.setAccessibilityIdentifier("otto-smoke-apply")
        content.addSubview(apply)
        status.frame = NSRect(x: 24, y: 130, width: 500, height: 25)
        status.setAccessibilityIdentifier("otto-smoke-status")
        content.addSubview(status)
        let paintedLabel = OCRLabel(frame: NSRect(x: 24, y: 65, width: 500, height: 56))
        paintedLabel.setAccessibilityElement(false)
        content.addSubview(paintedLabel)
        let close = NSButton(title: "Close fixture", target: self, action: #selector(closeFixture))
        close.frame = NSRect(x: 340, y: 18, width: 180, height: 32)
        close.bezelStyle = .rounded
        close.setAccessibilityIdentifier("otto-smoke-close")
        content.addSubview(close)
        window.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
        FileHandle.standardOutput.write(Data("READY\n".utf8))
    }

    @objc private func applyText() { status.stringValue = "Applied: " + input.stringValue }
    @objc private func closeFixture() { window.close(); NSApplication.shared.terminate(nil) }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

@main
struct Main {
    @MainActor static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.regular)
        let delegate = Fixture()
        app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}
