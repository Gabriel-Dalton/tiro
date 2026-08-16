namespace Tiro.Windows;

/// <summary>
/// Small always-on-top status pill near the bottom of the screen while
/// recording or transcribing, matching the macOS one. It never takes focus,
/// the user is mid-keystroke in another app.
/// </summary>
sealed class RecordingPill : Form
{
    private readonly Label _label = new();
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 250 };
    private DateTime _startedAt;
    private string _mode = "";

    public RecordingPill()
    {
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        BackColor = Color.FromArgb(20, 17, 11);   // ink-950
        ForeColor = Color.FromArgb(252, 250, 244); // paper-50
        Width = 240;
        Height = 44;

        _label.Dock = DockStyle.Fill;
        _label.TextAlign = ContentAlignment.MiddleCenter;
        _label.Font = new Font("Segoe UI", 10.5f);
        Controls.Add(_label);

        _timer.Tick += (_, _) =>
        {
            if (_mode == "recording")
            {
                var t = (int)(DateTime.UtcNow - _startedAt).TotalSeconds;
                _label.Text = $"●  Recording  {t / 60}:{t % 60:D2}";
            }
        };

        // The rounded corners have to be recut whenever the form's real size
        // changes. The app is PerMonitorV2 DPI-aware, so on a 150% display
        // WinForms scales this form to 360x66 while Width/Height above still
        // read 240x44. A region cut once in the constructor would clip a third
        // of the pill off, and would clip again when it moves to another monitor.
        Resize += (_, _) => ApplyRoundedCorners();
        DpiChanged += (_, _) => ApplyRoundedCorners();
        ApplyRoundedCorners();
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

    public void ShowState(string state)
    {
        _mode = state;
        if (state == "recording")
        {
            _startedAt = DateTime.UtcNow;
            _label.ForeColor = Color.FromArgb(200, 90, 76); // clay-400
            _label.Text = "●  Recording  0:00";
            _timer.Start();
            Place();
            Show();
        }
        else if (state == "transcribing")
        {
            _timer.Stop();
            _label.ForeColor = Color.FromArgb(252, 250, 244);
            _label.Text = "Transcribing…";
            Place();
            Show();
        }
        else
        {
            _timer.Stop();
            Hide();
        }
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

    [System.Runtime.InteropServices.DllImport("gdi32.dll")]
    private static extern IntPtr CreateRoundRectRgn(int l, int t, int r, int b, int w, int h);

    [System.Runtime.InteropServices.DllImport("gdi32.dll")]
    private static extern bool DeleteObject(IntPtr hObject);
}
