namespace Tiro.Windows;

/// <summary>
/// The version stamped into the EXE by Version.props, as "1.2.0". Shown on the
/// tray tooltip and handed to the web core so the About card can name the build
/// somebody is actually running when they report a problem.
/// </summary>
static class Build
{
    public static readonly string Version =
        typeof(Build).Assembly.GetName().Version?.ToString(3) ?? "0.0.0";
}
