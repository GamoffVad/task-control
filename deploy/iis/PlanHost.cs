// Модуль IIS для «Контроля задач» в корпоративной сети без интернета.
// Нужен только встроенный компонент Windows «ASP.NET 4.x» — без URL Rewrite, ARR, HttpPlatformHandler и iisnode.
//   • запускает сервер API (App_Data\node\node.exe App_Data\server\server.cjs) на 127.0.0.1 и перезапускает его при сбое;
//   • проксирует /api/* на этот сервер; для /api/windows-login передаёт логин, подтверждённый Windows-аутентификацией IIS;
//   • адреса приложения без расширения (/calendar, /control…) отдаёт как index.html — маршруты одностраничного приложения.
// Настройки — appSettings в web.config: ключи «env:ИМЯ» становятся переменными окружения сервера API.
// Синтаксис — C# 5, чтобы сборку компилировал csc.exe из .NET Framework 4.x, имеющийся в любой Windows.
using System;
using System.Collections.Generic;
using System.Configuration;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web;
using System.Web.Hosting;

namespace PlanHost
{
    public sealed class Module : IHttpModule
    {
        public void Init(HttpApplication app)
        {
            app.BeginRequest += OnBeginRequest;
            app.PostResolveRequestCache += OnPostResolveRequestCache;
        }

        public void Dispose() { }

        internal static bool IsApi(HttpRequest request)
        {
            string path = VirtualPathUtility.ToAppRelative(request.Path);
            return path.Equals("~/api", StringComparison.OrdinalIgnoreCase) || path.StartsWith("~/api/", StringComparison.OrdinalIgnoreCase);
        }

        private static void OnBeginRequest(object sender, EventArgs e)
        {
            HttpContext context = ((HttpApplication)sender).Context;
            HttpRequest request = context.Request;
            if (IsApi(request) || (request.HttpMethod != "GET" && request.HttpMethod != "HEAD")) return;
            string path = VirtualPathUtility.ToAppRelative(request.Path);
            if (path == "~/" || Path.HasExtension(path)) return;
            string physical = request.PhysicalPath;
            if (File.Exists(physical) || Directory.Exists(physical)) return;
            context.RewritePath("~/index.html");
        }

        private static void OnPostResolveRequestCache(object sender, EventArgs e)
        {
            HttpContext context = ((HttpApplication)sender).Context;
            if (IsApi(context.Request)) context.RemapHandler(new ApiProxy());
        }
    }

    public sealed class ApiProxy : IHttpHandler
    {
        private const int MaxBody = 1024 * 1024;

        public bool IsReusable { get { return true; } }

        public void ProcessRequest(HttpContext context)
        {
            HttpRequest request = context.Request;
            HttpResponse response = context.Response;
            response.TrySkipIisCustomErrors = true;
            response.Cache.SetCacheability(HttpCacheability.NoCache);
            response.Cache.SetNoStore();

            if (request.ContentLength > MaxBody)
            {
                WriteError(response, 413, "Слишком большой запрос.");
                return;
            }
            byte[] body = new byte[0];
            if (request.HttpMethod != "GET" && request.HttpMethod != "HEAD")
            {
                using (MemoryStream buffer = new MemoryStream())
                {
                    request.InputStream.CopyTo(buffer);
                    body = buffer.ToArray();
                }
            }

            string target = VirtualPathUtility.ToAppRelative(request.Path).Substring(1) + request.Url.Query;
            string user = WindowsUser(context);
            for (int attempt = 0; ; attempt++)
            {
                int port;
                try
                {
                    port = NodeServer.EnsureStarted();
                }
                catch (Exception ex)
                {
                    WriteError(response, 503, "Сервер приложения не запустился: " + ex.Message);
                    return;
                }
                try
                {
                    Forward(request, response, port, target, body, user);
                    return;
                }
                catch (WebException ex)
                {
                    // Запрос не дошёл до сервера: процесс завершился — перезапуск; соединение закрыто сервером — новое.
                    // В обоих случаях сервер запрос не обработал, поэтому одна повторная попытка безопасна.
                    if (attempt == 0 && (ex.Status == WebExceptionStatus.ConnectFailure || ex.Status == WebExceptionStatus.KeepAliveFailure))
                    {
                        if (ex.Status == WebExceptionStatus.ConnectFailure) NodeServer.Restart();
                        continue;
                    }
                    NodeServer.Log("proxy: " + ex.Message);
                    WriteError(response, 502, "Сервер приложения не ответил. Повторите попытку.");
                    return;
                }
            }
        }

        /// <summary>Логин после Windows-аутентификации IIS; включается только для адреса /api/windows-login.</summary>
        private static string WindowsUser(HttpContext context)
        {
            if (!NodeServer.WindowsAuth) return null;
            string login = context.Request.ServerVariables["LOGON_USER"];
            return string.IsNullOrEmpty(login) ? null : login;
        }

        private static void Forward(HttpRequest request, HttpResponse response, int port, string target, byte[] body, string user)
        {
            HttpWebRequest upstream = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + target);
            upstream.Method = request.HttpMethod;
            upstream.Proxy = null;
            upstream.AllowAutoRedirect = false;
            upstream.KeepAlive = true;
            upstream.Timeout = 120000;
            upstream.ReadWriteTimeout = 120000;
            upstream.ServicePoint.Expect100Continue = false;
            // Короче, чем keepAliveTimeout сервера API (server/iis.ts), чтобы не писать в закрытое им соединение.
            upstream.ServicePoint.MaxIdleTime = 30000;
            upstream.AutomaticDecompression = DecompressionMethods.None;
            if (!string.IsNullOrEmpty(request.Headers["Accept"])) upstream.Accept = request.Headers["Accept"];
            if (!string.IsNullOrEmpty(request.ContentType)) upstream.ContentType = request.ContentType;
            string authorization = request.Headers["Authorization"];
            // Заголовок Negotiate/NTLM относится к IIS, серверу API нужен только токен сеанса.
            if (!string.IsNullOrEmpty(authorization) && authorization.StartsWith("Bearer ", StringComparison.Ordinal)) upstream.Headers["Authorization"] = authorization;
            upstream.Headers["X-Forwarded-For"] = request.UserHostAddress;
            if (user != null)
            {
                upstream.Headers["X-Windows-User"] = Uri.EscapeDataString(user);
                upstream.Headers["X-Windows-Auth-Encoding"] = "uri";
                upstream.Headers["X-Windows-Auth-Secret"] = NodeServer.ProxySecret;
            }
            if (upstream.Method != "GET" && upstream.Method != "HEAD")
            {
                upstream.ContentLength = body.Length;
                if (body.Length > 0)
                {
                    using (Stream stream = upstream.GetRequestStream()) stream.Write(body, 0, body.Length);
                }
            }

            HttpWebResponse reply;
            try
            {
                reply = (HttpWebResponse)upstream.GetResponse();
            }
            catch (WebException ex)
            {
                reply = ex.Response as HttpWebResponse;
                if (reply == null) throw;
            }
            using (reply)
            {
                response.StatusCode = (int)reply.StatusCode;
                string contentType = reply.ContentType ?? "";
                int semicolon = contentType.IndexOf(';');
                response.ContentType = semicolon >= 0 ? contentType.Substring(0, semicolon).Trim() : contentType;
                if (!string.IsNullOrEmpty(reply.CharacterSet)) response.Charset = reply.CharacterSet;
                using (Stream stream = reply.GetResponseStream()) stream.CopyTo(response.OutputStream);
            }
        }

        private static void WriteError(HttpResponse response, int status, string message)
        {
            response.StatusCode = status;
            response.ContentType = "application/json";
            response.Charset = "utf-8";
            response.Write("{\"error\":\"" + HttpUtility.JavaScriptStringEncode(message) + "\"}");
        }
    }

    /// <summary>Процесс Node.js с API: один на пул IIS, останавливается вместе с ним.</summary>
    public static class NodeServer
    {
        private static readonly object Gate = new object();
        private static readonly object LogGate = new object();
        private static readonly Queue<string> Tail = new Queue<string>();
        private static Process process;
        private static int port;
        private static DateTime failedAt = DateTime.MinValue;
        private static string failure;
        private static bool registered;

        /// <summary>Общий секрет с сервером API, новый при каждом запуске пула; нигде не хранится.</summary>
        public static readonly string ProxySecret = NewSecret();

        public static bool WindowsAuth
        {
            get { return string.Equals(ConfigurationManager.AppSettings["WindowsAuth"], "true", StringComparison.OrdinalIgnoreCase); }
        }

        public static int EnsureStarted()
        {
            lock (Gate)
            {
                if (process != null && !process.HasExited) return port;
                // После неудачного запуска не пытаться снова на каждый запрос.
                if (failure != null && DateTime.UtcNow - failedAt < TimeSpan.FromSeconds(10)) throw new InvalidOperationException(failure);
                try
                {
                    Start();
                    failure = null;
                    return port;
                }
                catch (Exception ex)
                {
                    failure = ex.Message;
                    failedAt = DateTime.UtcNow;
                    Log("start failed: " + ex.Message);
                    throw;
                }
            }
        }

        public static void Restart()
        {
            lock (Gate)
            {
                Stop();
                failure = null;
            }
        }

        public static void Stop()
        {
            lock (Gate)
            {
                if (process == null) return;
                try
                {
                    if (!process.HasExited) process.Kill();
                }
                catch (Exception) { }
                process.Dispose();
                process = null;
            }
        }

        private static void Start()
        {
            Stop();
            if (!registered)
            {
                HostingEnvironment.RegisterObject(new Shutdown());
                AppDomain.CurrentDomain.DomainUnload += delegate { Stop(); };
                registered = true;
            }
            string node = Resolve(Setting("NodePath", "~/App_Data/node/node.exe"));
            string script = Resolve(Setting("ServerScript", "~/App_Data/server/server.cjs"));
            if (!File.Exists(node)) throw new FileNotFoundException("Не найден " + node);
            if (!File.Exists(script)) throw new FileNotFoundException("Не найден " + script);

            port = FreePort();
            ProcessStartInfo info = new ProcessStartInfo(node, "\"" + script + "\"");
            info.WorkingDirectory = Path.GetDirectoryName(script);
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;
            info.StandardOutputEncoding = Encoding.UTF8;
            info.StandardErrorEncoding = Encoding.UTF8;
            foreach (string key in ConfigurationManager.AppSettings.AllKeys)
            {
                if (key.StartsWith("env:", StringComparison.OrdinalIgnoreCase) && key.Length > 4) info.EnvironmentVariables[key.Substring(4)] = ConfigurationManager.AppSettings[key];
            }
            info.EnvironmentVariables["PORT"] = port.ToString();
            info.EnvironmentVariables["TC_PARENT_PID"] = Process.GetCurrentProcess().Id.ToString();
            info.EnvironmentVariables["NODE_ENV"] = "production";
            // Драйвер SQL Server выполняет запросы в потоках libuv; по умолчанию их 4.
            if (!info.EnvironmentVariables.ContainsKey("UV_THREADPOOL_SIZE")) info.EnvironmentVariables["UV_THREADPOOL_SIZE"] = "16";
            if (WindowsAuth)
            {
                info.EnvironmentVariables["WINDOWS_AUTH_TRUST_PROXY"] = "true";
                info.EnvironmentVariables["WINDOWS_AUTH_HEADER"] = "x-windows-user";
                info.EnvironmentVariables["WINDOWS_AUTH_PROXY_SECRET"] = ProxySecret;
            }
            else
            {
                info.EnvironmentVariables.Remove("WINDOWS_AUTH_TRUST_PROXY");
            }

            Process started = new Process();
            started.StartInfo = info;
            started.OutputDataReceived += delegate(object s, DataReceivedEventArgs a) { if (a.Data != null) Log(a.Data); };
            started.ErrorDataReceived += delegate(object s, DataReceivedEventArgs a) { if (a.Data != null) Log(a.Data); };
            started.Start();
            started.BeginOutputReadLine();
            started.BeginErrorReadLine();
            process = started;
            Log("node started, pid " + started.Id + ", port " + port);

            DateTime deadline = DateTime.UtcNow.AddSeconds(30);
            while (DateTime.UtcNow < deadline)
            {
                if (started.HasExited)
                {
                    started.WaitForExit();
                    throw new InvalidOperationException("процесс завершился с кодом " + started.ExitCode + ". " + LastLines());
                }
                if (Listening(port)) return;
                Thread.Sleep(200);
            }
            Stop();
            throw new TimeoutException("сервер не начал принимать запросы за 30 секунд. " + LastLines());
        }

        private static bool Listening(int p)
        {
            try
            {
                using (TcpClient client = new TcpClient())
                {
                    IAsyncResult pending = client.BeginConnect(IPAddress.Loopback, p, null, null);
                    if (!pending.AsyncWaitHandle.WaitOne(500)) return false;
                    client.EndConnect(pending);
                    return true;
                }
            }
            catch (SocketException)
            {
                return false;
            }
        }

        private static int FreePort()
        {
            TcpListener listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            int free = ((IPEndPoint)listener.LocalEndpoint).Port;
            listener.Stop();
            return free;
        }

        private static string Setting(string key, string fallback)
        {
            string value = ConfigurationManager.AppSettings[key];
            return string.IsNullOrEmpty(value) ? fallback : value;
        }

        private static string Resolve(string path)
        {
            return path.StartsWith("~/", StringComparison.Ordinal) ? HostingEnvironment.MapPath(path) : path;
        }

        private static string NewSecret()
        {
            byte[] bytes = new byte[32];
            using (RandomNumberGenerator random = RandomNumberGenerator.Create()) random.GetBytes(bytes);
            return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        }

        private static string LastLines()
        {
            lock (LogGate) return string.Join(" | ", Tail.ToArray());
        }

        /// <summary>Журнал App_Data\logs\node-ГГГГММДД.log (вывод сервера API и события запуска).</summary>
        public static void Log(string line)
        {
            lock (LogGate)
            {
                Tail.Enqueue(line);
                while (Tail.Count > 8) Tail.Dequeue();
                try
                {
                    string dir = Resolve(Setting("LogDir", "~/App_Data/logs"));
                    Directory.CreateDirectory(dir);
                    File.AppendAllText(Path.Combine(dir, "node-" + DateTime.Now.ToString("yyyyMMdd") + ".log"), DateTime.Now.ToString("HH:mm:ss ") + line + Environment.NewLine, Encoding.UTF8);
                }
                catch (Exception) { }
            }
        }

        private sealed class Shutdown : IRegisteredObject
        {
            public void Stop(bool immediate)
            {
                NodeServer.Log("application pool is stopping");
                NodeServer.Stop();
                HostingEnvironment.UnregisterObject(this);
            }
        }
    }
}
