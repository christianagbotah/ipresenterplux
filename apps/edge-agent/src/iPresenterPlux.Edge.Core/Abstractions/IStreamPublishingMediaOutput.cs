namespace iPresenterPlux.Edge.Core.Abstractions;

public interface IStreamPublishingMediaOutput
{
    IMasterStreamPublisher StreamPublisher { get; }
}
