// Run on macOS: xcrun swift desktop/icons/generate.swift
// If Command Line Tools and the SDK differ, use the installed Xcode toolchain:
// DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun swift desktop/icons/generate.swift
// Draws the same 64 × 64 vector as public/favicon.svg at every native size.
import AppKit
import Foundation

let directory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
let iconset = temporary.appendingPathComponent("Otto.iconset")
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: temporary) }

func render(_ size: Int) throws -> Data {
    guard let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
        isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
    ), let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
        throw NSError(domain: "OttoIcons", code: 1, userInfo: [NSLocalizedDescriptionKey: "Cannot create bitmap"])
    }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    context.shouldAntialias = true
    let scale = CGFloat(size) / 64
    let transform = AffineTransform(scale: scale)
    let background = NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: 64, height: 64), xRadius: 16, yRadius: 16)
    background.transform(using: transform)
    NSColor(deviceRed: 8 / 255, green: 102 / 255, blue: 1, alpha: 1).setFill()
    background.fill()
    let mark = NSBezierPath()
    mark.move(to: NSPoint(x: 32, y: 13))
    mark.line(to: NSPoint(x: 32, y: 51))
    mark.move(to: NSPoint(x: 14, y: 23))
    mark.line(to: NSPoint(x: 50, y: 41))
    mark.move(to: NSPoint(x: 14, y: 41))
    mark.line(to: NSPoint(x: 50, y: 23))
    mark.transform(using: transform)
    mark.lineWidth = 8 * scale
    mark.lineCapStyle = .butt
    NSColor.white.setStroke()
    mark.stroke()
    NSGraphicsContext.restoreGraphicsState()
    guard let png = bitmap.representation(using: .png, properties: [:]) else {
        throw NSError(domain: "OttoIcons", code: 2, userInfo: [NSLocalizedDescriptionKey: "Cannot encode PNG"])
    }
    return png
}

try render(1024).write(to: directory.appendingPathComponent("otto.png"))
for size in [16, 32, 128, 256, 512] {
    try render(size).write(to: iconset.appendingPathComponent("icon_\(size)x\(size).png"))
    try render(size * 2).write(to: iconset.appendingPathComponent("icon_\(size)x\(size)@2x.png"))
}

let iconutil = Process()
iconutil.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
iconutil.arguments = ["-c", "icns", iconset.path, "-o", directory.appendingPathComponent("otto.icns").path]
try iconutil.run()
iconutil.waitUntilExit()
guard iconutil.terminationStatus == 0 else {
    throw NSError(domain: "OttoIcons", code: 3, userInfo: [NSLocalizedDescriptionKey: "iconutil failed"])
}

// Windows Vista and later accept PNG-encoded ICO entries.
func appendLE<T: FixedWidthInteger>(_ value: T, to data: inout Data) {
    var littleEndian = value.littleEndian
    withUnsafeBytes(of: &littleEndian) { data.append(contentsOf: $0) }
}
let sizes = [16, 24, 32, 48, 64, 128, 256]
let images = try sizes.map(render)
var ico = Data()
appendLE(UInt16(0), to: &ico)
appendLE(UInt16(1), to: &ico)
appendLE(UInt16(sizes.count), to: &ico)
var offset = 6 + sizes.count * 16
for (size, png) in zip(sizes, images) {
    ico.append(contentsOf: [size == 256 ? 0 : UInt8(size), size == 256 ? 0 : UInt8(size), 0, 0])
    appendLE(UInt16(1), to: &ico)
    appendLE(UInt16(32), to: &ico)
    appendLE(UInt32(png.count), to: &ico)
    appendLE(UInt32(offset), to: &ico)
    offset += png.count
}
for png in images { ico.append(png) }
try ico.write(to: directory.appendingPathComponent("otto.ico"))
print("Generated otto.png (1024px), otto.icns, and otto.ico (7 sizes).")
