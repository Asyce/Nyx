namespace Nyx.Desktop.Core.AccountStatus;

public enum WuWaAccountStatusFailure
{
    None,
    CacheNotFound,
    CacheMalformed,
    MultipleAccounts,
    PlayerInfoRejected,
    RoleRejected,
    InvalidResponse,
    ResponseTooLarge,
    Timeout,
    Network,
    Canceled,
    RateLimited,
    Shutdown,
}

public sealed record WuWaAccountStatusSnapshot(
    int Energy,
    int MaxEnergy,
    int StoreEnergy,
    long StoreEnergyRecoverTime,
    long EnergyRecoverTime,
    int Liveness,
    int LivenessMaxCount);

public sealed record WuWaAccountStatusResult(
    DateTimeOffset CheckedAt,
    WuWaAccountStatusFailure Failure,
    WuWaAccountStatusSnapshot? Snapshot,
    DateTimeOffset? SuccessfulAt,
    bool IsStale)
{
    public bool IsSuccess => Failure is WuWaAccountStatusFailure.None && Snapshot is not null;
}
