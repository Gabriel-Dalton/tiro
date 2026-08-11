// Tiro windows — History (main), Settings, and first-run Setup, per the Tiro.dc design doc.

import AppKit
import AVFoundation

// MARK: - Usage model

struct Usage {
    var monthSec = 0.0
    var monthCount = 0
    var lifeSec = 0.0
    var lifeCount = 0
    var daily: [Double] = [] // minutes per day of current month, index 0 = day 1
    var today = 1

    var monthMin: Double { monthSec / 60 }
    var monthCost: Double { monthMin * DEEPGRAM_PER_MIN }
    var saved: Double { max(0, WISPR_MONTHLY - monthCost) }
    var savedPct: Double { WISPR_MONTHLY > 0 ? saved / WISPR_MONTHLY * 100 : 0 }
}

struct HistoryEntry {
    let date: Date
    let text: String
    let sec: Double
}

func loadHistory(from url: URL) -> [HistoryEntry] {
    let iso = ISO8601DateFormatter()
    let lines = (try? String(contentsOf: url, encoding: .utf8))?.split(separator: "\n") ?? []
    return lines.compactMap { line in
        guard let obj = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any],
              let text = obj["text"] as? String else { return nil }
        let date = (obj["ts"] as? String).flatMap { iso.date(from: $0) } ?? .distantPast
        return HistoryEntry(date: date, text: text, sec: obj["sec"] as? Double ?? 0)
    }.reversed()
}

func computeUsage(entries: [HistoryEntry]) -> Usage {
    var u = Usage()
    let cal = Calendar.current
    let now = Date()
    u.today = cal.component(.day, from: now)
    let days = cal.range(of: .day, in: .month, for: now)?.count ?? 30
    u.daily = Array(repeating: 0, count: days)
    for e in entries {
        u.lifeSec += e.sec
        u.lifeCount += 1
        if cal.isDate(e.date, equalTo: now, toGranularity: .month) {
            u.monthSec += e.sec
            u.monthCount += 1
            let d = cal.component(.day, from: e.date)
            if d >= 1 && d <= days { u.daily[d - 1] += e.sec / 60 }
        }
    }
    return u
}

func fmtDur(_ sec: Double) -> String {
    String(format: "%d:%02d", Int(sec) / 60, Int(sec) % 60)
}

// MARK: - History window

class HistoryRowView: NSView {
    let timeLabel = label("", font: Fonts.mono(10.5), color: Pal.ink900)
    let metaLabel = label("", font: Fonts.mono(10.5), color: Pal.ink400)
    let textLabel = label("", font: Fonts.sans(13.5), color: Pal.ink900, wraps: true)
    let copyButton = PillButton(title: "Copy", target: nil, action: nil)
    var entryText = ""

    init() {
        super.init(frame: .zero)
        wantsLayer = true
        layer?.backgroundColor = Pal.white.cgColor
        copyButton.target = self
        copyButton.action = #selector(copyText)
        textLabel.preferredMaxLayoutWidth = 430
        for v in [timeLabel, metaLabel, textLabel, copyButton] {
            v.translatesAutoresizingMaskIntoConstraints = false
            addSubview(v)
        }
        NSLayoutConstraint.activate([
            timeLabel.topAnchor.constraint(equalTo: topAnchor, constant: 15),
            timeLabel.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 20),
            metaLabel.topAnchor.constraint(equalTo: timeLabel.bottomAnchor, constant: 3),
            metaLabel.leadingAnchor.constraint(equalTo: timeLabel.leadingAnchor),
            textLabel.topAnchor.constraint(equalTo: topAnchor, constant: 14),
            textLabel.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 96),
            textLabel.trailingAnchor.constraint(equalTo: copyButton.leadingAnchor, constant: -14),
            textLabel.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -15),
            copyButton.topAnchor.constraint(equalTo: topAnchor, constant: 14),
            copyButton.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -20),
            copyButton.widthAnchor.constraint(greaterThanOrEqualToConstant: 58),
        ])
        let rule = NSView()
        rule.wantsLayer = true
        rule.layer?.backgroundColor = Pal.borderSubtle.cgColor
        rule.translatesAutoresizingMaskIntoConstraints = false
        addSubview(rule)
        NSLayoutConstraint.activate([
            rule.leadingAnchor.constraint(equalTo: leadingAnchor),
            rule.trailingAnchor.constraint(equalTo: trailingAnchor),
            rule.bottomAnchor.constraint(equalTo: bottomAnchor),
            rule.heightAnchor.constraint(equalToConstant: 1),
        ])
    }

    required init?(coder: NSCoder) { fatalError() }

    @objc func copyText() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(entryText, forType: .string)
        copyButton.attributedTitle = NSAttributedString(string: "  Copied  ", attributes: [
            .font: Fonts.sans(12, weight: .medium), .foregroundColor: Pal.green600])
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
            self?.copyButton.attributedTitle = NSAttributedString(string: "  Copy  ", attributes: [
                .font: Fonts.sans(12, weight: .medium), .foregroundColor: Pal.ink900])
        }
    }

    func set(_ e: HistoryEntry) {
        let df = DateFormatter()
        df.dateFormat = "HH:mm"
        timeLabel.stringValue = df.string(from: e.date)
        let words = e.text.split(separator: " ").count
        metaLabel.stringValue = "\(fmtDur(e.sec)) · \(words)w"
        textLabel.stringValue = e.text
        entryText = e.text
    }
}

func dayHeader(_ title: String, _ sub: String) -> NSView {
    let v = NSView()
    v.wantsLayer = true
    v.layer?.backgroundColor = Pal.paper100.cgColor
    v.translatesAutoresizingMaskIntoConstraints = false
    v.heightAnchor.constraint(equalToConstant: 30).isActive = true
    let t = capsLabel(title, size: 10, color: Pal.ink500)
    let s = label(sub, font: Fonts.mono(10.5), color: Pal.ink400)
    t.translatesAutoresizingMaskIntoConstraints = false
    s.translatesAutoresizingMaskIntoConstraints = false
    v.addSubview(t)
    v.addSubview(s)
    NSLayoutConstraint.activate([
        t.leadingAnchor.constraint(equalTo: v.leadingAnchor, constant: 20),
        t.centerYAnchor.constraint(equalTo: v.centerYAnchor),
        s.trailingAnchor.constraint(equalTo: v.trailingAnchor, constant: -20),
        s.centerYAnchor.constraint(equalTo: v.centerYAnchor),
    ])
    return v
}

class HistoryWindowController: NSObject, NSSearchFieldDelegate {
    let window: NSWindow
    private let listStack = NSStackView()
    private let countLabel = label("", font: Fonts.mono(10.5), color: Pal.ink500)
    private let statMin = label("", font: Fonts.mono(13), color: Pal.ink950)
    private let statCount = label("", font: Fonts.mono(13), color: Pal.ink950)
    private let statCost = label("", font: Fonts.mono(13), color: Pal.ink950)
    private let search = NSSearchField()
    private let historyURL: URL
    private var query = ""
    var openSettings: (() -> Void)?
    var hotkeyName: () -> String = { "Fn" }

    init(historyURL: URL) {
        self.historyURL = historyURL
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 720, height: 640),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                          backing: .buffered, defer: false)
        super.init()
        window.title = "Tiro — History"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isReleasedWhenClosed = false
        window.backgroundColor = Pal.paper100
        window.minSize = NSSize(width: 600, height: 400)
        window.center()

        let root = NSView()
        root.wantsLayer = true
        root.layer?.backgroundColor = Pal.white.cgColor

        // header: traffic-light inset · title+count · search · settings gear
        let header = NSView()
        header.wantsLayer = true
        header.layer?.backgroundColor = Pal.paper100.cgColor
        let title = label("History", font: Fonts.sans(14, weight: .semibold), color: Pal.ink950)
        search.placeholderString = "Search transcripts"
        search.controlSize = .regular
        search.delegate = self
        let gear = PillButton(title: "Settings…", target: self, action: #selector(settingsPressed))
        for v in [title, countLabel, search, gear] {
            v.translatesAutoresizingMaskIntoConstraints = false
            header.addSubview(v)
        }
        header.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            header.heightAnchor.constraint(equalToConstant: 54),
            title.leadingAnchor.constraint(equalTo: header.leadingAnchor, constant: 86),
            title.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            countLabel.leadingAnchor.constraint(equalTo: title.trailingAnchor, constant: 8),
            countLabel.firstBaselineAnchor.constraint(equalTo: title.firstBaselineAnchor),
            gear.trailingAnchor.constraint(equalTo: header.trailingAnchor, constant: -14),
            gear.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            search.trailingAnchor.constraint(equalTo: gear.leadingAnchor, constant: -10),
            search.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            search.widthAnchor.constraint(equalToConstant: 220),
        ])

        // stats strip
        let strip = NSStackView()
        strip.orientation = .horizontal
        strip.spacing = 18
        strip.edgeInsets = NSEdgeInsets(top: 11, left: 20, bottom: 11, right: 20)
        strip.translatesAutoresizingMaskIntoConstraints = false
        func stat(_ value: NSTextField, _ caption: String) -> NSView {
            let c = label(caption, font: Fonts.sans(11.5), color: Pal.ink500)
            let s = NSStackView(views: [value, c])
            s.orientation = .horizontal
            s.spacing = 6
            s.alignment = .firstBaseline
            return s
        }
        let usageLink = NSButton(title: "Usage & savings", target: self, action: #selector(settingsPressed))
        usageLink.isBordered = false
        usageLink.attributedTitle = NSAttributedString(string: "Usage & savings", attributes: [
            .font: Fonts.sans(12, weight: .medium), .foregroundColor: Pal.clay600])
        strip.addArrangedSubview(stat(statMin, "min this month"))
        strip.addArrangedSubview(vdivider())
        strip.addArrangedSubview(stat(statCount, "dictations"))
        strip.addArrangedSubview(vdivider())
        strip.addArrangedSubview(stat(statCost, "spent"))
        strip.addArrangedSubview(NSView())
        strip.addArrangedSubview(usageLink)

        // scrolling list
        listStack.orientation = .vertical
        listStack.alignment = .leading
        listStack.spacing = 0
        listStack.translatesAutoresizingMaskIntoConstraints = false
        let flip = FlippedView()
        flip.translatesAutoresizingMaskIntoConstraints = false
        flip.addSubview(listStack)
        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.drawsBackground = true
        scroll.backgroundColor = Pal.white
        scroll.documentView = flip
        scroll.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            listStack.topAnchor.constraint(equalTo: flip.topAnchor),
            listStack.leadingAnchor.constraint(equalTo: flip.leadingAnchor),
            listStack.trailingAnchor.constraint(equalTo: flip.trailingAnchor),
            listStack.bottomAnchor.constraint(equalTo: flip.bottomAnchor),
            flip.widthAnchor.constraint(equalTo: scroll.contentView.widthAnchor),
        ])

        // footer hint
        let footer = NSView()
        footer.wantsLayer = true
        footer.layer?.backgroundColor = Pal.paper100.cgColor
        footer.translatesAutoresizingMaskIntoConstraints = false
        footer.heightAnchor.constraint(equalToConstant: 36).isActive = true
        let mic = NSImageView(image: tironianImage(size: 15, stroke: 4.4, color: Pal.clay500))
        mic.translatesAutoresizingMaskIntoConstraints = false
        let hint = label("", font: Fonts.sans(12), color: Pal.ink500)
        hint.translatesAutoresizingMaskIntoConstraints = false
        footer.addSubview(mic)
        footer.addSubview(hint)
        self.footerHint = hint
        NSLayoutConstraint.activate([
            mic.leadingAnchor.constraint(equalTo: footer.leadingAnchor, constant: 20),
            mic.centerYAnchor.constraint(equalTo: footer.centerYAnchor),
            hint.leadingAnchor.constraint(equalTo: mic.trailingAnchor, constant: 8),
            hint.centerYAnchor.constraint(equalTo: footer.centerYAnchor),
        ])

        func rule() -> NSView {
            let r = NSView()
            r.wantsLayer = true
            r.layer?.backgroundColor = Pal.borderSubtle.cgColor
            r.translatesAutoresizingMaskIntoConstraints = false
            r.heightAnchor.constraint(equalToConstant: 1).isActive = true
            return r
        }
        let column = NSStackView(views: [header, rule(), strip, rule(), scroll, rule(), footer])
        column.orientation = .vertical
        column.alignment = .leading
        column.spacing = 0
        column.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(column)
        NSLayoutConstraint.activate([
            column.topAnchor.constraint(equalTo: root.topAnchor),
            column.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            column.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            column.bottomAnchor.constraint(equalTo: root.bottomAnchor),
        ])
        for v in [header, strip, scroll, footer] {
            v.leadingAnchor.constraint(equalTo: column.leadingAnchor).isActive = true
            v.trailingAnchor.constraint(equalTo: column.trailingAnchor).isActive = true
        }
        window.contentView = root
    }

    private var footerHint: NSTextField?

    @objc func settingsPressed() { openSettings?() }

    func controlTextDidChange(_ obj: Notification) {
        query = search.stringValue.lowercased()
        reload()
    }

    func show() {
        reload()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func reload() {
        let all = loadHistory(from: historyURL)
        let usage = computeUsage(entries: all)
        countLabel.stringValue = "\(all.count) dictation\(all.count == 1 ? "" : "s")"
        statMin.stringValue = String(format: "%.1f", usage.monthMin)
        statCount.stringValue = "\(usage.monthCount)"
        statCost.stringValue = String(format: "$%.2f", usage.monthCost)
        footerHint?.stringValue = "Hold \(hotkeyName()) to talk · tap to go hands-free"

        let entries = query.isEmpty ? all : all.filter { $0.text.lowercased().contains(query) }
        listStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        let cal = Calendar.current
        let df = DateFormatter()
        df.dateFormat = "EEE d MMM"
        var currentDay: String?
        var dayViews: [(String, [HistoryEntry])] = []
        for e in entries {
            let day = cal.isDateInToday(e.date) ? "Today"
                : cal.isDateInYesterday(e.date) ? "Yesterday" : df.string(from: e.date)
            if day != currentDay {
                dayViews.append((day, []))
                currentDay = day
            }
            dayViews[dayViews.count - 1].1.append(e)
        }
        if entries.isEmpty {
            let empty = label(query.isEmpty ? "No transcriptions yet — hold \(hotkeyName()) and speak." : "No matches.",
                              font: Fonts.sans(13), color: Pal.ink400)
            empty.translatesAutoresizingMaskIntoConstraints = false
            let pad = NSView()
            pad.translatesAutoresizingMaskIntoConstraints = false
            pad.addSubview(empty)
            NSLayoutConstraint.activate([
                empty.topAnchor.constraint(equalTo: pad.topAnchor, constant: 28),
                empty.leadingAnchor.constraint(equalTo: pad.leadingAnchor, constant: 20),
                empty.bottomAnchor.constraint(equalTo: pad.bottomAnchor, constant: -28),
            ])
            listStack.addArrangedSubview(pad)
            pad.widthAnchor.constraint(equalTo: listStack.widthAnchor).isActive = true
            return
        }
        for (day, dayEntries) in dayViews {
            let total = dayEntries.reduce(0.0) { $0 + $1.sec }
            let head = dayHeader(day, "\(dayEntries.count) · \(fmtDur(total))")
            listStack.addArrangedSubview(head)
            head.widthAnchor.constraint(equalTo: listStack.widthAnchor).isActive = true
            for e in dayEntries {
                let row = HistoryRowView()
                row.set(e)
                listStack.addArrangedSubview(row)
                row.widthAnchor.constraint(equalTo: listStack.widthAnchor).isActive = true
            }
        }
    }
}

class FlippedView: NSView {
    override var isFlipped: Bool { true }
}

// MARK: - Settings window

class SettingsWindowController: NSObject, NSTextFieldDelegate {
    let window: NSWindow
    let keyField = NSTextField()
    private let keyBadgeSlot = NSStackView()
    private let creditLabel = label("", font: Fonts.sans(11.5), color: Pal.ink500, wraps: true)
    private var hotkeyTiles: [NSButton] = []
    private let spentLabel = label("$0.00", font: Fonts.display(34), color: Pal.ink950)
    private let spentSub = label("", font: Fonts.mono(10.5), color: Pal.ink500)
    private let savedLabel = label("$0.00", font: Fonts.display(34), color: Pal.clay500)
    private let savedSub = label("", font: Fonts.mono(10.5), color: Pal.ink500)
    private let monthCaps = capsLabel("", size: 10, color: Pal.ink400)
    private let compareBars = CompareBarsView()
    private let dailyBars = DailyBarsView()
    private let dailyMeta = label("", font: Fonts.mono(10.5), color: Pal.ink400)
    private let dailyRange = label("", font: Fonts.mono(9.5), color: Pal.ink400)
    private let warnBox = NSView()
    var onSaveKey: ((String) -> Void)?
    var onHotkeyChange: ((Int) -> Void)?
    var historyURL: URL?

    init(apiKey: String, hotkeyIndex: Int) {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 560, height: 720),
                          styleMask: [.titled, .closable, .fullSizeContentView],
                          backing: .buffered, defer: false)
        super.init()
        window.title = "Tiro — Settings"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isReleasedWhenClosed = false
        window.backgroundColor = Pal.paper50
        window.center()

        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 14
        stack.edgeInsets = NSEdgeInsets(top: 14, left: 20, bottom: 20, right: 20)
        stack.translatesAutoresizingMaskIntoConstraints = false

        let heading = label("Settings", font: Fonts.sans(14, weight: .semibold), color: Pal.ink950)
        heading.translatesAutoresizingMaskIntoConstraints = false

        // --- API key card
        keyBadgeSlot.orientation = .horizontal
        let keyCard = Card(title: "Deepgram API key", accessory: keyBadgeSlot)
        keyField.stringValue = apiKey
        keyField.placeholderString = "paste your Deepgram API key"
        keyField.font = Fonts.mono(11.5)
        keyField.translatesAutoresizingMaskIntoConstraints = false
        keyField.heightAnchor.constraint(equalToConstant: 30).isActive = true
        let saveBtn = ClayButton(title: "Save & test", target: self, action: #selector(savePressed))
        let keyRow = NSStackView(views: [keyField, saveBtn])
        keyRow.orientation = .horizontal
        keyRow.spacing = 8
        keyField.widthAnchor.constraint(greaterThanOrEqualToConstant: 350).isActive = true
        creditLabel.preferredMaxLayoutWidth = 380
        let consoleLink = NSButton(title: "Deepgram console ↗", target: self, action: #selector(openConsole))
        consoleLink.isBordered = false
        consoleLink.attributedTitle = NSAttributedString(string: "Deepgram console ↗", attributes: [
            .font: Fonts.sans(11.5, weight: .medium), .foregroundColor: Pal.clay600])
        let creditRow = NSStackView(views: [creditLabel, consoleLink])
        creditRow.orientation = .horizontal
        creditRow.alignment = .top
        creditRow.spacing = 10
        keyCard.body.addArrangedSubview(keyRow)
        keyCard.body.addArrangedSubview(creditRow)
        keyRow.widthAnchor.constraint(equalTo: keyCard.body.widthAnchor, constant: -32).isActive = true
        creditRow.widthAnchor.constraint(equalTo: keyCard.body.widthAnchor, constant: -32).isActive = true

        // --- Hotkey card
        let hkCaption = label("Hold to talk · tap to toggle", font: Fonts.sans(11.5), color: Pal.ink500)
        let hkCard = Card(title: "Hotkey", accessory: hkCaption)
        let tileRow = NSStackView()
        tileRow.orientation = .horizontal
        tileRow.distribution = .fillEqually
        tileRow.spacing = 8
        for (i, hk) in HOTKEYS.enumerated() {
            let tile = NSButton(frame: .zero)
            tile.isBordered = false
            tile.wantsLayer = true
            tile.layer?.cornerRadius = 8
            tile.tag = i
            tile.target = self
            tile.action = #selector(tilePressed(_:))
            let symbol = ["🌐", "⌥", "⌘", "⌃"][min(i, 3)]
            let name = hk.name.replacingOccurrences(of: " (⌥)", with: "")
                .replacingOccurrences(of: " (⌘)", with: "")
                .replacingOccurrences(of: " (⌃)", with: "")
            tile.attributedTitle = NSAttributedString(string: "\(symbol)\n\(name)", attributes: [
                .font: Fonts.sans(11, weight: .medium), .foregroundColor: Pal.ink900,
                .paragraphStyle: {
                    let p = NSMutableParagraphStyle()
                    p.alignment = .center
                    p.lineSpacing = 3
                    return p
                }()])
            tile.translatesAutoresizingMaskIntoConstraints = false
            tile.heightAnchor.constraint(equalToConstant: 56).isActive = true
            hotkeyTiles.append(tile)
            tileRow.addArrangedSubview(tile)
        }
        hkCard.body.addArrangedSubview(tileRow)
        tileRow.widthAnchor.constraint(equalTo: hkCard.body.widthAnchor, constant: -32).isActive = true

        // Globe-key warning callout
        warnBox.wantsLayer = true
        warnBox.layer?.backgroundColor = Pal.amber100.cgColor
        warnBox.layer?.cornerRadius = 8
        warnBox.translatesAutoresizingMaskIntoConstraints = false
        let warnText = label("macOS may still act on the Globe key. Set Keyboard → “Press 🌐 key to” → Do Nothing.",
                             font: Fonts.sans(11.5), color: Pal.amber600, wraps: true)
        warnText.preferredMaxLayoutWidth = 360
        let warnBtn = NSButton(title: "Open", target: self, action: #selector(openKeyboardSettings))
        warnBtn.isBordered = false
        warnBtn.wantsLayer = true
        warnBtn.layer?.cornerRadius = 12
        warnBtn.layer?.borderWidth = 1
        warnBtn.layer?.borderColor = Pal.amber600.cgColor
        warnBtn.attributedTitle = NSAttributedString(string: "  Open  ", attributes: [
            .font: Fonts.sans(11.5, weight: .semibold), .foregroundColor: Pal.amber600])
        warnText.translatesAutoresizingMaskIntoConstraints = false
        warnBtn.translatesAutoresizingMaskIntoConstraints = false
        warnBox.addSubview(warnText)
        warnBox.addSubview(warnBtn)
        NSLayoutConstraint.activate([
            warnText.topAnchor.constraint(equalTo: warnBox.topAnchor, constant: 10),
            warnText.leadingAnchor.constraint(equalTo: warnBox.leadingAnchor, constant: 12),
            warnText.bottomAnchor.constraint(equalTo: warnBox.bottomAnchor, constant: -10),
            warnBtn.centerYAnchor.constraint(equalTo: warnBox.centerYAnchor),
            warnBtn.leadingAnchor.constraint(equalTo: warnText.trailingAnchor, constant: 10),
            warnBtn.trailingAnchor.constraint(equalTo: warnBox.trailingAnchor, constant: -10),
            warnBtn.heightAnchor.constraint(equalToConstant: 24),
        ])
        hkCard.body.addArrangedSubview(warnBox)
        warnBox.widthAnchor.constraint(equalTo: hkCard.body.widthAnchor, constant: -32).isActive = true

        // --- Usage card
        let usageCard = Card(title: "Usage & savings", accessory: monthCaps)
        let bigRow = NSStackView()
        bigRow.orientation = .horizontal
        bigRow.spacing = 22
        bigRow.alignment = .bottom
        func bigStat(_ caps: String, _ value: NSTextField, _ sub: NSTextField) -> NSView {
            let s = NSStackView(views: [capsLabel(caps, size: 9.5), value, sub])
            s.orientation = .vertical
            s.alignment = .leading
            s.spacing = 3
            return s
        }
        bigRow.addArrangedSubview(bigStat("Spent", spentLabel, spentSub))
        bigRow.addArrangedSubview(vdivider(height: 52))
        bigRow.addArrangedSubview(bigStat("Saved vs Wispr Pro", savedLabel, savedSub))
        usageCard.body.addArrangedSubview(bigRow)
        compareBars.translatesAutoresizingMaskIntoConstraints = false
        usageCard.body.addArrangedSubview(compareBars)
        compareBars.widthAnchor.constraint(equalTo: usageCard.body.widthAnchor, constant: -32).isActive = true

        let dailyHead = NSStackView(views: [capsLabel("Minutes per day", size: 9.5), NSView(), dailyMeta])
        dailyHead.orientation = .horizontal
        dailyBars.translatesAutoresizingMaskIntoConstraints = false
        usageCard.body.addArrangedSubview(dailyHead)
        usageCard.body.addArrangedSubview(dailyBars)
        usageCard.body.addArrangedSubview(dailyRange)
        dailyHead.widthAnchor.constraint(equalTo: usageCard.body.widthAnchor, constant: -32).isActive = true
        dailyBars.widthAnchor.constraint(equalTo: usageCard.body.widthAnchor, constant: -32).isActive = true

        let footnote = label(
            "Deepgram bills $0.0043/min by the second. Wispr Flow Pro’s flat $15/mo only breaks even past ~58 h of dictation a month; Aqua ($8) and superwhisper ($8.49) past ~31 h. Wispr Free caps at ≈1 h/mo — that hour costs about 25¢ here.",
            font: Fonts.sans(11), color: Pal.ink500, wraps: true)
        footnote.preferredMaxLayoutWidth = 480

        stack.addArrangedSubview(heading)
        for card in [keyCard, hkCard, usageCard] {
            stack.addArrangedSubview(card)
            card.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -40).isActive = true
        }
        stack.addArrangedSubview(footnote)

        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.drawsBackground = true
        scroll.backgroundColor = Pal.paper50
        let flip = FlippedView()
        flip.translatesAutoresizingMaskIntoConstraints = false
        flip.addSubview(stack)
        scroll.documentView = flip
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: flip.topAnchor, constant: 28),
            stack.leadingAnchor.constraint(equalTo: flip.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: flip.trailingAnchor),
            stack.bottomAnchor.constraint(equalTo: flip.bottomAnchor),
            flip.widthAnchor.constraint(equalTo: scroll.contentView.widthAnchor),
        ])
        window.contentView = scroll
        selectTile(hotkeyIndex)
        setBadge(nil)
    }

    func setBadge(_ state: Bool?) {
        keyBadgeSlot.arrangedSubviews.forEach { $0.removeFromSuperview() }
        switch state {
        case .some(true):
            keyBadgeSlot.addArrangedSubview(statusBadge("✓ Valid", fg: Pal.green600, bg: Pal.green100))
        case .some(false):
            keyBadgeSlot.addArrangedSubview(statusBadge("✗ Rejected", fg: Pal.red600, bg: NSColor(hex: 0xF3DFDC)))
        case .none:
            break
        }
    }

    func setCreditLine(_ text: String) { creditLabel.stringValue = text }

    func selectTile(_ index: Int) {
        for (i, t) in hotkeyTiles.enumerated() {
            let selected = i == index
            t.layer?.backgroundColor = (selected ? Pal.clay100 : Pal.paper50).cgColor
            t.layer?.borderWidth = selected ? 1.5 : 1
            t.layer?.borderColor = (selected ? Pal.clay500 : Pal.borderDefault).cgColor
        }
        warnBox.isHidden = index != 0
    }

    @objc func tilePressed(_ sender: NSButton) {
        selectTile(sender.tag)
        onHotkeyChange?(sender.tag)
    }

    @objc func savePressed() { onSaveKey?(keyField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)) }

    @objc func openConsole() { NSWorkspace.shared.open(URL(string: "https://console.deepgram.com")!) }

    @objc func openKeyboardSettings() {
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.Keyboard-Settings.extension")!)
    }

    func show() {
        refreshUsage()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func refreshUsage() {
        guard let url = historyURL else { return }
        let u = computeUsage(entries: loadHistory(from: url))
        let df = DateFormatter()
        df.dateFormat = "MMMM yyyy"
        monthCaps.attributedStringValue = NSAttributedString(
            string: df.string(from: Date()).uppercased(),
            attributes: [.font: Fonts.mono(9.5, weight: .medium), .foregroundColor: Pal.ink400, .kern: 1.2])
        spentLabel.stringValue = String(format: "$%.2f", u.monthCost)
        spentSub.stringValue = String(format: "%.1f min · %d dictations", u.monthMin, u.monthCount)
        savedLabel.stringValue = String(format: "$%.2f", u.saved)
        savedSub.stringValue = String(format: "%.1f%% cheaper this month", u.savedPct)
        compareBars.tiroCost = u.monthCost
        compareBars.needsDisplay = true
        dailyBars.minutes = u.daily
        dailyBars.today = u.today
        dailyBars.needsDisplay = true
        let peak = u.daily.max() ?? 0
        if peak > 0, let idx = u.daily.firstIndex(of: peak) {
            let cal = Calendar.current
            var comps = cal.dateComponents([.year, .month], from: Date())
            comps.day = idx + 1
            let wd = DateFormatter()
            wd.dateFormat = "EEE d"
            dailyMeta.stringValue = String(format: "peak %.1f min · %@", peak,
                                           cal.date(from: comps).map { wd.string(from: $0) } ?? "")
        } else {
            dailyMeta.stringValue = ""
        }
        let mf = DateFormatter()
        mf.dateFormat = "d MMM"
        dailyRange.stringValue = "1 \(mf.string(from: Date()).split(separator: " ").last ?? "")   ·   \(mf.string(from: Date())) — today   ·   \(u.daily.count)"
    }
}

// MARK: - First-run setup window

class SetupWindowController: NSObject {
    let window: NSWindow
    private var timer: Timer?
    private let keyStatus = label("", font: Fonts.sans(12, weight: .semibold), color: Pal.green600)
    private let micStatus = label("", font: Fonts.sans(12, weight: .semibold), color: Pal.green600)
    private let axStatus = label("", font: Fonts.sans(12, weight: .semibold), color: Pal.green600)
    var hasKey: () -> Bool = { false }
    var openSettings: (() -> Void)?
    var hotkeyName: () -> String = { "Fn" }

    override init() {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 560, height: 10),
                          styleMask: [.titled, .closable, .fullSizeContentView],
                          backing: .buffered, defer: false)
        super.init()
        window.title = "Set up Tiro"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isReleasedWhenClosed = false
        window.backgroundColor = Pal.paper50

        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 14
        stack.edgeInsets = NSEdgeInsets(top: 40, left: 28, bottom: 24, right: 28)
        stack.translatesAutoresizingMaskIntoConstraints = false

        let h = label("Three things, then you can talk.", font: Fonts.display(22), color: Pal.ink950)
        let sub = label("Hold the hotkey anywhere on your Mac, speak, and the text lands in whatever box your cursor is in.",
                        font: Fonts.sans(13), color: Pal.ink500, wraps: true)
        sub.preferredMaxLayoutWidth = 480
        stack.addArrangedSubview(h)
        stack.addArrangedSubview(sub)
        stack.setCustomSpacing(20, after: sub)

        func row(_ title: String, _ detail: String, status: NSTextField, button: NSButton?) -> NSView {
            let card = NSView()
            card.wantsLayer = true
            card.layer?.backgroundColor = Pal.white.cgColor
            card.layer?.cornerRadius = 10
            card.layer?.borderWidth = 1
            card.layer?.borderColor = Pal.borderDefault.cgColor
            card.translatesAutoresizingMaskIntoConstraints = false
            let t = label(title, font: Fonts.sans(13, weight: .semibold), color: Pal.ink950)
            let d = label(detail, font: Fonts.sans(11.5), color: Pal.ink500, wraps: true)
            d.preferredMaxLayoutWidth = 300
            let col = NSStackView(views: [t, d])
            col.orientation = .vertical
            col.alignment = .leading
            col.spacing = 2
            col.translatesAutoresizingMaskIntoConstraints = false
            status.translatesAutoresizingMaskIntoConstraints = false
            card.addSubview(col)
            card.addSubview(status)
            var trailing: NSView = status
            if let b = button {
                b.translatesAutoresizingMaskIntoConstraints = false
                card.addSubview(b)
                trailing = b
                b.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -14).isActive = true
                b.centerYAnchor.constraint(equalTo: card.centerYAnchor).isActive = true
                status.trailingAnchor.constraint(equalTo: b.leadingAnchor, constant: -10).isActive = true
            } else {
                status.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16).isActive = true
            }
            _ = trailing
            NSLayoutConstraint.activate([
                col.topAnchor.constraint(equalTo: card.topAnchor, constant: 13),
                col.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
                col.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -13),
                status.centerYAnchor.constraint(equalTo: card.centerYAnchor),
                col.trailingAnchor.constraint(lessThanOrEqualTo: status.leadingAnchor, constant: -10),
            ])
            return card
        }

        let keyBtn = ClayButton(title: "Add key", target: self, action: #selector(keyPressed))
        let micBtn = ClayButton(title: "Allow", target: self, action: #selector(micPressed))
        let axBtn = ClayButton(title: "Open settings", target: self, action: #selector(axPressed))
        keyRow = row("Deepgram API key", "$200 free signup credit ≈ 46,000 min", status: keyStatus, button: keyBtn)
        micRow = row("Microphone", "So Tiro can hear you while the key is held", status: micStatus, button: micBtn)
        axRow = row("Accessibility", "Needed to watch the hotkey from anywhere and paste for you. Then relaunch Tiro.",
                    status: axStatus, button: axBtn)
        keyButton = keyBtn
        micButton = micBtn
        axButton = axBtn
        for r in [keyRow!, micRow!, axRow!] {
            stack.addArrangedSubview(r)
            r.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -56).isActive = true
        }

        // "Try it now" footer
        let tryCard = NSView()
        tryCard.wantsLayer = true
        tryCard.layer?.backgroundColor = Pal.paper100.cgColor
        tryCard.layer?.cornerRadius = 10
        tryCard.translatesAutoresizingMaskIntoConstraints = false
        let mark = NSImageView(image: tironianImage(size: 22, stroke: 4.4, color: Pal.paper50))
        let markWrap = NSView()
        markWrap.wantsLayer = true
        markWrap.layer?.backgroundColor = Pal.clay500.cgColor
        markWrap.layer?.cornerRadius = 20
        markWrap.translatesAutoresizingMaskIntoConstraints = false
        mark.translatesAutoresizingMaskIntoConstraints = false
        markWrap.addSubview(mark)
        let tryTitle = label("Try it now", font: Fonts.sans(13, weight: .semibold), color: Pal.ink950)
        tryHint = label("", font: Fonts.sans(11.5), color: Pal.ink500)
        let tryCol = NSStackView(views: [tryTitle, tryHint!])
        tryCol.orientation = .vertical
        tryCol.alignment = .leading
        tryCol.spacing = 2
        tryCol.translatesAutoresizingMaskIntoConstraints = false
        tryCard.addSubview(markWrap)
        tryCard.addSubview(tryCol)
        NSLayoutConstraint.activate([
            mark.centerXAnchor.constraint(equalTo: markWrap.centerXAnchor),
            mark.centerYAnchor.constraint(equalTo: markWrap.centerYAnchor),
            markWrap.widthAnchor.constraint(equalToConstant: 40),
            markWrap.heightAnchor.constraint(equalToConstant: 40),
            markWrap.leadingAnchor.constraint(equalTo: tryCard.leadingAnchor, constant: 16),
            markWrap.centerYAnchor.constraint(equalTo: tryCard.centerYAnchor),
            tryCol.leadingAnchor.constraint(equalTo: markWrap.trailingAnchor, constant: 12),
            tryCol.topAnchor.constraint(equalTo: tryCard.topAnchor, constant: 14),
            tryCol.bottomAnchor.constraint(equalTo: tryCard.bottomAnchor, constant: -14),
        ])
        stack.addArrangedSubview(tryCard)
        tryCard.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -56).isActive = true

        window.contentView = stack
        window.setContentSize(NSSize(width: 560, height: stack.fittingSize.height))
        window.center()
    }

    private var keyRow: NSView?
    private var micRow: NSView?
    private var axRow: NSView?
    private var keyButton: NSButton?
    private var micButton: NSButton?
    private var axButton: NSButton?
    private var tryHint: NSTextField?

    @objc func keyPressed() { openSettings?() }

    @objc func micPressed() {
        AVCaptureDevice.requestAccess(for: .audio) { _ in }
    }

    @objc func axPressed() {
        let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(opts)
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!)
    }

    func show() {
        refresh()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            if !self.window.isVisible {
                self.timer?.invalidate()
                self.timer = nil
                return
            }
            self.refresh()
        }
    }

    func refresh() {
        let key = hasKey()
        keyStatus.stringValue = key ? "Valid" : "Missing"
        keyStatus.textColor = key ? Pal.green600 : Pal.red600
        keyButton?.isHidden = key
        let mic = AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
        micStatus.stringValue = mic ? "Allowed" : "Not yet"
        micStatus.textColor = mic ? Pal.green600 : Pal.amber600
        micButton?.isHidden = mic
        let ax = AXIsProcessTrusted()
        axStatus.stringValue = ax ? "Granted" : "Not yet"
        axStatus.textColor = ax ? Pal.green600 : Pal.amber600
        axButton?.isHidden = ax
        tryHint?.stringValue = "Hold \(hotkeyName()) and say something. It appears wherever your cursor is."
    }
}
