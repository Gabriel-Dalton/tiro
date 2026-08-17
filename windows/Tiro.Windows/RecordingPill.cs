using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;

namespace Tiro.Windows;

/// <summary>
/// Small always-on-top status pill near the bottom of the screen while
/// recording or transcribing, matching the macOS one. It never takes focus,
/// the user is mid-keystroke in another app.
///
/// It is drawn rather than assembled from controls. A Label filling the form
/// was enough while the pill only said "Recording 0:07", but a waveform is a
/// per-frame repaint and the two buttons have to hit-test against the form
/// itself, which a docked child control would swallow.
/// </summary>
sealed class RecordingPill : Form
{
    // Forum palette, the same values as shared/design-tokens.json.
    private static readonly Color Ink950 = Color.FromArgb(20, 17, 11);
    private static readonly Color Paper50 = Color.FromArgb(252, 250, 244);
    private static readonly Color Clay400 = Color.FromArgb(200, 90, 76);
    private static readonly Color Ink300 = Color.FromArgb(180, 171, 150);
    // The night value of the gilt, not the daylight one. This pill is the only
    // surface in the product that is dark whatever the system theme says, so it
    // takes its colours from the dark half of the palette throughout: gilt-500
    // is mixed to sit on paper and goes muddy on ink. Gold rather than white
    // because gold is already what "transcribing" looks like everywhere else,
    // in the tray icon sitting a few hundred pixels away while this is on screen.
    private static readonly Color Gilt300 = Color.FromArgb(216, 179, 106);

    // Design geometry, in logical units against a 44 unit tall pill. Everything
    // drawn is scaled from the form's real height, so one set of numbers holds
    // at 100%, 150% and 200% without a second table.
    private const int BaseHeight = 44;
    private const int Bars = 14;
    // Recording runs X(7..37) dot(43..53) bars(64..134) clock(144..178) check(189..219),
    // so these are the tight widths rather than round numbers. The clock's slot is
    // reserved at its widest ("59:59") even though it is drawn left-aligned: sized
    // to the current text, the check would shuffle sideways every time the clock
    // ticked into a wider digit, and it is a button people hit without looking.
    private const int RecordingWidth = 226;
    private const float DotX = 48;
    private const float BarX = 64;
    private const float ClockX = 144;

    // Transcribing is X(7..37) strip(52..120), and that is the whole pill. It
    // used to be the X and the word "Transcribing…", which is 168 units of pill
    // asking to be read at the one moment the user has already looked away, at
    // whatever they were dictating into. The strip says the same thing by
    // moving, and says it in the same shape the voice was just drawn in.
    private const int TranscribingWidth = 136;
    private const float SweepBarX = 52;

    // The sweep: one bump of activity crossing the strip, rather than a spinner.
    // A spinner would be a second vocabulary inside a 44 unit pill that already
    // has a waveform in it, and it would say "a thing is spinning" where this
    // says "your take is being read through, left to right".
    private const double SweepPeriod = 1.15;  // seconds for one crossing
    private const float SweepFloor = 0.25f;   // the strip at rest: a track, not a dotted line
    private const float SweepPeak = 0.85f;    // short of a shouted word, deliberately
    private const float SweepSigma = 0.28f;   // bump half width, in strip widths
    private const float SweepEase = 0.32f;    // per frame, so the last word falls into it

    // The floor and the width were picked against the three narrower variants
    // rather than by taste: at the floor the recording strip uses (0.08, which
    // clamps to the 3 unit minimum) the resting bars are dots, and dots are
    // already what silence looks like while recording. Two states that differ
    // only in colour is exactly what the interface rules forbid. At 0.25 the
    // strip is a low continuous track that the swell rises out of, which reads
    // as one object doing something rather than fourteen that are mostly off.

    // A message is as wide as it needs to be, between something that still reads
    // as a sentence and something that still reads as a pill rather than a bar
    // across the screen. Longer than the maximum gets ellipsised; the full text
    // is always in the log and in the app. This was the transcribing width until
    // that pill lost its text and shrank to an indicator; a message is text, so
    // it keeps the floor that was measured for text.
    private const int ProblemMinWidth = 168;
    private const int ProblemMaxWidth = 460;
    private const float ProblemTextX = 44;   // clear of the X at 7..37
    private const float ProblemPadRight = 16;

    /// <summary>The X was clicked: throw the take away.</summary>
    public event Action? CancelClicked;

    /// <summary>The check was clicked: finish the take now.</summary>
    public event Action? StopClicked;

    /// <summary>A message pill was clicked: the user wants the app itself.</summary>
    public event Action? OpenRequested;

    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 50 };
    private readonly float[] _bars = new float[Bars];
    // Stopwatch, not DateTime.UtcNow. Elapsed time from a wall clock goes
    // negative the moment an NTP correction steps the clock back, and this one
    // does more than print: the pulse alpha is 140 * (1 - phase), so a negative
    // phase pushes the argument past 255 and Color.FromArgb throws where nothing
    // catches it. A monotonic clock cannot produce the input at all.
    private readonly System.Diagnostics.Stopwatch _elapsed = new();
    // A message pill takes itself down; nothing else will, because the state
    // machine it is reporting on never left idle and so sends no further state.
    private readonly System.Windows.Forms.Timer _dismiss = new() { Interval = 6000 };
    private string _mode = "";
    private string _message = "";
    private bool _openable;
    private float _level;
    private int _hot = -1;      // 0 = cancel, 1 = stop, 2 = the message body, -1 = none
    private int _width = RecordingWidth; // logical, so a DPI change can re-apply it

    public RecordingPill()
    {
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        BackColor = Ink950;
        ForeColor = Paper50;
        // The pill now has two widths, and WinForms' own scaling only applies to
        // sizes set before the form is scaled. A width assigned at runtime would
        // be taken as raw pixels and come out a third too small on a 150%
        // display, which is precisely the WIN-06 clipping bug wearing a
        // different hat. Opting out and doing the arithmetic in ApplySize keeps
        // one rule for every size the pill ever takes.
        AutoScaleMode = AutoScaleMode.None;
        ApplySize(RecordingWidth);
        DoubleBuffered = true;
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true);
        Array.Fill(_bars, 0.08f);

        _timer.Tick += (_, _) =>
        {
            if (_mode == "recording")
            {
                // Shift one bar in per tick, so the strip is a 700 ms window of your
                // voice scrolling leftward rather than 14 copies of the same number.
                Array.Copy(_bars, 1, _bars, 0, Bars - 1);
                _bars[Bars - 1] = Math.Clamp(_level, 0.08f, 1f);
            }
            else if (_mode == "transcribing")
            {
                StepSweep();
            }
            else return;
            Invalidate();
        };

        // The rounded corners have to be recut whenever the form's real size
        // changes (WIN-06). The app is PerMonitorV2 DPI-aware, so the same pill
        // is 268x44 on one monitor and 402x66 on the 150% one next to it. A
        // region cut once in the constructor would clip a third of the pill off,
        // and would clip again the moment it moved between them.
        Resize += (_, _) => ApplyRoundedCorners();
        _dismiss.Tick += (_, _) =>
        {
            _dismiss.Stop();
            if (_mode == "problem") { _mode = ""; Hide(); }
        };

        // A DPI change means Windows just moved this window to another monitor,
        // so it needs re-centring on that one as well as re-sizing for it.
        DpiChanged += (_, _) => { ApplySize(_width); if (Visible) Place(); };
        ApplyRoundedCorners();
    }

    /// <summary>Size the pill from logical units at the current monitor's DPI.
    /// Height comes along for the ride because every drawn coordinate is scaled
    /// from it.</summary>
    private void ApplySize(int logicalWidth)
    {
        _width = logicalWidth;
        var dpi = DeviceDpi <= 0 ? 96 : DeviceDpi;
        Size = new Size(
            (int)Math.Round(logicalWidth * dpi / 96.0),
            (int)Math.Round(BaseHeight * dpi / 96.0));
    }

    private void ApplyRoundedCorners()
    {
        if (Width <= 0 || Height <= 0) return;
        // Corner radius as a proportion of the current height, so the shape is
        // the same at 100% and at 200% scaling. Control.Region's setter disposes
        // the region it replaces, so only the raw GDI handle is ours to free,
        // and since this now runs on every resize, not freeing it would leak.
        var ellipse = Height / 2;
        var hrgn = CreateRoundRectRgn(0, 0, Width, Height, ellipse, ellipse);
        if (hrgn == IntPtr.Zero) return;
        try
        {
            Region = System.Drawing.Region.FromHrgn(hrgn); // copies the handle
        }
        finally
        {
            DeleteObject(hrgn);
        }
    }

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= 0x08000000; // WS_EX_NOACTIVATE: never steal focus
            return cp;
        }
    }

    /// <summary>Mic level 0..1 from the web core, already smoothed and
    /// normalised there so this meter and the PWA's halo cannot disagree.</summary>
    public void SetLevel(float level) => _level = Math.Clamp(level, 0f, 1f);

    public void ShowState(string state)
    {
        // A real take outranks a message about one that never happened, and
        // takes the dismiss timer down with it: left running, it would fire
        // mid-take and hide a pill that is no longer a message.
        _dismiss.Stop();
        _mode = state;
        _hot = -1;
        // The pill draws itself, so its only accessible text is the window's own
        // name, and transcribing no longer has a word in it to fall back on.
        // Nothing else on the desktop carries the state either: the tray icon
        // says it in colour, and the app's own window is hidden by definition
        // whenever the hotkey is what is being used.
        AccessibleName = state switch
        {
            "recording" => "Tiro, recording",
            "transcribing" => "Tiro, transcribing",
            _ => "Tiro",
        };
        if (state == "recording")
        {
            _elapsed.Restart();
            Array.Fill(_bars, 0.08f);
            _level = 0;
            ApplySize(RecordingWidth);
            _timer.Start();
            Place();
            Show();
        }
        else if (state == "transcribing")
        {
            // The bars are deliberately left where the take left them: the sweep
            // eases into position from whatever you last said, so the strip
            // settles into working rather than cutting to a different picture.
            // Restarting the clock is what puts the first bump at the left edge;
            // it is the sweep's phase now, and the take's length is not
            // interesting to anybody once the audio has gone.
            _elapsed.Restart();
            ApplySize(TranscribingWidth);
            _timer.Start();
            Place();
            Show();
            Invalidate();
        }
        else
        {
            _timer.Stop();
            Hide();
        }
    }

    /// <summary>Say why a press produced no take, where the take would have
    /// appeared. This is the only thing on screen when it happens: the app's own
    /// toast is in a window the user is deliberately not looking at.</summary>
    public void ShowProblem(string text, bool openable)
    {
        _timer.Stop();
        _mode = "problem";
        _message = text;
        _openable = openable;
        _hot = -1;
        AccessibleName = "Tiro: " + text;
        ApplySize(MeasureProblemWidth(text));
        Place();
        Show();
        Invalidate();
        // Restart, so a second refusal gets its own six seconds rather than the
        // remainder of the first one's.
        _dismiss.Stop();
        _dismiss.Start();
    }

    /// <summary>Logical width for a message, measured with the font the paint
    /// will use at 96 dpi. ApplySize scales the answer, so this must not be
    /// measured at the current DPI or the scaling would be applied twice.</summary>
    private static int MeasureProblemWidth(string text)
    {
        using var g = Graphics.FromHwnd(IntPtr.Zero);
        using var font = new Font("Segoe UI", 10.5f, GraphicsUnit.Pixel);
        var w = g.MeasureString(text, font).Width;
        return (int)Math.Clamp(ProblemTextX + w + ProblemPadRight, ProblemMinWidth, ProblemMaxWidth);
    }

    // ---------------------------------------------------------------- layout
    //
    // All hit rectangles come from one place, so paint and mouse can never
    // disagree about where the buttons are.

    private float Scale => Height / (float)BaseHeight;

    private RectangleF CancelRect()
    {
        var s = Scale;
        return new RectangleF(7 * s, (Height - 30 * s) / 2f, 30 * s, 30 * s);
    }

    private RectangleF StopRect()
    {
        var s = Scale;
        return new RectangleF(Width - 37 * s, (Height - 30 * s) / 2f, 30 * s, 30 * s);
    }

    // ---------------------------------------------------------------- paint

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
        g.Clear(Ink950);
        var s = Scale;

        if (_mode == "problem")
        {
            DrawCancel(g, CancelRect());
            using var font = new Font("Segoe UI", 10.5f * s, GraphicsUnit.Pixel);
            using var brush = new SolidBrush(_hot == 2 ? Color.White : Paper50);
            // Left-aligned and ellipsised rather than centred and clipped: these
            // read as sentences, and the front of one is worth more than its
            // middle. Vertically centred by the format, since a single line
            // measured by hand drifts with the font's internal leading.
            using var format = new StringFormat(StringFormatFlags.NoWrap)
            {
                Trimming = StringTrimming.EllipsisCharacter,
                LineAlignment = StringAlignment.Center,
            };
            var box = new RectangleF(
                ProblemTextX * s, 0,
                Width - (ProblemTextX + ProblemPadRight) * s, Height);
            g.DrawString(_message, font, brush, box, format);
            return;
        }

        if (_mode == "transcribing")
        {
            // No clock, no dot and no check: nothing is being captured, so there
            // is no elapsed time worth reading and nothing left to confirm. The
            // X stays, because the transcript can still be thrown away, and that
            // is the one thing you might still want from this pill.
            DrawCancel(g, CancelRect());
            DrawBars(g, SweepBarX * s, Gilt300, sweep: true);
            return;
        }

        DrawCancel(g, CancelRect());

        // Pulsing dot, then the bars, then the clock, then the check.
        var dotX = DotX * s;
        var dotR = 5 * s;
        // A 1.6 s breath, matching the macOS pill's CALayer animation.
        var phase = (float)(_elapsed.Elapsed.TotalSeconds % 1.6 / 1.6);
        using (var ring = new SolidBrush(Color.FromArgb((int)(140 * (1 - phase)), Clay400)))
        {
            var rr = dotR * (1 + phase * 1.1f);
            g.FillEllipse(ring, dotX - rr, Height / 2f - rr, rr * 2, rr * 2);
        }
        using (var dot = new SolidBrush(Clay400))
        {
            g.FillEllipse(dot, dotX - dotR, Height / 2f - dotR, dotR * 2, dotR * 2);
        }

        DrawBars(g, BarX * s, Paper50, sweep: false);

        var t = (int)_elapsed.Elapsed.TotalSeconds;
        using (var font = new Font("Consolas", 11.5f * s, GraphicsUnit.Pixel))
        using (var brush = new SolidBrush(Ink300))
        {
            var text = $"{t / 60}:{t % 60:D2}";
            var size = g.MeasureString(text, font);
            g.DrawString(text, font, brush, ClockX * s, (Height - size.Height) / 2f);
        }

        DrawStop(g, StopRect());
    }

    /// <summary>One frame of the transcribing sweep. Eased toward the target
    /// rather than assigned, which is what carries the last thing you said into
    /// the animation instead of cutting to it.</summary>
    private void StepSweep()
    {
        var phase = (float)(_elapsed.Elapsed.TotalSeconds % SweepPeriod / SweepPeriod);
        // The head enters left of the first bar and leaves right of the last, so
        // the bump arrives and departs at the edges rather than wrapping from the
        // middle of the strip, which would be a jump every 1.15 s and would read
        // as a stutter rather than as work being done.
        //
        // It is not a full fade, and the numbers are worth having here rather than
        // being rediscovered: 0.18 of margin against a 0.28 sigma puts the leading
        // bar at alpha 199 of 255 the instant it enters, so it appears at about
        // three quarters brightness. Widening the margin past the sigma would fade
        // it properly, at the cost of a longer dead stretch at each end. Only one
        // 50 ms frame per crossing has both ends lit at once, which is why this
        // does not read as two bumps.
        var head = -0.18f + phase * 1.36f;
        for (int i = 0; i < Bars; i++)
        {
            var d = (i / (float)(Bars - 1) - head) / SweepSigma;
            var target = SweepFloor + (SweepPeak - SweepFloor) * (float)Math.Exp(-d * d);
            _bars[i] += (target - _bars[i]) * SweepEase;
        }
    }

    /// <summary>The bar strip, drawn from whatever is currently in `_bars`: the
    /// last 700 ms of your voice while recording, the sweep while transcribing.
    /// One routine for both, so the two states cannot drift into two waveforms
    /// that look like they came from different apps.</summary>
    private void DrawBars(Graphics g, float x0, Color tint, bool sweep)
    {
        var s = Scale;
        var barW = 2.5f * s;
        var barPitch = 5f * s;
        var barMax = 20 * s;
        for (int i = 0; i < Bars; i++)
        {
            var l = _bars[i];
            var h = Math.Max(3 * s, barMax * l);
            // Louder bars are brighter, so a loud passage reads at a glance even
            // if the height difference is small at this size. The sweep gets the
            // same treatment on a continuous ramp, which is what makes the bump
            // read as a moving highlight rather than a bulge in a flat line.
            var alpha = sweep
                ? (int)(90 + 165 * Math.Clamp((l - SweepFloor) / (SweepPeak - SweepFloor), 0f, 1f))
                : l > 0.55f ? 255 : l > 0.25f ? 190 : 115;
            using var brush = new SolidBrush(Color.FromArgb(alpha, tint));
            var rect = new RectangleF(x0 + i * barPitch, (Height - h) / 2f, barW, h);
            using var path = Rounded(rect, barW / 2f);
            g.FillPath(brush, path);
        }
    }

    private void DrawCancel(Graphics g, RectangleF r)
    {
        using (var bg = new SolidBrush(Color.FromArgb(_hot == 0 ? 54 : 28, Paper50)))
        {
            g.FillEllipse(bg, r);
        }
        using var pen = new Pen(_hot == 0 ? Paper50 : Ink300, 1.7f * Scale) { StartCap = LineCap.Round, EndCap = LineCap.Round };
        var pad = r.Width * 0.32f;
        g.DrawLine(pen, r.Left + pad, r.Top + pad, r.Right - pad, r.Bottom - pad);
        g.DrawLine(pen, r.Right - pad, r.Top + pad, r.Left + pad, r.Bottom - pad);
    }

    private void DrawStop(Graphics g, RectangleF r)
    {
        // Filled, unlike the X: this is the affirmative action and the one you
        // reach for without looking.
        using (var bg = new SolidBrush(_hot == 1 ? Color.White : Paper50))
        {
            g.FillEllipse(bg, r);
        }
        using var pen = new Pen(Ink950, 2f * Scale) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round };
        var cx = r.Left + r.Width / 2f;
        var cy = r.Top + r.Height / 2f;
        var u = r.Width * 0.19f;
        g.DrawLines(pen, new[]
        {
            new PointF(cx - u * 1.5f, cy),
            new PointF(cx - u * 0.35f, cy + u * 1.1f),
            new PointF(cx + u * 1.5f, cy - u * 1.1f),
        });
    }

    private static GraphicsPath Rounded(RectangleF r, float radius)
    {
        var path = new GraphicsPath();
        var d = Math.Min(radius * 2, Math.Min(r.Width, r.Height));
        if (d <= 0.01f) { path.AddRectangle(r); return path; }
        path.AddArc(r.Left, r.Top, d, d, 180, 90);
        path.AddArc(r.Right - d, r.Top, d, d, 270, 90);
        path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        path.AddArc(r.Left, r.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    // ---------------------------------------------------------------- mouse

    protected override void OnMouseMove(MouseEventArgs e)
    {
        var hot = HitTest(e.Location);
        if (hot != _hot)
        {
            _hot = hot;
            Cursor = hot >= 0 ? Cursors.Hand : Cursors.Default;
            Invalidate();
        }
        base.OnMouseMove(e);
    }

    protected override void OnMouseLeave(EventArgs e)
    {
        if (_hot != -1) { _hot = -1; Invalidate(); }
        base.OnMouseLeave(e);
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        if (e.Button == MouseButtons.Left)
        {
            var hit = HitTest(e.Location);
            if (hit == 0)
            {
                // On a message the X means "I have read it", not "throw the take
                // away". There is no take to throw away, and asking the web core
                // to cancel an idle state machine would be a message about
                // nothing.
                if (_mode == "problem") { _dismiss.Stop(); _mode = ""; Hide(); }
                else CancelClicked?.Invoke();
            }
            else if (hit == 1) StopClicked?.Invoke(); // HitTest only returns 1 while recording
            else if (hit == 2)
            {
                _dismiss.Stop();
                _mode = "";
                Hide();
                OpenRequested?.Invoke();
            }
        }
        base.OnMouseDown(e);
    }

    private int HitTest(Point p)
    {
        if (CancelRect().Contains(p)) return 0;
        if (_mode == "recording" && StopRect().Contains(p)) return 1;
        // The whole remaining body, not a button drawn inside it: the message is
        // already the smallest thing on screen, and a target inside a target at
        // this size is one nobody hits.
        if (_mode == "problem" && _openable) return 2;
        return -1;
    }

    protected override void WndProc(ref Message m)
    {
        // WS_EX_NOACTIVATE keeps the pill out of the activation order, but a
        // click on a top-level window still asks it whether it wants focus, and
        // the default answer is yes. Saying MA_NOACTIVATE is what lets the X be
        // clickable at all: without it, clicking the pill deactivates whatever
        // the user is dictating into, and the transcript would then paste into
        // the wrong window, or into nothing.
        const int WM_MOUSEACTIVATE = 0x0021;
        const int MA_NOACTIVATE = 3;
        if (m.Msg == WM_MOUSEACTIVATE)
        {
            m.Result = (IntPtr)MA_NOACTIVATE;
            return;
        }
        base.WndProc(ref m);
    }

    private void Place()
    {
        // Follow the monitor the user is actually on. Pinning this to the primary
        // screen puts the pill on the wrong display for anyone with two, which is
        // most Windows desks: you dictate into a window over here and the only
        // feedback that anything is happening appears over there.
        var area = Screen.FromPoint(Cursor.Position)?.WorkingArea
                   ?? Screen.PrimaryScreen?.WorkingArea
                   ?? new Rectangle(0, 0, 1280, 720);
        Location = new Point(area.Left + (area.Width - Width) / 2, area.Bottom - Height - 48);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) { _timer.Dispose(); _dismiss.Dispose(); }
        base.Dispose(disposing);
    }

    [DllImport("gdi32.dll")]
    private static extern IntPtr CreateRoundRectRgn(int l, int t, int r, int b, int w, int h);

    [DllImport("gdi32.dll")]
    private static extern bool DeleteObject(IntPtr hObject);
}
