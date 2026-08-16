using System.Security.Cryptography;
using System.Text;

namespace Tiro.Windows;

/// <summary>
/// Deepgram API key at rest, encrypted with DPAPI (current-user scope).
/// Better than upstream's chmod-600 file and the PWA's browser storage,
/// and cheap on Windows (SPEC-WINDOWS 4.4).
/// </summary>
static class KeyStore
{
    private static readonly string KeyPath = Path.Combine(Log.AppDataDir, "key.bin");
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("tiro-deepgram-key");

    public static string Load()
    {
        try
        {
            if (!File.Exists(KeyPath)) return "";
            var blob = File.ReadAllBytes(KeyPath);
            return Encoding.UTF8.GetString(ProtectedData.Unprotect(blob, Entropy, DataProtectionScope.CurrentUser));
        }
        catch (Exception ex)
        {
            Log.Write($"KeyStore.Load failed: {ex.Message}");
            return "";
        }
    }

    public static void Save(string key)
    {
        try
        {
            Directory.CreateDirectory(Log.AppDataDir);
            if (string.IsNullOrEmpty(key))
            {
                if (File.Exists(KeyPath)) File.Delete(KeyPath);
                return;
            }
            var blob = ProtectedData.Protect(Encoding.UTF8.GetBytes(key), Entropy, DataProtectionScope.CurrentUser);
            File.WriteAllBytes(KeyPath, blob);
        }
        catch (Exception ex)
        {
            Log.Write($"KeyStore.Save failed: {ex.Message}");
        }
    }
}
