using IOException = System.IO.IOException;
using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Autodesk.Revit.UI;

namespace BoxBimBridge
{
    /// <summary>
    /// Servidor HTTP mínimo sobre TcpListener (127.0.0.1 apenas) — não exige reserva de URL
    /// nem privilégio de administrador, ao contrário do HttpListener.
    /// </summary>
    public class BridgeServer
    {
        private readonly RevitDispatcher _dispatcher;
        private TcpListener _listener;
        private CancellationTokenSource _cts;

        public int Port { get; }
        public bool IsRunning { get; private set; }
        public int RequestCount;

        public BridgeServer(int port, RevitDispatcher dispatcher)
        {
            Port = port;
            _dispatcher = dispatcher;
        }

        public void Start()
        {
            _cts = new CancellationTokenSource();
            _listener = new TcpListener(IPAddress.Loopback, Port);
            try { _listener.Start(); IsRunning = true; }
            catch (SocketException) { IsRunning = false; return; }
            _ = Task.Run(() => AcceptLoop(_cts.Token));
        }

        public void Stop()
        {
            IsRunning = false;
            _cts?.Cancel();
            try { _listener?.Stop(); } catch { }
        }

        private async Task AcceptLoop(CancellationToken ct)
        {
            while (!ct.IsCancellationRequested)
            {
                TcpClient client;
                try { client = await _listener.AcceptTcpClientAsync(ct); }
                catch { break; }
                _ = Task.Run(() => Handle(client));
            }
        }

        private async Task Handle(TcpClient client)
        {
            using (client)
            {
                var stream = client.GetStream();
                string method = "", path = "";
                string body = "";
                try
                {
                    (method, path, body) = await ReadRequest(stream);
                    Interlocked.Increment(ref RequestCount);

                    if (method == "OPTIONS") { await Write(stream, 204, ""); return; }

                    var req = string.IsNullOrWhiteSpace(body) ? new JsonObject() : JsonNode.Parse(body) as JsonObject ?? new JsonObject();
                    var route = path.Split('?')[0].TrimEnd('/').ToLowerInvariant();
                    if (route == "") route = "/status";

                    var result = await _dispatcher.Run(uiapp => Commands.Dispatch(uiapp, route, req), TimeSpan.FromMinutes(30));
                    await Write(stream, 200, JsonSerializer.Serialize(result));
                }
                catch (Exception ex)
                {
                    var err = new JsonObject { ["ok"] = false, ["error"] = ex.GetBaseException().Message };
                    try { await Write(stream, 500, err.ToJsonString()); } catch { }
                }
            }
        }

        private static async Task<(string, string, string)> ReadRequest(NetworkStream stream)
        {
            var buffer = new List<byte>();
            var tmp = new byte[8192];
            int headerEnd = -1;
            while (headerEnd < 0)
            {
                int n = await stream.ReadAsync(tmp);
                if (n <= 0) throw new IOException("Conexão encerrada");
                buffer.AddRange(tmp.AsSpan(0, n).ToArray());
                headerEnd = IndexOf(buffer, "\r\n\r\n"u8.ToArray());
                if (buffer.Count > 1 << 20 && headerEnd < 0) throw new IOException("Cabeçalho grande demais");
            }
            var header = Encoding.ASCII.GetString(buffer.GetRange(0, headerEnd).ToArray());
            var lines = header.Split("\r\n");
            var first = lines[0].Split(' ');
            int contentLength = 0;
            foreach (var l in lines.Skip(1))
            {
                var i = l.IndexOf(':');
                if (i > 0 && l[..i].Trim().Equals("Content-Length", StringComparison.OrdinalIgnoreCase))
                    int.TryParse(l[(i + 1)..].Trim(), out contentLength);
            }
            var bodyBytes = buffer.Skip(headerEnd + 4).ToList();
            while (bodyBytes.Count < contentLength)
            {
                int n = await stream.ReadAsync(tmp);
                if (n <= 0) break;
                bodyBytes.AddRange(tmp.AsSpan(0, n).ToArray());
            }
            return (first[0].ToUpperInvariant(), first.Length > 1 ? first[1] : "/", Encoding.UTF8.GetString(bodyBytes.ToArray()));
        }

        private static int IndexOf(List<byte> data, byte[] pattern)
        {
            for (int i = 0; i <= data.Count - pattern.Length; i++)
            {
                int j = 0;
                while (j < pattern.Length && data[i + j] == pattern[j]) j++;
                if (j == pattern.Length) return i;
            }
            return -1;
        }

        private static async Task Write(NetworkStream stream, int status, string json)
        {
            var body = Encoding.UTF8.GetBytes(json);
            var reason = status switch { 200 => "OK", 204 => "No Content", _ => "Error" };
            var head = $"HTTP/1.1 {status} {reason}\r\nContent-Type: application/json; charset=utf-8\r\n" +
                       $"Content-Length: {body.Length}\r\nAccess-Control-Allow-Origin: *\r\n" +
                       "Access-Control-Allow-Headers: Content-Type\r\nConnection: close\r\n\r\n";
            await stream.WriteAsync(Encoding.ASCII.GetBytes(head));
            await stream.WriteAsync(body);
        }
    }

    /// <summary>Fila de trabalhos executados no contexto de API válido do Revit.</summary>
    public class RevitDispatcher : IExternalEventHandler
    {
        private readonly ConcurrentQueue<(Func<UIApplication, object> work, TaskCompletionSource<object> tcs)> _queue = new();
        private readonly ExternalEvent _event;

        public RevitDispatcher() { _event = ExternalEvent.Create(this); }

        public async Task<object> Run(Func<UIApplication, object> work, TimeSpan timeout)
        {
            var tcs = new TaskCompletionSource<object>(TaskCreationOptions.RunContinuationsAsynchronously);
            _queue.Enqueue((work, tcs));
            _event.Raise();
            var done = await Task.WhenAny(tcs.Task, Task.Delay(timeout));
            if (done != tcs.Task) throw new TimeoutException("O Revit não respondeu (está ocupado ou com uma caixa de diálogo aberta?).");
            return await tcs.Task;
        }

        public void Execute(UIApplication app)
        {
            while (_queue.TryDequeue(out var job))
            {
                try { job.tcs.SetResult(job.work(app)); }
                catch (Exception ex) { job.tcs.SetException(ex); }
            }
        }

        public string GetName() => "BoxBim Bridge";
    }
}
