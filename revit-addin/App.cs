using System.Reflection;
using System.Windows.Media.Imaging;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace BoxBimBridge
{
    /// <summary>
    /// Add-in do Revit que abre uma ponte HTTP local (127.0.0.1) para o BoxBim.
    /// Toda chamada à API do Revit é executada na thread principal via ExternalEvent.
    /// </summary>
    public class App : IExternalApplication
    {
        public const int DefaultPort = 48884;
        public static BridgeServer Server { get; private set; }

        public Result OnStartup(UIControlledApplication app)
        {
            var dispatcher = new RevitDispatcher();
            var port = DefaultPort;
            var envPort = Environment.GetEnvironmentVariable("BOXBIM_BRIDGE_PORT");
            if (int.TryParse(envPort, out var p) && p > 0) port = p;

            Server = new BridgeServer(port, dispatcher);
            Server.Start();

            try
            {
                const string tab = "BoxBim";
                try { app.CreateRibbonTab(tab); } catch { /* já existe */ }
                var panel = app.CreateRibbonPanel(tab, "Ponte");
                var data = new PushButtonData("BoxBimStatus", "BoxBim\nPonte",
                    Assembly.GetExecutingAssembly().Location, typeof(StatusCommand).FullName)
                {
                    ToolTip = $"Ponte BoxBim ativa em http://127.0.0.1:{port}/"
                };
                var icon = LoadIcon();
                if (icon != null) { data.LargeImage = icon; data.Image = icon; }
                panel.AddItem(data);
            }
            catch { /* a ribbon é opcional; a ponte continua funcionando */ }

            return Result.Succeeded;
        }

        public Result OnShutdown(UIControlledApplication app)
        {
            Server?.Stop();
            return Result.Succeeded;
        }

        private static BitmapImage LoadIcon()
        {
            var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("BoxBimBridge.icon32.png");
            if (stream == null) return null;
            var img = new BitmapImage();
            img.BeginInit();
            img.StreamSource = stream;
            img.CacheOption = BitmapCacheOption.OnLoad;
            img.EndInit();
            return img;
        }
    }

    [Transaction(TransactionMode.Manual)]
    public class StatusCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData data, ref string message, ElementSet elements)
        {
            var s = App.Server;
            var doc = data.Application.ActiveUIDocument?.Document;
            TaskDialog.Show("BoxBim",
                (s != null && s.IsRunning ? $"Ponte ativa em http://127.0.0.1:{s.Port}/" : "Ponte parada.") +
                $"\nRequisições atendidas: {s?.RequestCount ?? 0}" +
                $"\nDocumento ativo: {doc?.Title ?? "(nenhum)"}");
            return Result.Succeeded;
        }
    }
}
