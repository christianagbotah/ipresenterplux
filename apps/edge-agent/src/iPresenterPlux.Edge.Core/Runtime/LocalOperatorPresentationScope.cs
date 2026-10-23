namespace iPresenterPlux.Edge.Core.Runtime;

public static class LocalOperatorPresentationScope
{
    public static readonly Guid RehearsalServiceId = Guid.Parse("5f89b481-2787-4d09-9e40-2dbf39f9a951");

    public static Guid Resolve(Guid? activeServiceId) =>
        activeServiceId is { } serviceId && serviceId != Guid.Empty ? serviceId : RehearsalServiceId;

    public static bool IsRehearsal(Guid serviceId) => serviceId == RehearsalServiceId;
}
