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

    // Design geometry, in logical units against a 44 unit tall pill. Everything
    // drawn is scaled from the form's real height, so one set of numbers holds
    // at 100%, 150% and 200% without a second table.
    private const int BaseHeight = 44;
    private const int RecordingWidth = 268;
    private const int TranscribingWidth = 232;
    private const int Bars = 14;

    /// <summary>The X was clicked: throw the take away.</summary>
    public event Action? CancelClicked;

    /// <summary>The check was clicked: finish the take now.</summary>
    public event Action? StopClicked;

    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 50 };
    private readonly float[] _bars = new float[Bars];
    private DateTime _startedAt;
    private string _mode = "";
    private float _level;
    private int _hot = -1;      // 0 = cancel, 1 = stop, -1 = neither
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
            if (_mode != "recording") return;
            // Shift one bar in per tick, so the strip is a 700 ms window of your
            // voice scrolling leftward rather than 14 copies of the same number.
            Array.Copy(_bars, 1, _bars, 0, Bars - 1);
            _bars[Bars - 1] = Math.Clamp(_level, 0.08f, 1f);
            Invalidate();
        };

        // The rounded corners have to be recut whenever the form's real size
        // changes (WIN-06). The app is PerMonitorV2 DPI-aware, so the same pill
        // is 268x44 on one monitor and 402x66 on the 150% one next to it. A
        // region cut once in the constructor would clip a third of the pill off,
        // and would clip again the moment it moved between them.
        Resize += (_, _) => ApplyRoundedCorners();
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
        _mode = state;
        _hot = -1;
        if (state == "recording")
        {
            _startedAt = DateTime.UtcNow;
            Array.Fill(_bars, 0.08f);
            _level = 0;
            ApplySize(RecordingWidth);
            _timer.Start();
            Place();
            Show();
        }
        else if (state == "transcribing")
        {
            _timer.Stop();
            ApplySize(TranscribingWidth);
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

        if (_mode == "transcribing")
        {
            // No clock and no waveform: nothing is being captured any more. The
            // X stays, because the transcript can still be thrown away.
            DrawCancel(g, CancelRect());
            using var font = new Font("Segoe UI", 10.5f * s, GraphicsUnit.Pixel);
            using var brush = new SolidBrush(Paper50);
            var text = "Transcribing…";
            var size = g.MeasureString(text, font);
            g.DrawString(text, font, brush, (Width - size.Width) / 2f + 8 * s, (Height - size.Height) / 2f);
            return;
        }

        DrawCancel(g, CancelRect());

        // Pulsing dot, then the bars, then the clock, then the check.
        var dotX = 44 * s;
        var dotR = 5 * s;
        // A 1.6 s breath, matching the macOS pill's CALayer animation.
        var phase = (float)((DateTime.UtcNow - _startedAt).TotalSeconds % 1.6 / 1.6);
        using (var ring = new SolidBrush(Color.FromArgb((int)(140 * (1 - phase)), Clay400)))
        {
            var rr = dotR * (1 + phase * 1.1f);
            g.FillEllipse(ring, dotX - rr, Height / 2f - rr, rr * 2, rr * 2);
        }
        using (var dot = new SolidBrush(Clay400))
        {
            g.FillEllipse(dot, dotX - dotR, Height / 2f - dotR, dotR * 2, dotR * 2);
        }

        var barX = 60 * s;
        var barW = 2.5f * s;
        var barPitch = 5f * s;
        var barMax = 20 * s;
        for (int i = 0; i < Bars; i++)
        {
            var l = _bars[i];
            var h = Math.Max(3 * s, barMax * l);
            // Louder bars are brighter, so a loud passage reads at a glance even
            // if the height difference is small at this size.
            var alpha = l > 0.55f ? 255 : l > 0.25f ? 190 : 115;
            using var brush = new SolidBrush(Color.FromArgb(alpha, Paper50));
            var rect = new RectangleF(barX + i * barPitch, (Height - h) / 2f, barW, h);
            using var path = Rounded(rect, barW / 2f);
            g.FillPath(brush, path);
        }

        var t = (int)(DateTime.UtcNow - _startedAt).TotalSeconds;
        using (var font = new Font("Consolas", 11.5f * s, GraphicsUnit.Pixel))
        using (var brush = new SolidBrush(Ink300))
        {
            var text = $"{t / 60}:{t % 60:D2}";
            var size = g.MeasureString(text, font);
            g.DrawString(text, font, brush, barX + Bars * barPitch + 8 * s, (Height - size.Height) / 2f);
        }

        DrawStop(g, StopRect());
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
            if (hit == 0) CancelClicked?.Invoke();
            else if (hit == 1) StopClicked?.Invoke(); // HitTest only returns 1 while recording
        }
        base.OnMouseDown(e);
    }

    private int HitTest(Point p)
    {
        if (CancelRect().Contains(p)) return 0;
        if (_mode == "recording" && StopRect().Contains(p)) return 1;
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
        if (disposing) _timer.Dispose();
        base.Dispose(disposing);
    }

    [DllImport("gdi32.dll")]
    private static extern IntPtr CreateRoundRectRgn(int l, int t, int r, int b, int w, int h);

    [DllImport("gdi32.dll")]
    private static extern bool DeleteObject(IntPtr hObject);
}
