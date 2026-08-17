using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;

namespace Tiro.Windows;

/// <summary>
/// "There is a newer Tiro than the one you are running."
///
/// A portable app that nothing installs is also a portable app that nothing
/// updates: without this, the only way to learn that a release fixed the bug
/// you have been living with is to go and look. So once a week, at most, Tiro
/// asks GitHub for the latest release tag and compares it with its own version.
///
/// What that request carries matters, because this project promises no
/// telemetry and this is the only outbound call it makes that is not dictation:
///
///   - It is an anonymous GET of a public URL — the same one a browser opening
///     the releases page fetches. No account, no device or install ID, no usage,
///     nothing about what you dictate.
///   - The User-Agent names the app and version, because GitHub rejects API
///     requests without one. That is the whole of what it says about you, and
///     GitHub sees it alongside an IP address, exactly as it would if you opened
///     the page yourself.
///   - Nothing is sent back to us. There is no "us" to send it to: this app has
///     no server, and the check reads a public endpoint rather than reporting in.
///   - It can be turned off in the tray menu, and off is remembered.
///
/// Failures are silent by design. Being offline, or GitHub being rate-limited,
/// is not something to interrupt someone's dictation about.
/// </summary>
static class UpdateCheck
{
    private const string LatestReleaseApi =
        "https://api.github.com/repos/mypip-io/tiro/releases/latest";

    public const string ReleasesPage =
        "https://github.com/mypip-io/tiro/releases/latest";

    /// <summary>Weekly. Often enough to hear about a fix, rare enough not to be a heartbeat.</summary>
    public static readonly TimeSpan Interval = TimeSpan.FromDays(7);

    /// <summary>
    /// After a check that did not reach GitHub, wait this long rather than the
    /// full week. Only a *successful* check resets the weekly clock — a fortnight
    /// offline must not cost a fortnight of checks — but without a floor, an app
    /// that is opened twenty times a day behind a rate-limited or blocked
    /// connection would make twenty requests a day, which is neither polite nor
    /// going to work any better on the twentieth attempt.
    /// </summary>
    public static readonly TimeSpan RetryAfterFailure = TimeSpan.FromHours(6);

    private static readonly HttpClient Http = CreateClient();

    private static HttpClient CreateClient()
    {
        var http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
        http.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("Tiro", Build.Version));
        http.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        return http;
    }

    /// <summary>
    /// The latest published version, as "1.2.0", or null if the check could not
    /// be made or the answer could not be understood.
    /// </summary>
    public static async Task<string?> LatestVersionAsync(CancellationToken cancel = default)
    {
        try
        {
            using var response = await Http.GetAsync(LatestReleaseApi, cancel).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
            {
                Log.Write($"update check: GitHub answered {(int)response.StatusCode}");
                return null;
            }
            var json = await response.Content.ReadAsStringAsync(cancel).ConfigureAwait(false);
            using var doc = JsonDocument.Parse(json);
            if (!doc.RootElement.TryGetProperty("tag_name", out var tag)) return null;
            var name = tag.GetString();
            if (string.IsNullOrWhiteSpace(name)) return null;
            return name.TrimStart('v', 'V').Trim();
        }
        catch (Exception ex)
        {
            // offline, rate-limited, DNS gone, proxy in the way: all the same here
            Log.Write($"update check failed: {ex.Message}");
            return null;
        }
    }

    /// <summary>
    /// Is <paramref name="candidate"/> a later version than <paramref name="current"/>?
    /// Compared field by field as numbers, so 1.10.0 beats 1.9.0 — which string
    /// comparison gets backwards, and which is the bug every hand-rolled version
    /// check has. Anything unparseable is treated as "not newer": a release named
    /// something unexpected must not nag every user every week.
    /// </summary>
    public static bool IsNewer(string? candidate, string? current)
    {
        var a = Parse(candidate);
        var b = Parse(current);
        if (a == null || b == null) return false;
        for (var i = 0; i < 3; i++)
        {
            if (a[i] != b[i]) return a[i] > b[i];
        }
        return false;
    }

    /// <summary>How much of an interruption a release is worth.</summary>
    public enum Worth
    {
        /// <summary>Not an update at all, or older than what is running.</summary>
        None,
        /// <summary>A fix. Tray menu and tooltip only; never a balloon or a banner.</summary>
        Quiet,
        /// <summary>Enough fixes have piled up to be worth saying once.</summary>
        Fixes,
        /// <summary>Something was added or the interface changed. Say it once.</summary>
        Feature,
    }

    /// <summary>Two or more patches behind stops being "a typo got fixed".</summary>
    private const int PatchPileUp = 2;

    /// <summary>
    /// Whether to interrupt someone over this release, decided from the number
    /// itself — which is meaningful because the release rules make it so: the
    /// middle number moves when something is added or the interface changes, the
    /// last when a fix is the whole story.
    ///
    ///   1.2.0 -> 1.3.0   Feature. Worth one interruption.
    ///   1.2.0 -> 1.2.1   Quiet. It is in the tray menu for anyone who looks.
    ///   1.2.0 -> 1.2.3   Fixes. Several things you are missing, so say it once.
    ///
    /// The web core applies the identical test, so the app and the shell cannot
    /// disagree about what deserves a banner.
    /// </summary>
    public static Worth Classify(string? candidate, string? current)
    {
        var a = Parse(candidate);
        var b = Parse(current);
        if (a == null || b == null) return Worth.None;
        if (a[0] != b[0]) return a[0] > b[0] ? Worth.Feature : Worth.None;
        if (a[1] != b[1]) return a[1] > b[1] ? Worth.Feature : Worth.None;
        if (a[2] <= b[2]) return Worth.None;
        return a[2] - b[2] >= PatchPileUp ? Worth.Fixes : Worth.Quiet;
    }

    private static int[]? Parse(string? version)
    {
        if (string.IsNullOrWhiteSpace(version)) return null;
        var parts = version.Trim().TrimStart('v', 'V').Split('.');
        if (parts.Length != 3) return null;
        var numbers = new int[3];
        for (var i = 0; i < 3; i++)
        {
            if (!int.TryParse(parts[i], out numbers[i]) || numbers[i] < 0) return null;
        }
        return numbers;
    }
}
