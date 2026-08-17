using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace Tiro.Windows;

/// <summary>
/// Everything the app needs to run, carried inside the EXE.
///
/// This used to be loose files: the csproj copied web/ and Assets/ next to the
/// binary, and the download was a ZIP because there was no other honest way to
/// hand someone twenty-seven files. That ZIP is what made Windows feel like a
/// temporary file. Explorer runs an EXE out of a ZIP by extracting it to %TEMP%,
/// so the app people had "installed" lived in a folder Windows deletes, could not
/// be pinned to the taskbar in any way that survived a reboot, and had to be
/// re-extracted every time.
///
/// So the web core and the tray icons are embedded resources now, and the
/// download is one file you can put wherever you like.
///
/// The icons are read straight from the assembly. The web core cannot be:
/// WebView2's SetVirtualHostNameToFolderMapping needs a real directory, which is
/// what gives the app a secure origin, and with it getUserMedia, the AudioWorklet
/// and the service worker behaving exactly as they do on the deployed site.
/// Serving the resources over WebResourceRequested instead would avoid the disk
/// entirely, but it changes how every request in the app is answered, including
/// the ones the service worker makes on its own, so it is not a swap to make
/// blind. Extracting keeps WebView2's behaviour identical to what shipped.
/// </summary>
static class Resources
{
    private const string WebPrefix = "web/";
    private const string AssetPrefix = "Assets/";
    private const string LoaderResource = "native/WebView2Loader.dll";

    private static readonly Assembly Self = typeof(Resources).Assembly;

    /// <summary>
    /// Local, not roaming. Log.AppDataDir is %APPDATA% because settings and
    /// history are worth carrying between machines; a copy of the web core that
    /// the EXE can rebuild in a millisecond is not, and a roaming profile that
    /// syncs it is just slower for no gain.
    /// </summary>
    private static readonly string LocalDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Tiro");

    public static readonly string WebRoot = Path.Combine(LocalDir, "web");

    private static readonly string StampPath = Path.Combine(LocalDir, "web.stamp");

    private static readonly string LoaderPath =
        Path.Combine(LocalDir, "native", "WebView2Loader.dll");

    /// <summary>A tray or window icon, or null if it is missing, which is not
    /// worth taking the app down over: callers fall back to a system icon.</summary>
    public static Icon? LoadIcon(string fileName)
    {
        try
        {
            using var stream = Self.GetManifestResourceStream(AssetPrefix + fileName);
            if (stream == null)
            {
                Log.Write($"icon {fileName} is not embedded in this build");
                return null;
            }
            return new Icon(stream);
        }
        catch (Exception ex)
        {
            Log.Write($"icon {fileName} failed to load: {ex.Message}");
            return null;
        }
    }

    /// <summary>
    /// WebView2's native loader, on disk and loaded into this process before
    /// anything touches WebView2.
    ///
    /// The web core and the icons are streams the app reads. This one cannot be:
    /// Microsoft.Web.WebView2 asks Windows for "WebView2Loader.dll" by bare name,
    /// and the search that answers looks beside the EXE, which for a one file
    /// download is a folder holding one file that is not this DLL. Putting it
    /// under runtimes\win-x64\native beside the EXE does not answer it either;
    /// only a copy sitting directly next to the EXE does, and that is the second
    /// file the download is trying not to have.
    ///
    /// So it is embedded (see the csproj), written here, and loaded by its full
    /// path. Loading it by path is the whole trick: Windows then resolves the
    /// later call for "WebView2Loader.dll" to the module already in the process
    /// rather than searching the disk again.
    /// </summary>
    public static void EnsureNativeLoader()
    {
        try
        {
            using var stream = Self.GetManifestResourceStream(LoaderResource);
            if (stream == null)
            {
                // The build is broken rather than the machine. Say so plainly: the
                // symptom otherwise is a window that never paints.
                Log.Write("WebView2's native loader is not embedded in this build");
                return;
            }

            var want = new byte[stream.Length];
            stream.ReadExactly(want);

            // Compared by content, not by version, for the same reason the web
            // core is: a loader left by an older build must not go on being
            // loaded by a newer one, and there is no version number to read
            // without loading the file first.
            if (!IsAlready(LoaderPath, want))
            {
                try
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(LoaderPath)!);
                    File.WriteAllBytes(LoaderPath, want);
                }
                catch (Exception ex) when (File.Exists(LoaderPath))
                {
                    // Another Tiro has this file mapped, so it cannot be replaced
                    // while that one lives. The copy on disk is a working loader
                    // either way, and refusing to load it would take this process
                    // down over a file it does not need to write.
                    Log.Write($"kept the existing WebView2 loader: {ex.Message}");
                }
            }

            NativeLibrary.Load(LoaderPath);
        }
        catch (Exception ex)
        {
            Log.Write($"could not load WebView2's native loader: {ex.Message}");
        }
    }

    /// <summary>Is this exact byte sequence already the file at this path?</summary>
    private static bool IsAlready(string path, byte[] want)
    {
        try
        {
            var info = new FileInfo(path);
            if (!info.Exists || info.Length != want.Length) return false;
            return File.ReadAllBytes(path).AsSpan().SequenceEqual(want);
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// The directory to hand WebView2, extracting the embedded copy first if what
    /// is on disk is not already exactly it.
    /// </summary>
    public static string EnsureWebRoot()
    {
        var names = Self.GetManifestResourceNames()
            .Where(n => n.StartsWith(WebPrefix, StringComparison.Ordinal))
            .OrderBy(n => n, StringComparer.Ordinal)
            .ToArray();

        if (names.Length == 0)
        {
            // Nothing to serve means a blank window and no clue why, so say it
            // out loud. The self-test asserts this can never ship.
            Log.Write("no web core is embedded in this build; the window will be empty");
            return WebRoot;
        }

        var want = Fingerprint(names);
        try
        {
            if (Directory.Exists(WebRoot) && File.Exists(StampPath) &&
                File.ReadAllText(StampPath).Trim() == want)
            {
                return WebRoot;
            }
        }
        catch (Exception ex)
        {
            Log.Write($"could not read the web core stamp, re-extracting: {ex.Message}");
        }

        Extract(names, want);
        return WebRoot;
    }

    private static void Extract(string[] names, string fingerprint)
    {
        Log.Write($"extracting the web core: {names.Length} files to {WebRoot}");
        try
        {
            Directory.CreateDirectory(WebRoot);

            // The stamp goes first, not last, because a crash halfway through the
            // loop below would otherwise leave a valid stamp sitting on top of a
            // half-written tree, and every launch after that would trust it.
            if (File.Exists(StampPath)) File.Delete(StampPath);

            var written = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var name in names)
            {
                var relative = RelativePath(name);
                var target = Path.Combine(WebRoot, relative);
                Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                using (var source = Self.GetManifestResourceStream(name)!)
                using (var file = File.Create(target))
                {
                    source.CopyTo(file);
                }
                written.Add(Path.GetFullPath(target));
            }

            // A downgrade, or a release that dropped a file, would otherwise leave
            // the old one on disk where the service worker can still cache it.
            // ToArray, not the lazy enumerable: deleting out from under
            // EnumerateFiles is undefined and skipped files at random.
            foreach (var stale in Directory.GetFiles(WebRoot, "*", SearchOption.AllDirectories))
            {
                if (written.Contains(Path.GetFullPath(stale))) continue;
                try { File.Delete(stale); } catch { }
            }

            File.WriteAllText(StampPath, fingerprint);
        }
        catch (Exception ex)
        {
            // Leave the stamp absent so the next launch tries again rather than
            // serving whatever this attempt managed to write.
            Log.Write($"extracting the web core failed: {ex.Message}");
        }
    }

    /// <summary>
    /// "web/src\app.js" (MSBuild's RecursiveDir keeps the platform separator) to
    /// "src\app.js". Normalised on the way out so the name is comparable whatever
    /// the machine that built it used.
    /// </summary>
    private static string RelativePath(string logicalName) =>
        logicalName.Substring(WebPrefix.Length).Replace('/', Path.DirectorySeparatorChar)
                                               .Replace('\\', Path.DirectorySeparatorChar);

    /// <summary>
    /// Content, not the version number. Stamping the version would be cheaper and
    /// wrong in the one case that costs a working day: editing web/ during
    /// development without bumping VERSION, where every launch would keep serving
    /// the previous extraction and the change would look like it did nothing.
    /// The whole core is under 200 KB, so hashing it is not worth optimising.
    /// </summary>
    private static string Fingerprint(string[] names)
    {
        using var sha = SHA256.Create();
        using var sink = new CryptoStream(Stream.Null, sha, CryptoStreamMode.Write);
        foreach (var name in names)
        {
            sink.Write(Encoding.UTF8.GetBytes(name + "\n"));
            using var stream = Self.GetManifestResourceStream(name)!;
            stream.CopyTo(sink);
        }
        sink.FlushFinalBlock();
        return Convert.ToHexString(sha.Hash!);
    }

    /// <summary>How many files this build carries, for the self-test.</summary>
    public static int EmbeddedWebFileCount() =>
        Self.GetManifestResourceNames().Count(n => n.StartsWith(WebPrefix, StringComparison.Ordinal));

    /// <summary>
    /// Is this file carried in the EXE? Separators are normalised on both sides
    /// because MSBuild's RecursiveDir uses the build machine's, so the name of a
    /// nested resource is "web/src\app.js" rather than anything you would write.
    /// </summary>
    public static bool HasEmbedded(string logicalName)
    {
        var want = logicalName.Replace('\\', '/');
        return Self.GetManifestResourceNames()
            .Any(n => string.Equals(n.Replace('\\', '/'), want, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// Everything in here is rebuildable from the EXE, so uninstall deletes it
    /// without asking. User data lives in Log.AppDataDir and is a separate
    /// question, asked separately (Setup.Uninstall).
    /// </summary>
    public static string CacheDir => LocalDir;
}
