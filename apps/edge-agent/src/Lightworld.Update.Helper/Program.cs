using System.Diagnostics;
using System.Text.Json;
using Lightworld.Update.Client;

namespace Lightworld.Update.Helper;

internal static class Program
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static async Task<int> Main(string[] args)
    {
        try
        {
            if (args.Length != 3 || !string.Equals(args[0], "apply", StringComparison.Ordinal) ||
                !string.Equals(args[1], "--plan", StringComparison.Ordinal))
            {
                Console.Error.WriteLine("Usage: Lightworld.Update.Helper apply --plan <absolute-plan-path>");
                return 2;
            }

            var planPath = Path.GetFullPath(args[2]);
            var plan = JsonSerializer.Deserialize<UpdatePlan>(await File.ReadAllTextAsync(planPath), JsonOptions)?.Normalize()
                ?? throw new InvalidDataException("Update plan is invalid.");

            await PackageVerifier.VerifyAsync(
                plan.StagedPackagePath,
                plan.ExpectedPackageSize,
                plan.ExpectedPackageSha256,
                CancellationToken.None).ConfigureAwait(false);

            var switcher = new AtomicInstallSwitcher(plan.InstallRoot);
            var candidate = await switcher.PrepareCandidateAsync(
                plan.StagedPackagePath,
                plan.HealthToken,
                CancellationToken.None).ConfigureAwait(false);
            await switcher.SwitchToCandidateAsync(candidate, CancellationToken.None).ConfigureAwait(false);

            var coordinator = new HealthRollbackCoordinator(plan.InstallRoot);
            var healthy = await coordinator.LaunchAndConfirmAsync(plan, info => Process.Start(info), CancellationToken.None)
                .ConfigureAwait(false);
            return healthy ? 0 : 1;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"Update apply failed: {error.GetType().Name}");
            return 1;
        }
    }
}
