// Tiro — Wispr Flow-style dictation for Mac, powered by Deepgram.
// Hold the hotkey to talk (release to insert), or tap to toggle hands-free.
// Design: "Forum" direction from the Tiro.dc design doc (see design.swift/windows.swift).

import AppKit
import AVFoundation
import ObjCTry

// MARK: - Config

let TAP_THRESHOLD: TimeInterval = 0.35 // key held shorter than this = toggle mode
let DEEPGRAM_URL = "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&punctuate=true"

// pricing as of Aug 2026: nova-3 batch $0.0043/min (billed per second);
// Wispr Flow Pro $15/mo (monthly billing), superwhisper Pro $8.49/mo, Aqua Voice $8/mo
let DEEPGRAM_PER_MIN = 0.0043
let WISPR_MONTHLY = 15.0

struct Hotkey {
    let name: String
    let keyCode: UInt16
    let flag: NSEvent.ModifierFlags
}

let HOTKEYS = [
    Hotkey(name: "Fn / Globe", keyCode: 63, flag: .function),
    Hotkey(name: "Right Option (⌥)", keyCode: 61, flag: .option),
    Hotkey(name: "Right Command (⌘)", keyCode: 54, flag: .command),
    Hotkey(name: "Right Control (⌃)", keyCode: 62, flag: .control),
]

extension Int {
    func clamped(to r: ClosedRange<Int>) -> Int { Swift.min(Swift.max(self, r.lowerBound), r.upperBound) }
}

let logURL = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Logs/tiro.log")

func dflog(_ s: String) {
    let line = "\(Date()) \(s)\n"
    if let h = try? FileHandle(forWritingTo: logURL) {
        h.seekToEndOfFile()
        h.write(line.data(using: .utf8)!)
        try? h.close()
    } else {
        try? line.write(to: logURL, atomically: true, encoding: .utf8)
    }
    print("tiro: \(s)")
}

func saveAPIKey(_ key: String) {
    let url = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".tiro")
    try? key.write(to: url, atomically: true, encoding: .utf8)
    try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
}

func loadAPIKey() -> String? {
    if let k = ProcessInfo.processInfo.environment["DEEPGRAM_API_KEY"], !k.isEmpty { return k }
    // ~/.tiro: either the bare key, or a DEEPGRAM_API_KEY=... line
    let url = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".tiro")
    guard let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
    for line in text.split(separator: "\n") {
        let line = line.trimmingCharacters(in: .whitespaces)
        if line.hasPrefix("DEEPGRAM_API_KEY=") {
            let v = line.dropFirst("DEEPGRAM_API_KEY=".count)
                .trimmingCharacters(in: CharacterSet(charactersIn: "\"' "))
            if !v.isEmpty { return v }
        }
    }
    let bare = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if !bare.isEmpty, !bare.contains("=") { return bare }
    return nil
}

// MARK: - Deepgram

func transcribe(fileURL: URL, apiKey: String, completion: @escaping (Result<String, Error>) -> Void) {
    guard let audio = try? Data(contentsOf: fileURL) else {
        completion(.failure(NSError(domain: "tiro", code: 1,
            userInfo: [NSLocalizedDescriptionKey: "could not read \(fileURL.path)"])))
        return
    }
    let ext = fileURL.pathExtension.lowercased()
    let mime = ["m4a": "audio/mp4", "mp4": "audio/mp4", "wav": "audio/wav",
                "aiff": "audio/aiff", "mp3": "audio/mpeg"][ext] ?? "audio/mp4"
    transcribe(audio: audio, mime: mime, apiKey: apiKey, completion: completion)
}

func transcribe(audio: Data, mime: String, apiKey: String, completion: @escaping (Result<String, Error>) -> Void) {
    var req = URLRequest(url: URL(string: DEEPGRAM_URL)!)
    req.httpMethod = "POST"
    req.setValue("Token \(apiKey)", forHTTPHeaderField: "Authorization")
    req.setValue(mime, forHTTPHeaderField: "Content-Type")
    req.httpBody = audio
    URLSession.shared.dataTask(with: req) { data, resp, err in
        if let err = err { completion(.failure(err)); return }
        guard let data = data else {
            completion(.failure(NSError(domain: "tiro", code: 2,
                userInfo: [NSLocalizedDescriptionKey: "empty response"])))
            return
        }
        if let http = resp as? HTTPURLResponse, http.statusCode != 200 {
            let body = String(data: data, encoding: .utf8) ?? ""
            completion(.failure(NSError(domain: "tiro", code: http.statusCode,
                userInfo: [NSLocalizedDescriptionKey: "Deepgram \(http.statusCode): \(body)"])))
            return
        }
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        let transcript = ((((json?["results"] as? [String: Any])?["channels"] as? [[String: Any]])?
            .first?["alternatives"] as? [[String: Any]])?.first?["transcript"] as? String) ?? ""
        completion(.success(transcript))
    }.resume()
}

/// Validate a key and fetch remaining project credit (best effort).
func fetchCredit(apiKey: String, completion: @escaping (Bool, Double?) -> Void) {
    var req = URLRequest(url: URL(string: "https://api.deepgram.com/v1/projects")!)
    req.setValue("Token \(apiKey)", forHTTPHeaderField: "Authorization")
    URLSession.shared.dataTask(with: req) { data, resp, _ in
        guard (resp as? HTTPURLResponse)?.statusCode == 200, let data = data,
              let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let projects = json["projects"] as? [[String: Any]],
              let pid = projects.first?["project_id"] as? String else {
            completion(false, nil)
            return
        }
        var breq = URLRequest(url: URL(string: "https://api.deepgram.com/v1/projects/\(pid)/balances")!)
        breq.setValue("Token \(apiKey)", forHTTPHeaderField: "Authorization")
        URLSession.shared.dataTask(with: breq) { bdata, bresp, _ in
            guard (bresp as? HTTPURLResponse)?.statusCode == 200, let bdata = bdata,
                  let bjson = (try? JSONSerialization.jsonObject(with: bdata)) as? [String: Any],
                  let balances = bjson["balances"] as? [[String: Any]] else {
                completion(true, nil)
                return
            }
            let total = balances.compactMap { $0["amount"] as? Double }.reduce(0, +)
            completion(true, balances.isEmpty ? nil : total)
        }.resume()
    }.resume()
}

// MARK: - Always-warm mic with pre-roll
// AVAudioRecorder took ~0.5s to spin up after the key was pressed, clipping the start of
// speech. Instead the engine runs continuously: while idle it keeps a rolling ~0.7s
// buffer, and recording starts by adopting that buffer — so speech from just before
// the keypress is captured too. Tradeoff: the mic-in-use indicator stays on.

class AudioCapture {
    let engine = AVAudioEngine()
    let q = DispatchQueue(label: "tiro.audio")
    let target = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)!
    let preRollBytes = Int(0.7 * 16000) * 2
    var converter: AVAudioConverter?
    var preRoll = Data()
    var active: Data?
    private(set) var level: Float = 0 // rms of last active buffer, 0…1

    private var tapInstalled = false
    private var observing = false

    func start() throws {
        if !observing {
            observing = true
            // input device changed (AirPods in/out, display mic, …): rebuild the tap with
            // the new hardware format rather than feeding a stale one
            NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange,
                                                   object: engine, queue: .main) { [weak self] _ in
                guard let self = self else { return }
                dflog("audio configuration changed — rebuilding tap")
                _ = TiroCatchException({ self.engine.inputNode.removeTap(onBus: 0) })
                self.tapInstalled = false
                do { try self.start() } catch { dflog("tap rebuild failed: \(error.localizedDescription)") }
            }
        }
        try startTap()
    }

    private func startTap() throws {
        let input = engine.inputNode
        // installTap throws an NSException Swift can't catch when the device-side format is
        // dead (no input device / device mid-switch): the client format can LOOK valid while
        // the hardware format is 0 Hz (crash 2026-08-11 on a Mac mini). Check the hardware
        // format, and run the install under an ObjC @catch so a bad mic can never abort us.
        let hw = input.inputFormat(forBus: 0)
        let fmt = input.outputFormat(forBus: 0)
        dflog("audio input: hw=\(hw.sampleRate)Hz/\(hw.channelCount)ch client=\(fmt.sampleRate)Hz/\(fmt.channelCount)ch")
        guard hw.sampleRate > 0, hw.channelCount > 0, fmt.sampleRate > 0, fmt.channelCount > 0 else {
            throw NSError(domain: "tiro", code: 4, userInfo: [NSLocalizedDescriptionKey: "no audio input device"])
        }
        if !tapInstalled {
            if let err = TiroCatchException({
                self.converter = AVAudioConverter(from: fmt, to: self.target)
                input.installTap(onBus: 0, bufferSize: 4096, format: fmt) { [weak self] buf, _ in self?.handle(buf) }
            }) {
                throw NSError(domain: "tiro", code: 5, userInfo: [NSLocalizedDescriptionKey: "mic tap failed (\(err))"])
            }
            tapInstalled = true
        }
        if let err = TiroCatchException({
            self.engine.prepare()
            do { try self.engine.start() } catch { dflog("engine.start error: \(error.localizedDescription)") }
        }) {
            throw NSError(domain: "tiro", code: 6, userInfo: [NSLocalizedDescriptionKey: "engine start failed (\(err))"])
        }
        guard engine.isRunning else {
            throw NSError(domain: "tiro", code: 7, userInfo: [NSLocalizedDescriptionKey: "audio engine did not start"])
        }
    }

    var isRunning: Bool { engine.isRunning }

    private func handle(_ buffer: AVAudioPCMBuffer) {
        guard let conv = converter else { return }
        let cap = AVAudioFrameCount(Double(buffer.frameLength) * target.sampleRate / buffer.format.sampleRate) + 32
        guard let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: cap) else { return }
        var fed = false
        var err: NSError?
        conv.convert(to: out, error: &err) { _, status in
            if fed { status.pointee = .noDataNow; return nil }
            fed = true
            status.pointee = .haveData
            return buffer
        }
        guard err == nil, out.frameLength > 0, let ch = out.int16ChannelData else { return }
        let n = Int(out.frameLength)
        let data = Data(bytes: ch[0], count: n * 2)
        var sumSq = 0.0
        for i in 0..<n {
            let v = Double(ch[0][i]) / 32768
            sumSq += v * v
        }
        let rms = Float((sumSq / Double(max(n, 1))).squareRoot())
        q.async {
            if self.active != nil {
                self.active!.append(data)
                self.level = rms
            } else {
                self.preRoll.append(data)
                if self.preRoll.count > self.preRollBytes {
                    self.preRoll.removeFirst(self.preRoll.count - self.preRollBytes)
                }
            }
        }
    }

    func beginRecording() {
        q.async {
            self.active = self.preRoll
            self.preRoll = Data()
        }
    }

    /// Stops accumulating and returns the take as a WAV file (16k mono 16-bit).
    func endRecording() -> Data {
        var pcm = Data()
        q.sync {
            pcm = self.active ?? Data()
            self.active = nil
            self.level = 0
        }
        return wavFile(pcm: pcm)
    }

    private func wavFile(pcm: Data) -> Data {
        var d = Data()
        func u32(_ v: UInt32) { withUnsafeBytes(of: v.littleEndian) { d.append(contentsOf: $0) } }
        func u16(_ v: UInt16) { withUnsafeBytes(of: v.littleEndian) { d.append(contentsOf: $0) } }
        d.append("RIFF".data(using: .ascii)!); u32(UInt32(36 + pcm.count))
        d.append("WAVEfmt ".data(using: .ascii)!); u32(16)
        u16(1); u16(1); u32(16000); u32(32000); u16(2); u16(16)
        d.append("data".data(using: .ascii)!); u32(UInt32(pcm.count))
        d.append(pcm)
        return d
    }
}

// MARK: - Paste into focused app

/// Returns true if the text was auto-pasted; false = left on the clipboard only
/// (no Accessibility permission, so synthetic keystrokes would be silently dropped).
@discardableResult
func insertText(_ text: String) -> Bool {
    let pb = NSPasteboard.general
    if !AXIsProcessTrusted() {
        pb.clearContents()
        pb.setString(text, forType: .string)
        dflog("paste skipped: no Accessibility permission — transcript left on clipboard")
        return false
    }
    let saved = pb.string(forType: .string) // ponytail: string-only clipboard restore; rich content is lost
    pb.clearContents()
    pb.setString(text, forType: .string)

    let src = CGEventSource(stateID: .combinedSessionState)
    let vDown = CGEvent(keyboardEventSource: src, virtualKey: 9, keyDown: true)  // 9 = V
    let vUp = CGEvent(keyboardEventSource: src, virtualKey: 9, keyDown: false)
    vDown?.flags = .maskCommand
    vUp?.flags = .maskCommand
    vDown?.post(tap: .cghidEventTap)
    vUp?.post(tap: .cghidEventTap)

    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
        if let saved = saved {
            pb.clearContents()
            pb.setString(saved, forType: .string)
        }
    }
    return true
}

// MARK: - App

class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    enum State { case idle, holdRecording, toggleRecording, transcribing }

    var state = State.idle
    let pill = StatusPill()
    let capture = AudioCapture()
    var statusItem: NSStatusItem!
    var stateLine: NSMenuItem!
    var statsLine: NSMenuItem!
    var fnDownAt: Date?
    var apiKey = ""
    var hotkey = HOTKEYS[UserDefaults.standard.integer(forKey: "hotkeyIndex")
        .clamped(to: 0...(HOTKEYS.count - 1))]

    var history: HistoryWindowController!
    var settings: SettingsWindowController!
    var setup: SetupWindowController!

    let historyURL: URL = {
        let dir = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Tiro")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("history.jsonl")
    }()

    // menu bar icon states, drawn from the Tironian et mark
    lazy var iconIdle = tironianImage(size: 18, stroke: 4.4, color: .black, template: true)
    lazy var iconRecording = tironianImage(size: 18, stroke: 5.4, color: Pal.clay500)
    lazy var iconTranscribing = tironianImage(size: 18, stroke: 4.4, color: Pal.gilt600, dashed: true)
    lazy var iconBlocked = tironianImage(size: 18, stroke: 4.4, color: Pal.ink300, slashed: true)

    func applicationDidFinishLaunching(_ notification: Notification) {
        apiKey = loadAPIKey() ?? ""
        pill.levelProvider = { [weak self] in self?.capture.level ?? 0 }

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.image = iconIdle
        let menu = NSMenu()
        menu.delegate = self
        stateLine = NSMenuItem(title: "Ready — hold \(hotkey.name) to talk", action: nil, keyEquivalent: "")
        stateLine.isEnabled = false
        statsLine = NSMenuItem(title: "", action: nil, keyEquivalent: "")
        statsLine.isEnabled = false
        menu.addItem(stateLine)
        menu.addItem(statsLine)
        menu.addItem(.separator())
        for (title, sel, key) in [("History…", #selector(showHistory), "h"),
                                  ("Settings…", #selector(showSettings), ","),
                                  ("View Log", #selector(openLog), "")] {
            let item = NSMenuItem(title: title, action: sel, keyEquivalent: key)
            item.target = self
            menu.addItem(item)
        }
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit Tiro", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        statusItem.menu = menu

        history = HistoryWindowController(historyURL: historyURL)
        history.openSettings = { [weak self] in self?.showSettings() }
        history.hotkeyName = { [weak self] in self?.hotkey.name ?? "Fn" }
        settings = SettingsWindowController(apiKey: apiKey,
                                            hotkeyIndex: HOTKEYS.firstIndex(where: { $0.keyCode == hotkey.keyCode }) ?? 0)
        settings.historyURL = historyURL
        settings.onSaveKey = { [weak self] key in self?.saveAndTestKey(key) }
        settings.onHotkeyChange = { [weak self] i in self?.setHotkey(i) }
        setup = SetupWindowController()
        setup.hasKey = { [weak self] in !(self?.apiKey.isEmpty ?? true) }
        setup.openSettings = { [weak self] in self?.showSettings() }
        setup.hotkeyName = { [weak self] in self?.hotkey.name ?? "Fn" }

        let micStatus = AVCaptureDevice.authorizationStatus(for: .audio)
        dflog("launch: mic=\(micStatus.rawValue) (3=granted) accessibility=\(AXIsProcessTrusted())")
        AVCaptureDevice.requestAccess(for: .audio) { ok in
            dflog("mic access: \(ok ? "granted" : "DENIED")")
            DispatchQueue.main.async { if ok { self.startEngine() } }
        }

        NSEvent.addGlobalMonitorForEvents(matching: .flagsChanged) { [weak self] e in
            guard let self = self, e.keyCode == self.hotkey.keyCode else { return }
            if e.modifierFlags.contains(self.hotkey.flag) { self.fnDown() } else { self.fnUp() }
        }

        // main menu, so the activated app has Tiro → Settings… and a working Edit menu (⌘V for the key field)
        let mainMenu = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        let settingsItem = NSMenuItem(title: "Settings…", action: #selector(showSettings), keyEquivalent: ",")
        settingsItem.target = self
        appMenu.addItem(settingsItem)
        let historyItem = NSMenuItem(title: "History…", action: #selector(showHistory), keyEquivalent: "h")
        historyItem.target = self
        appMenu.addItem(historyItem)
        appMenu.addItem(.separator())
        appMenu.addItem(NSMenuItem(title: "Quit Tiro", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        appItem.submenu = appMenu
        mainMenu.addItem(appItem)
        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(NSMenuItem(title: "Undo", action: Selector(("undo:")), keyEquivalent: "z"))
        editMenu.addItem(NSMenuItem(title: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x"))
        editMenu.addItem(NSMenuItem(title: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c"))
        editMenu.addItem(NSMenuItem(title: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v"))
        editMenu.addItem(NSMenuItem(title: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"))
        editItem.submenu = editMenu
        mainMenu.addItem(editItem)
        NSApp.mainMenu = mainMenu

        // first run: walk through key + permissions instead of dropping into a bare app
        if apiKey.isEmpty || !AXIsProcessTrusted() {
            setup.show()
        }
    }

    func menuWillOpen(_ menu: NSMenu) {
        let u = computeUsage(entries: loadHistory(from: historyURL))
        statsLine.title = String(format: "%.1f min · $%.2f this month", u.monthMin, u.monthCost)
    }

    // MARK: hotkey state machine

    func fnDown() {
        switch state {
        case .idle:
            fnDownAt = Date()
            startRecording()
        case .toggleRecording:
            stopAndTranscribe()
        case .holdRecording, .transcribing:
            break
        }
    }

    func fnUp() {
        guard state == .holdRecording else { return }
        if let t = fnDownAt, Date().timeIntervalSince(t) < TAP_THRESHOLD {
            state = .toggleRecording
            stateLine.title = "Recording — tap \(hotkey.name) to stop"
            pill.showRecording(hint: "tap \(shortKeyName) to stop")
        } else {
            stopAndTranscribe()
        }
    }

    var shortKeyName: String {
        hotkey.keyCode == 63 ? "fn" : String(hotkey.name.split(separator: " ").last ?? "key")
    }

    func startEngine() {
        do {
            try capture.start()
            dflog("audio engine running (pre-roll active)")
        } catch {
            dflog("audio engine failed: \(error.localizedDescription)")
            pill.showNotice("Mic failed", sub: error.localizedDescription, tone: Pal.red600, autohide: 3)
        }
    }

    func startRecording() {
        guard !apiKey.isEmpty else {
            pill.showNotice("No Deepgram key", sub: "add one in Settings", tone: Pal.gilt500, autohide: 3)
            showSettings()
            return
        }
        if !capture.isRunning { startEngine() } // recover if the engine died (device change, etc.)
        guard capture.isRunning else {
            pill.showNotice("Mic unavailable", sub: "check permission / input device", tone: Pal.red600, autohide: 3)
            setIcon(iconBlocked)
            return
        }
        capture.beginRecording()
        state = .holdRecording
        stateLine.title = "Recording…"
        setIcon(iconRecording)
        pill.showRecording(hint: "release \(shortKeyName) to insert")
        NSSound(named: "Pop")?.play()
    }

    func stopAndTranscribe() {
        state = .transcribing
        stateLine.title = "Transcribing…"
        setIcon(iconTranscribing)
        pill.showTranscribing()
        // keep the mic open briefly after release so the tail of speech isn't clipped
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.finishRecording() }
    }

    func finishRecording() {
        let wav = capture.endRecording()
        let secs = Double(wav.count - 44) / 32000
        dflog("recorded \(wav.count) bytes (\(String(format: "%.1f", secs))s)")
        transcribe(audio: wav, mime: "audio/wav", apiKey: apiKey) { [weak self] result in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.state = .idle
                self.stateLine.title = "Ready — hold \(self.hotkey.name) to talk"
                self.setIcon(self.iconIdle)
                switch result {
                case .success(let text) where !text.isEmpty:
                    dflog("transcript ok (\(text.count) chars)")
                    self.appendHistory(text, sec: secs)
                    if self.history.window.isVisible { self.history.reload() }
                    if self.settings.window.isVisible { self.settings.refreshUsage() }
                    if insertText(text) {
                        self.pill.hide()
                    } else {
                        self.pill.showNotice("Copied — press ⌘V", sub: "grant Accessibility to auto-paste",
                                             tone: Pal.gilt500, autohide: 5)
                    }
                case .success:
                    dflog("transcript empty (mic muted, silence, or mic permission missing?)")
                    self.pill.showNotice("Heard nothing", tone: Pal.ink400, autohide: 1.5)
                    NSSound(named: "Basso")?.play()
                case .failure(let err):
                    dflog("transcription failed: \(err.localizedDescription)")
                    self.pill.showNotice("Transcription failed", sub: err.localizedDescription,
                                         tone: Pal.red600, autohide: 3)
                    NSSound(named: "Basso")?.play()
                }
            }
        }
    }

    func setIcon(_ img: NSImage) { statusItem.button?.image = img }

    // MARK: key + hotkey settings

    func saveAndTestKey(_ key: String) {
        guard !key.isEmpty else {
            settings.setBadge(false)
            return
        }
        settings.setCreditLine("Testing…")
        fetchCredit(apiKey: key) { ok, credit in
            DispatchQueue.main.async {
                self.settings.setBadge(ok)
                if ok {
                    saveAPIKey(key)
                    self.apiKey = key
                    dflog("API key updated via settings")
                    self.settings.setCreditLine(self.creditText(credit))
                } else {
                    self.settings.setCreditLine("Deepgram rejected this key. Get one free at console.deepgram.com — new accounts include $200 of credit (≈ 46,000 min of dictation).")
                }
            }
        }
    }

    func creditText(_ credit: Double?) -> String {
        if let c = credit {
            return String(format: "$%.2f of credit left — about %.0f more minutes of dictation.", c, c / DEEPGRAM_PER_MIN)
        }
        return "Get a free key at console.deepgram.com — new accounts include $200 of credit (≈ 46,000 min of dictation)."
    }

    func setHotkey(_ i: Int) {
        let idx = i.clamped(to: 0...(HOTKEYS.count - 1))
        UserDefaults.standard.set(idx, forKey: "hotkeyIndex")
        hotkey = HOTKEYS[idx]
        stateLine.title = "Ready — hold \(hotkey.name) to talk"
        dflog("hotkey changed to \(hotkey.name)")
    }

    // MARK: history

    func appendHistory(_ text: String, sec: Double) {
        var entry: [String: Any] = ["text": text, "sec": (sec * 10).rounded() / 10]
        entry["ts"] = ISO8601DateFormatter().string(from: Date())
        guard let json = try? JSONSerialization.data(withJSONObject: entry) else { return }
        var line = json
        line.append(0x0A)
        if let h = try? FileHandle(forWritingTo: historyURL) {
            h.seekToEndOfFile()
            h.write(line)
            try? h.close()
        } else {
            try? line.write(to: historyURL)
        }
    }

    @objc func showHistory() { history.show() }

    @objc func showSettings() {
        settings.keyField.stringValue = apiKey
        settings.show()
        if !apiKey.isEmpty {
            let key = apiKey
            fetchCredit(apiKey: key) { ok, credit in
                DispatchQueue.main.async {
                    self.settings.setBadge(ok)
                    self.settings.setCreditLine(ok ? self.creditText(credit)
                        : "This key was rejected by Deepgram — paste a fresh one from the console.")
                }
            }
        } else {
            settings.setCreditLine(creditText(nil))
        }
    }

    @objc func openLog() { NSWorkspace.shared.open(logURL) }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showHistory() // clicking the Dock icon opens history
        return true
    }
}

// MARK: - CLI entry

let args = CommandLine.arguments
if args.count >= 2, args[1] == "--selftest" || args[1] == "--transcribe" {
    guard args.count >= 3 else {
        print("usage: tiro --selftest <audiofile>")
        exit(2)
    }
    guard let key = loadAPIKey() else {
        print("FAIL: no DEEPGRAM_API_KEY found (env or ~/.tiro)")
        exit(1)
    }
    let sem = DispatchSemaphore(value: 0)
    var code: Int32 = 1
    transcribe(fileURL: URL(fileURLWithPath: args[2]), apiKey: key) { result in
        switch result {
        case .success(let text):
            print("TRANSCRIPT: \(text)")
            code = text.isEmpty ? 1 : 0
        case .failure(let err):
            print("FAIL: \(err.localizedDescription)")
        }
        sem.signal()
    }
    sem.wait()
    exit(code)
}
if args.count >= 3, args[1] == "--record" {
    // live-mic test: records N seconds through the real capture pipeline and transcribes.
    guard let key = loadAPIKey(), let secs = Double(args[2]) else {
        print("usage: tiro --record <seconds>  (needs DEEPGRAM_API_KEY)")
        exit(2)
    }
    let micSem = DispatchSemaphore(value: 0)
    var micOK = false
    AVCaptureDevice.requestAccess(for: .audio) { ok in micOK = ok; micSem.signal() }
    micSem.wait()
    guard micOK else { print("FAIL: mic access denied"); exit(1) }
    let cap = AudioCapture()
    do { try cap.start() } catch { print("FAIL: engine: \(error.localizedDescription)"); exit(1) }
    RunLoop.main.run(until: Date().addingTimeInterval(0.8))
    cap.beginRecording()
    print("recording \(secs)s…")
    RunLoop.main.run(until: Date().addingTimeInterval(secs))
    let wav = cap.endRecording()
    print("captured \(wav.count) bytes")
    let sem = DispatchSemaphore(value: 0)
    var code: Int32 = 1
    transcribe(audio: wav, mime: "audio/wav", apiKey: key) { result in
        switch result {
        case .success(let text):
            print("TRANSCRIPT: \(text)")
            code = text.isEmpty ? 1 : 0
        case .failure(let err):
            print("FAIL: \(err.localizedDescription)")
        }
        sem.signal()
    }
    sem.wait()
    exit(code)
}
if args.count >= 3, args[1] == "--chart-png" {
    // dev aid: render the settings usage charts to a PNG (optionally pass minutes as 3rd arg)
    let mins = args.count >= 4 ? Double(args[3]) ?? 42 : 42
    let wrap = NSView(frame: NSRect(x: 0, y: 0, width: 480, height: 180))
    wrap.wantsLayer = true
    wrap.layer?.backgroundColor = Pal.white.cgColor
    let bars = CompareBarsView(frame: NSRect(x: 16, y: 70, width: 448, height: 96))
    bars.tiroCost = mins * DEEPGRAM_PER_MIN
    let daily = DailyBarsView(frame: NSRect(x: 16, y: 12, width: 448, height: 46))
    var demo: [Double] = []
    for d in 0..<31 {
        let v: Double = (d % 7 == 3) ? 4.2 : Double((d * 13) % 30) / 10.0
        demo.append(v)
    }
    daily.minutes = demo
    daily.today = 11
    wrap.addSubview(bars)
    wrap.addSubview(daily)
    let rep = wrap.bitmapImageRepForCachingDisplay(in: wrap.bounds)!
    wrap.cacheDisplay(in: wrap.bounds, to: rep)
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]))
    print("wrote \(args[2])")
    exit(0)
}
if args.count >= 3, args[1] == "--shot" {
    // dev aid: render the app's windows offscreen to PNGs in the given directory.
    // optional 3rd arg: path to a history.jsonl to render (e.g. staged demo data)
    let dir = args[2]
    let histURL = args.count >= 4 ? URL(fileURLWithPath: args[3])
        : FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Tiro/history.jsonl")
    let hist = HistoryWindowController(historyURL: histURL)
    hist.reload()
    let set = SettingsWindowController(apiKey: "dg_••••••••••••7f3a", hotkeyIndex: 0)
    set.historyURL = histURL
    set.refreshUsage()
    set.setBadge(true)
    set.setCreditLine("$196.40 of credit left — about 45,674 more minutes of dictation.")
    let setup = SetupWindowController()
    setup.refresh()
    for (name, win) in [("history", hist.window), ("settings", set.window), ("setup", setup.window)] {
        guard var v = win.contentView else { continue }
        v.layoutSubtreeIfNeeded()
        if let scroll = v as? NSScrollView, let doc = scroll.documentView {
            doc.frame.size.width = v.bounds.width
            doc.layoutSubtreeIfNeeded()
            doc.frame.size = NSSize(width: v.bounds.width, height: max(doc.fittingSize.height, v.bounds.height))
            v = doc
        }
        let rep = v.bitmapImageRepForCachingDisplay(in: v.bounds)!
        v.cacheDisplay(in: v.bounds, to: rep)
        try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: "\(dir)/\(name).png"))
        print("wrote \(dir)/\(name).png \(Int(v.bounds.width))×\(Int(v.bounds.height))")
    }
    exit(0)
}
if args.count >= 3, args[1] == "--paste" {
    // manual check for the insert path: focus a text box within 3s of running this
    RunLoop.main.run(until: Date().addingTimeInterval(3))
    insertText(args[2])
    RunLoop.main.run(until: Date().addingTimeInterval(1)) // let the clipboard restore run
    exit(0)
}

// single instance: a rebuild-on-disk while the old app runs makes LaunchServices start a
// second copy, whose duplicate mic tap crashes — activate the existing one instead
let others = NSRunningApplication.runningApplications(withBundleIdentifier: "io.mypip.tiro")
    .filter { $0.processIdentifier != ProcessInfo.processInfo.processIdentifier }
if let other = others.first {
    other.activate()
    exit(0)
}

let app = NSApplication.shared
app.setActivationPolicy(.regular) // show in Dock + ⌘-tab so it's obvious the app is running
let delegate = AppDelegate()
app.delegate = delegate
app.run()
