namespace Tiro.Windows;

static class Log
{
    public static readonly string AppDataDir =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Tiro");

    private static readonly string LogPath = Path.Combine(AppDataDir, "tiro.log");
    private static readonly object Gate = new();

    public static void Write(string message)
    {
        try
        {
            lock (Gate)
            {
                Directory.CreateDirectory(AppDataDir);
                File.AppendAllText(LogPath, $"{DateTime.UtcNow:yyyy-MM-ddTHH:mm:ssZ} {message}{Environment.NewLine}");
            }
        }
        catch
        {
            // logging must never take the app down
        }
    }

    public static string PathOnDisk => LogPath;
}
