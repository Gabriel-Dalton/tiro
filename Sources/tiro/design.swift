// Tiro design system — implements the "Forum" direction from the Tiro.dc design doc:
// warm ink on paper, one clay accent, the Tironian et as the mark.

import AppKit

// MARK: - Palette ("Forum" tokens)

extension NSColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255,
                  green: CGFloat((hex >> 8) & 0xFF) / 255,
                  blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
    }
}

enum Pal {
    static let paper50 = NSColor(hex: 0xFCFAF4)
    static let paper100 = NSColor(hex: 0xF6F1E7)
    static let paper200 = NSColor(hex: 0xEFE8D9)
    static let paper300 = NSColor(hex: 0xE4DAC6)
    static let white = NSColor(hex: 0xFFFFFF)
    static let ink950 = NSColor(hex: 0x14110B)
    static let ink900 = NSColor(hex: 0x1F1A12)
    static let ink800 = NSColor(hex: 0x2E271C)
    static let ink500 = NSColor(hex: 0x756B57)
    static let ink400 = NSColor(hex: 0x948A74)
    static let ink300 = NSColor(hex: 0xB4AB96)
    static let ink200 = NSColor(hex: 0xD2CABA)
    static let clay700 = NSColor(hex: 0x7E2318)
    static let clay600 = NSColor(hex: 0x9C3126)
    static let clay500 = NSColor(hex: 0xB23A2E) // brand
    static let clay400 = NSColor(hex: 0xC85A4C)
    static let clay100 = NSColor(hex: 0xF3E1DC)
    static let gilt600 = NSColor(hex: 0x9A7429)
    static let gilt500 = NSColor(hex: 0xB78A3C)
    static let green600 = NSColor(hex: 0x3F6B47)
    static let green100 = NSColor(hex: 0xE1EBDF)
    static let amber600 = NSColor(hex: 0xA66A1E)
    static let amber100 = NSColor(hex: 0xF3E7CF)
    static let red600 = NSColor(hex: 0xA23127)
    static let borderDefault = NSColor(hex: 0x1F1A12, alpha: 0.16)
    static let borderSubtle = NSColor(hex: 0x1F1A12, alpha: 0.10)
}

enum Fonts {
    static func display(_ size: CGFloat, weight: NSFont.Weight = .medium) -> NSFont {
        let base = NSFont.systemFont(ofSize: size, weight: weight)
        if let d = base.fontDescriptor.withDesign(.serif), let f = NSFont(descriptor: d, size: size) {
            return f
        }
        return base
    }
    static func mono(_ size: CGFloat, weight: NSFont.Weight = .regular) -> NSFont {
        .monospacedSystemFont(ofSize: size, weight: weight)
    }
    static func sans(_ size: CGFloat, weight: NSFont.Weight = .regular) -> NSFont {
        .systemFont(ofSize: size, weight: weight)
    }
}

// MARK: - The mark: Tironian et
// Two strokes in a 48×48 box: crossbar M11 14h26, stem-curl M30 14 c0 12 0 20 -11 23.

func tironianPaths(scale s: CGFloat) -> [NSBezierPath] {
    // SVG y-down → AppKit y-up: y' = 48 − y
    let bar = NSBezierPath()
    bar.move(to: NSPoint(x: 11 * s, y: 34 * s))
    bar.line(to: NSPoint(x: 37 * s, y: 34 * s))
    let curl = NSBezierPath()
    curl.move(to: NSPoint(x: 30 * s, y: 34 * s))
    curl.curve(to: NSPoint(x: 19 * s, y: 11 * s),
               controlPoint1: NSPoint(x: 30 * s, y: 22 * s),
               controlPoint2: NSPoint(x: 30 * s, y: 14 * s))
    return [bar, curl]
}

/// stroke widths are in 48-box units (design uses 3.4–5.4)
func tironianImage(size: CGFloat, stroke: CGFloat, color: NSColor,
                   dashed: Bool = false, slashed: Bool = false, template: Bool = false) -> NSImage {
    let img = NSImage(size: NSSize(width: size, height: size))
    img.lockFocus()
    let s = size / 48
    color.setStroke()
    for p in tironianPaths(scale: s) {
        p.lineWidth = stroke * s
        p.lineCapStyle = .round
        if dashed { p.setLineDash([7 * s, 5 * s], count: 2, phase: 0) }
        p.stroke()
    }
    if slashed {
        let sl = NSBezierPath()
        sl.move(to: NSPoint(x: 6 * s, y: 42 * s))
        sl.line(to: NSPoint(x: 42 * s, y: 6 * s))
        sl.lineWidth = stroke * s
        sl.lineCapStyle = .round
        Pal.red600.setStroke()
        sl.stroke()
    }
    img.unlockFocus()
    img.isTemplate = template
    return img
}

// MARK: - Small view helpers

func label(_ text: String, font: NSFont, color: NSColor, wraps: Bool = false) -> NSTextField {
    let l = wraps ? NSTextField(wrappingLabelWithString: text) : NSTextField(labelWithString: text)
    l.font = font
    l.textColor = color
    return l
}

func capsLabel(_ text: String, size: CGFloat = 10, color: NSColor = Pal.ink500) -> NSTextField {
    let l = NSTextField(labelWithString: text.uppercased())
    l.font = Fonts.mono(size, weight: .medium)
    l.textColor = color
    if let cell = l.cell { cell.title = text.uppercased() }
    l.attributedStringValue = NSAttributedString(string: text.uppercased(), attributes: [
        .font: Fonts.mono(size, weight: .medium), .foregroundColor: color, .kern: 1.2])
    return l
}

func vdivider(height: CGFloat = 14) -> NSView {
    let v = NSView()
    v.wantsLayer = true
    v.layer?.backgroundColor = Pal.borderDefault.cgColor
    v.translatesAutoresizingMaskIntoConstraints = false
    v.widthAnchor.constraint(equalToConstant: 1).isActive = true
    v.heightAnchor.constraint(equalToConstant: height).isActive = true
    return v
}

/// Filled clay action button (design: brand button, radius 8)
class ClayButton: NSButton {
    convenience init(title: String, target: AnyObject?, action: Selector?) {
        self.init(frame: .zero)
        self.title = title
        self.target = target as? NSObject
        self.action = action
        isBordered = false
        wantsLayer = true
        layer?.backgroundColor = Pal.clay500.cgColor
        layer?.cornerRadius = 8
        attributedTitle = NSAttributedString(string: title, attributes: [
            .font: Fonts.sans(12.5, weight: .semibold), .foregroundColor: Pal.paper50])
        translatesAutoresizingMaskIntoConstraints = false
        heightAnchor.constraint(equalToConstant: 30).isActive = true
        widthAnchor.constraint(greaterThanOrEqualToConstant: 92).isActive = true
    }
}

/// White pill button with border (design: secondary controls)
class PillButton: NSButton {
    convenience init(title: String, target: AnyObject?, action: Selector?) {
        self.init(frame: .zero)
        self.title = title
        self.target = target as? NSObject
        self.action = action
        isBordered = false
        wantsLayer = true
        layer?.backgroundColor = Pal.white.cgColor
        layer?.cornerRadius = 13
        layer?.borderWidth = 1
        layer?.borderColor = Pal.borderDefault.cgColor
        attributedTitle = NSAttributedString(string: "  \(title)  ", attributes: [
            .font: Fonts.sans(12, weight: .medium), .foregroundColor: Pal.ink900])
        translatesAutoresizingMaskIntoConstraints = false
        heightAnchor.constraint(equalToConstant: 26).isActive = true
    }
}

/// Card container: white, 1px border, radius 10, optional header row
class Card: NSView {
    let body = NSStackView()

    init(title: String, accessory: NSView? = nil) {
        super.init(frame: .zero)
        wantsLayer = true
        layer?.backgroundColor = Pal.white.cgColor
        layer?.cornerRadius = 10
        layer?.borderWidth = 1
        layer?.borderColor = Pal.borderDefault.cgColor
        translatesAutoresizingMaskIntoConstraints = false

        let head = NSStackView()
        head.orientation = .horizontal
        head.translatesAutoresizingMaskIntoConstraints = false
        head.edgeInsets = NSEdgeInsets(top: 12, left: 16, bottom: 12, right: 16)
        head.addArrangedSubview(label(title, font: Fonts.sans(13.5, weight: .semibold), color: Pal.ink950))
        head.addArrangedSubview(NSView()) // spacer
        if let a = accessory { head.addArrangedSubview(a) }

        let rule = NSView()
        rule.wantsLayer = true
        rule.layer?.backgroundColor = Pal.borderSubtle.cgColor
        rule.translatesAutoresizingMaskIntoConstraints = false

        body.orientation = .vertical
        body.alignment = .leading
        body.spacing = 11
        body.translatesAutoresizingMaskIntoConstraints = false
        body.edgeInsets = NSEdgeInsets(top: 14, left: 16, bottom: 16, right: 16)

        addSubview(head)
        addSubview(rule)
        addSubview(body)
        NSLayoutConstraint.activate([
            head.topAnchor.constraint(equalTo: topAnchor),
            head.leadingAnchor.constraint(equalTo: leadingAnchor),
            head.trailingAnchor.constraint(equalTo: trailingAnchor),
            rule.topAnchor.constraint(equalTo: head.bottomAnchor),
            rule.heightAnchor.constraint(equalToConstant: 1),
            rule.leadingAnchor.constraint(equalTo: leadingAnchor),
            rule.trailingAnchor.constraint(equalTo: trailingAnchor),
            body.topAnchor.constraint(equalTo: rule.bottomAnchor),
            body.leadingAnchor.constraint(equalTo: leadingAnchor),
            body.trailingAnchor.constraint(equalTo: trailingAnchor),
            body.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
    }

    required init?(coder: NSCoder) { fatalError() }
}

/// Green "Valid" style badge
func statusBadge(_ text: String, fg: NSColor, bg: NSColor) -> NSView {
    let wrap = NSView()
    wrap.wantsLayer = true
    wrap.layer?.backgroundColor = bg.cgColor
    wrap.layer?.cornerRadius = 9
    wrap.translatesAutoresizingMaskIntoConstraints = false
    let l = label(text, font: Fonts.sans(10.5, weight: .semibold), color: fg)
    l.translatesAutoresizingMaskIntoConstraints = false
    wrap.addSubview(l)
    NSLayoutConstraint.activate([
        l.centerYAnchor.constraint(equalTo: wrap.centerYAnchor),
        l.leadingAnchor.constraint(equalTo: wrap.leadingAnchor, constant: 9),
        l.trailingAnchor.constraint(equalTo: wrap.trailingAnchor, constant: -9),
        wrap.heightAnchor.constraint(equalToConstant: 19),
    ])
    return wrap
}

// MARK: - Usage charts

/// Horizontal cost comparison bars (Tiro vs subscriptions), design section "Settings window"
class CompareBarsView: NSView {
    var tiroCost = 0.0
    override var intrinsicContentSize: NSSize { NSSize(width: NSView.noIntrinsicMetric, height: 4 * 24) }

    override func draw(_ dirtyRect: NSRect) {
        let rows: [(String, Double, NSColor, Bool)] = [
            ("Tiro", tiroCost, Pal.clay500, true),
            ("Wispr Flow Pro", 15.00, Pal.ink300, false),
            ("superwhisper", 8.49, Pal.ink200, false),
            ("Aqua Voice", 8.00, Pal.ink200, false),
        ]
        let maxV = 15.0
        let nameW: CGFloat = 104, valW: CGFloat = 52, gap: CGFloat = 10
        let barX = nameW + gap
        let barW = bounds.width - barX - valW - gap
        for (i, r) in rows.enumerated() {
            let y = bounds.height - CGFloat(i + 1) * 24 + 4
            let nameAttrs: [NSAttributedString.Key: Any] = [
                .font: Fonts.sans(11.5, weight: r.3 ? .semibold : .regular),
                .foregroundColor: r.3 ? Pal.ink950 : Pal.ink500]
            (r.0 as NSString).draw(at: NSPoint(x: 0, y: y + 1), withAttributes: nameAttrs)
            let track = NSBezierPath(roundedRect: NSRect(x: barX, y: y + 3, width: barW, height: 9),
                                     xRadius: 4.5, yRadius: 4.5)
            Pal.paper200.setFill()
            track.fill()
            let w = max(2, barW * CGFloat(r.1 / maxV))
            let bar = NSBezierPath(roundedRect: NSRect(x: barX, y: y + 3, width: w, height: 9),
                                   xRadius: 4.5, yRadius: 4.5)
            r.2.setFill()
            bar.fill()
            let v = String(format: "$%.2f", r.1) as NSString
            let vAttrs: [NSAttributedString.Key: Any] = [
                .font: Fonts.mono(11), .foregroundColor: r.3 ? Pal.ink950 : Pal.ink500]
            let vs = v.size(withAttributes: vAttrs)
            v.draw(at: NSPoint(x: bounds.width - vs.width, y: y + 1), withAttributes: vAttrs)
        }
    }
}

/// Minutes-per-day bar chart for the current month
class DailyBarsView: NSView {
    var minutes: [Double] = [] // index 0 = day 1
    var today = 1              // 1-based day of month

    override var intrinsicContentSize: NSSize { NSSize(width: NSView.noIntrinsicMetric, height: 46) }

    override func draw(_ dirtyRect: NSRect) {
        guard !minutes.isEmpty else { return }
        let n = minutes.count
        let gap: CGFloat = 3
        let w = (bounds.width - gap * CGFloat(n - 1)) / CGFloat(n)
        let peak = minutes.max() ?? 0
        let peakIdx = minutes.firstIndex(of: peak) ?? 0
        for (i, m) in minutes.enumerated() {
            let hFrac = peak > 0 ? m / peak : 0
            let h = max(2, bounds.height * CGFloat(hFrac))
            let color: NSColor = (i + 1) > today ? Pal.paper300
                : m == 0 ? Pal.paper300
                : i == peakIdx ? Pal.clay500 : Pal.ink200
            color.setFill()
            NSBezierPath(roundedRect: NSRect(x: CGFloat(i) * (w + gap), y: 0, width: w, height: h),
                         xRadius: 2, yRadius: 2).fill()
        }
    }
}

// MARK: - Recording pill

class WaveformView: NSView {
    var levels: [CGFloat] = Array(repeating: 0.08, count: 10)

    func push(_ level: CGFloat) {
        levels.removeFirst()
        levels.append(max(0.08, min(1, level)))
        needsDisplay = true
    }

    override var intrinsicContentSize: NSSize { NSSize(width: 10 * 4 - 2, height: 18) }

    override func draw(_ dirtyRect: NSRect) {
        for (i, l) in levels.enumerated() {
            let h = max(4, bounds.height * l)
            let alpha: CGFloat = l > 0.55 ? 1 : l > 0.25 ? 0.75 : 0.45
            Pal.paper50.withAlphaComponent(alpha).setFill()
            NSBezierPath(roundedRect: NSRect(x: CGFloat(i) * 4, y: (bounds.height - h) / 2, width: 2, height: h),
                         xRadius: 1, yRadius: 1).fill()
        }
    }
}

class StatusPill {
    let panel: NSPanel
    private let content = NSView()
    private var timer: Timer?
    private var startedAt = Date()
    private let waveform = WaveformView()
    private let timeLabel = label("0:00", font: Fonts.mono(12.5), color: Pal.paper50)
    var levelProvider: (() -> Float)?

    init() {
        panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 260, height: 44),
                        styleMask: [.borderless, .nonactivatingPanel],
                        backing: .buffered, defer: true)
        panel.level = .statusBar
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.ignoresMouseEvents = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        content.wantsLayer = true
        content.layer?.backgroundColor = Pal.ink950.withAlphaComponent(0.92).cgColor
        content.layer?.cornerRadius = 22
        panel.contentView = content
    }

    private func setRow(_ views: [NSView], width: CGFloat) {
        content.subviews.forEach { $0.removeFromSuperview() }
        let row = NSStackView(views: views)
        row.orientation = .horizontal
        row.spacing = 11
        row.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(row)
        NSLayoutConstraint.activate([
            row.centerXAnchor.constraint(equalTo: content.centerXAnchor),
            row.centerYAnchor.constraint(equalTo: content.centerYAnchor),
        ])
        if let screen = NSScreen.main {
            let f = screen.visibleFrame
            panel.setFrame(NSRect(x: f.midX - width / 2, y: f.minY + 60, width: width, height: 44), display: true)
        }
        panel.orderFrontRegardless()
    }

    private func dot(_ color: NSColor, pulse: Bool) -> NSView {
        let v = NSView()
        v.wantsLayer = true
        v.translatesAutoresizingMaskIntoConstraints = false
        v.widthAnchor.constraint(equalToConstant: 10).isActive = true
        v.heightAnchor.constraint(equalToConstant: 10).isActive = true
        let core = CALayer()
        core.backgroundColor = color.cgColor
        core.frame = CGRect(x: 0, y: 0, width: 10, height: 10)
        core.cornerRadius = 5
        v.layer?.addSublayer(core)
        if pulse {
            let ring = CALayer()
            ring.backgroundColor = color.withAlphaComponent(0.55).cgColor
            ring.frame = core.frame
            ring.cornerRadius = 5
            v.layer?.insertSublayer(ring, below: core)
            let scale = CABasicAnimation(keyPath: "transform.scale")
            scale.fromValue = 1
            scale.toValue = 2.1
            let fade = CABasicAnimation(keyPath: "opacity")
            fade.fromValue = 0.55
            fade.toValue = 0
            let group = CAAnimationGroup()
            group.animations = [scale, fade]
            group.duration = 1.6
            group.repeatCount = .infinity
            ring.add(group, forKey: "pulse")
        }
        return v
    }

    private func chip(_ text: String) -> NSView {
        let wrap = NSView()
        wrap.wantsLayer = true
        wrap.layer?.backgroundColor = Pal.paper50.withAlphaComponent(0.12).cgColor
        wrap.layer?.cornerRadius = 13
        wrap.translatesAutoresizingMaskIntoConstraints = false
        let l = label(text, font: Fonts.sans(11.5), color: Pal.ink200)
        l.translatesAutoresizingMaskIntoConstraints = false
        wrap.addSubview(l)
        NSLayoutConstraint.activate([
            l.centerYAnchor.constraint(equalTo: wrap.centerYAnchor),
            l.leadingAnchor.constraint(equalTo: wrap.leadingAnchor, constant: 11),
            l.trailingAnchor.constraint(equalTo: wrap.trailingAnchor, constant: -11),
            wrap.heightAnchor.constraint(equalToConstant: 26),
        ])
        return wrap
    }

    func showRecording(hint: String) {
        startedAt = Date()
        timeLabel.stringValue = "0:00"
        setRow([dot(Pal.clay400, pulse: true), waveform, timeLabel, chip(hint)], width: hint.count > 14 ? 320 : 280)
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            let t = Int(Date().timeIntervalSince(self.startedAt))
            self.timeLabel.stringValue = String(format: "%d:%02d", t / 60, t % 60)
            self.waveform.push(CGFloat(self.levelProvider?() ?? 0) * 3.2)
        }
    }

    func showTranscribing() {
        stopTimer()
        let spin = NSProgressIndicator()
        spin.style = .spinning
        spin.controlSize = .small
        spin.appearance = NSAppearance(named: .darkAqua)
        spin.startAnimation(nil)
        spin.translatesAutoresizingMaskIntoConstraints = false
        setRow([spin, label("Transcribing…", font: Fonts.sans(13.5), color: Pal.paper50)], width: 176)
    }

    /// tone colors the leading dot; sub is dimmer trailing text
    func showNotice(_ text: String, sub: String? = nil, tone: NSColor = Pal.gilt500, autohide: TimeInterval? = nil) {
        stopTimer()
        var views: [NSView] = [dot(tone, pulse: false), label(text, font: Fonts.sans(13.5), color: Pal.paper50)]
        var width = CGFloat(90 + text.count * 7)
        if let sub = sub {
            views.append(label(sub, font: Fonts.sans(11.5), color: Pal.ink300))
            width += CGFloat(sub.count * 6)
        }
        setRow(views, width: width)
        if let t = autohide {
            DispatchQueue.main.asyncAfter(deadline: .now() + t) { [weak self] in self?.hide() }
        }
    }

    func hide() {
        stopTimer()
        panel.orderOut(nil)
    }

    private func stopTimer() {
        timer?.invalidate()
        timer = nil
    }
}
