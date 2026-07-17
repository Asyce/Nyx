using System.Text.Json;
using Nyx.Desktop.ReadOnlyPilot;

if (!PilotCommand.TryParse(args, out var request))
{
    Console.Error.WriteLine("Usage: Nyx.Desktop.ReadOnlyPilot --game <wuwa|ae> --root <install-root>");
    return 2;
}

try
{
    var output = PilotCommand.Inspect(request!);
    Console.WriteLine(JsonSerializer.Serialize(output));
    return 0;
}
catch (Exception)
{
    Console.Error.WriteLine("Inspection failed safely.");
    return 3;
}
