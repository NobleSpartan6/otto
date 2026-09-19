import Foundation
import AVFoundation
@preconcurrency import Speech

@MainActor
final class Dictation {
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var recognition: SFSpeechRecognitionTask?
    private var transcript = ""
    private var finished = false
    private var stopping = false
    private var tapped = false

    private func emit(_ value: [String: String]) {
        guard let data = try? JSONSerialization.data(withJSONObject: value) else { return }
        FileHandle.standardOutput.write(data + Data([10]))
    }

    func finish(error: String? = nil, cancelled: Bool = false) {
        guard !finished else { return }
        finished = true
        engine.stop()
        if tapped { engine.inputNode.removeTap(onBus: 0); tapped = false }
        request?.endAudio()
        recognition?.cancel()
        if let error { emit(["event": "error", "message": error]) }
        else { emit(["event": "result", "text": cancelled ? "" : transcript]) }
        exit(error == nil ? 0 : 1)
    }

    func stop() {
        guard !finished, !stopping else { return }
        stopping = true
        // Permission callbacks may resume later. Exit before they can start input.
        guard request != nil else { finish(cancelled: true); return }
        engine.stop()
        if tapped { engine.inputNode.removeTap(onBus: 0); tapped = false }
        request?.endAudio()
        Task { try? await Task.sleep(for: .seconds(3)); if !self.finished { self.finish() } }
    }

    func start() async {
        guard !finished, !stopping else { return }
        guard let recognizer = SFSpeechRecognizer(locale: Locale.current), recognizer.supportsOnDeviceRecognition else {
            finish(error: "On-device dictation is unavailable for this Mac or language. Enable Dictation in System Settings or type your task.")
            return
        }
        let microphone = await AVCaptureDevice.requestAccess(for: .audio)
        guard !finished, !stopping else { return }
        guard microphone else { finish(error: "Allow Otto microphone access in System Settings to use dictation."); return }
        let speech = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
        }
        guard !finished, !stopping else { return }
        guard speech == .authorized else { finish(error: "Allow Otto speech recognition in System Settings to use dictation."); return }
        guard recognizer.isAvailable else { finish(error: "The local speech recognizer is unavailable. Try again or type your task."); return }
        let audioRequest = SFSpeechAudioBufferRecognitionRequest()
        audioRequest.requiresOnDeviceRecognition = true
        audioRequest.shouldReportPartialResults = true
        request = audioRequest
        recognition = recognizer.recognitionTask(with: audioRequest) { @Sendable result, error in
            let text = result?.bestTranscription.formattedString
            let isFinal = result?.isFinal ?? false
            let failed = error != nil
            Task { @MainActor in
                guard !self.finished else { return }
                if let text {
                    guard text.utf16.count <= 4000 else { self.finish(error: "Dictation is too long. Try a shorter task."); return }
                    self.transcript = text
                }
                if isFinal { self.finish() }
                else if failed {
                    if self.stopping && !self.transcript.isEmpty { self.finish() }
                    else { self.finish(error: "Local speech recognition failed. Check that Dictation is enabled for your language, or type your task.") }
                }
            }
        }
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { finish(error: "No microphone is available. Connect one or type your task."); return }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { @Sendable buffer, _ in audioRequest.append(buffer) }
        tapped = true
        do { engine.prepare(); try engine.start() }
        catch { finish(error: "The microphone could not start. Check your input device and permissions."); return }
        emit(["event": "listening"])
        Task { try? await Task.sleep(for: .seconds(40)); self.stop() }
    }
}

@main
struct VoiceMain {
    @MainActor static func main() async {
        if CommandLine.arguments.contains("--check") {
            let recognizer = SFSpeechRecognizer(locale: Locale.current)
            let status: [String: Any] = ["locale": Locale.current.identifier,
                "onDeviceSupported": recognizer?.supportsOnDeviceRecognition ?? false,
                "recognizerAvailable": recognizer?.isAvailable ?? false,
                "microphoneAuthorization": AVCaptureDevice.authorizationStatus(for: .audio).rawValue,
                "speechAuthorization": SFSpeechRecognizer.authorizationStatus().rawValue]
            if let data = try? JSONSerialization.data(withJSONObject: status) {
                FileHandle.standardOutput.write(data + Data([10]))
            }
            return
        }
        let session = Dictation()
        Task.detached {
            while let command = readLine() {
                if command == "stop" { await session.stop() }
                else { await session.finish(cancelled: true); return }
            }
            await session.finish(cancelled: true)
        }
        await session.start()
        while true { try? await Task.sleep(for: .seconds(60)) }
    }
}
