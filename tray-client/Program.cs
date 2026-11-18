using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace TaskControlTray {
 static class Program {
  [STAThread] static void Main(string[] args) {
   Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
   System.Threading.SynchronizationContext.SetSynchronizationContext(new WindowsFormsSynchronizationContext());
   if(args.Length > 0 && args[0] == "--preview") { Application.Run(new PreviewContext()); return; }
   // Один экземпляр на сеанс Windows, в том числе при повторном запуске или обновлении.
   bool created; using(var mutex=new System.Threading.Mutex(true,@"Local\TaskControlNotifications",out created)) {
    if(!created) return;
    string folder=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"TaskControlNotifications");
    Directory.CreateDirectory(folder); Application.Run(new TrayContext(folder));
   }
  }
 }
 sealed class NoticeWindow:Form {
  readonly Timer closeTimer;
  protected override bool ShowWithoutActivation { get { return true; } }
  protected override CreateParams CreateParams { get { var cp=base.CreateParams; cp.ExStyle |= 0x08000000 | 0x00000080; return cp; } }
  public NoticeWindow(string title,string body,Action open) {
   Text="Контроль задач — уведомление"; FormBorderStyle=FormBorderStyle.None; StartPosition=FormStartPosition.Manual; ShowInTaskbar=false; TopMost=true;
   BackColor=Color.FromArgb(27,40,58); ForeColor=Color.FromArgb(231,238,249); Size=new Size(384,174);
   var area=Screen.PrimaryScreen.WorkingArea; Location=new Point(area.Right-Width-18,area.Bottom-Height-18);
   var logoIcon=Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location) ?? SystemIcons.Information;
   var logo=new PictureBox { Image=logoIcon.ToBitmap(), SizeMode=PictureBoxSizeMode.Zoom, Left=15, Top=13, Width=25, Height=25 };
   var brand=new Label { Text="Контроль задач", Left=49, Top=16, Width=270, Height=22, Font=new Font("Segoe UI",9,FontStyle.Regular), ForeColor=Color.FromArgb(165,185,212) };
   var header=new Label { Text=title, Left=16, Top=50, Width=350, Height=25, Font=new Font("Segoe UI",11,FontStyle.Bold), AutoEllipsis=true };
   var content=new Label { Text=body, Left=16, Top=80, Width=350, Height=42, Font=new Font("Segoe UI",9), ForeColor=Color.FromArgb(201,214,231), AutoEllipsis=true };
   var close=new Button { Text="×", Left=344,Top=9, Width=28,Height=28, FlatStyle=FlatStyle.Flat, ForeColor=Color.FromArgb(183,200,222), BackColor=BackColor, TabStop=false };close.FlatAppearance.BorderSize=0;close.Click+=(s,e)=>Close();
   Controls.AddRange(new Control[]{logo,brand,header,content,close});
   var link=new LinkLabel {Text="Открыть",Left=16,Top=138,Width=120,LinkColor=Color.FromArgb(148,189,247),Font=new Font("Segoe UI",9,FontStyle.Bold)};link.LinkClicked+=(s,e)=>{if(open!=null)open();Close();};Controls.Add(link);
   Paint+=(sender,eventArgs)=>{using(var pen=new Pen(Color.FromArgb(81,111,148))) eventArgs.Graphics.DrawRectangle(pen,0,0,ClientSize.Width-1,ClientSize.Height-1); using(var pen=new Pen(Color.FromArgb(56,77,102))) eventArgs.Graphics.DrawLine(pen,16,42,ClientSize.Width-17,42);};
   closeTimer=new Timer { Interval=12000 };closeTimer.Tick+=(s,e)=>Close();MouseEnter+=(s,e)=>closeTimer.Stop();MouseLeave+=(s,e)=>closeTimer.Start();closeTimer.Start();
  }
  protected override void OnFormClosed(FormClosedEventArgs e){closeTimer.Stop();closeTimer.Dispose();base.OnFormClosed(e);}
 }
 sealed class PreviewContext:ApplicationContext {
  readonly Timer timer;
  public PreviewContext() {
   timer=new Timer { Interval=18000 }; timer.Tick+=(s,e)=>ExitThread();timer.Start();
   new NoticeWindow("Новая задача", "Подготовить отчёт. Срок: сегодня, 17:00.", null).Show();
  }
  protected override void ExitThreadCore(){timer.Stop();timer.Dispose();base.ExitThreadCore();}
 }
 sealed class TrayContext:ApplicationContext {
  const string DefaultUrl="http://10.199.127.27:1500/";
  readonly string folder,configFile,cursorFile; readonly NotifyIcon tray; readonly Timer timer; readonly BackgroundWorker worker; readonly JavaScriptSerializer json=new JavaScriptSerializer();
  string baseUrl,token,since,lastTarget,lastError; bool closing,configuring; int employeeId;
  public TrayContext(string path) {
   folder=path;configFile=Path.Combine(path,"server.txt");cursorFile=Path.Combine(path,"cursor.dat");
   baseUrl=ReadUrl();
   worker=new BackgroundWorker();worker.DoWork+=(s,e)=>{e.Result=Fetch();};worker.RunWorkerCompleted+=(s,e)=>FinishPoll(e);
   var menu=new ContextMenuStrip(); menu.Items.Add("Открыть приложение",null,(s,e)=>Open("/"));menu.Items.Add("Настроить адрес сервера",null,(s,e)=>Configure());menu.Items.Add("Проверить сейчас",null,(s,e)=>Poll());menu.Items.Add("Состояние",null,(s,e)=>MessageBox.Show(lastError ?? "Подключено: "+baseUrl,"Контроль задач"));menu.Items.Add("Выход",null,(s,e)=>ExitThread());
   tray=new NotifyIcon { Text="Контроль задач · уведомления", Icon=Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location) ?? SystemIcons.Information, ContextMenuStrip=menu, Visible=true };
   tray.DoubleClick+=(s,e)=>Open("/");tray.BalloonTipClicked+=(s,e)=>Open(lastTarget ?? "/");
   timer=new Timer { Interval=20000 }; timer.Tick+=(s,e)=>Poll();timer.Start();
   tray.ShowBalloonTip(4000,"Контроль задач","Программа уведомлений запущена.",ToolTipIcon.Info);
   Poll();
  }
  string ReadUrl(){try { string v=File.ReadAllText(configFile).Trim();Uri u;if(Uri.TryCreate(v,UriKind.Absolute,out u)&&(u.Scheme=="http"||u.Scheme=="https")&&String.IsNullOrEmpty(u.UserInfo)) return u.GetLeftPart(UriPartial.Authority)+"/";}catch{} return DefaultUrl;}
  void Configure(){
   if(worker.IsBusy){MessageBox.Show("Дождитесь завершения проверки сервера и повторите попытку.","Контроль задач");return;}
   configuring=true;
   try { using(var f=new Form { Text="Адрес сервера",Size=new Size(480,150),StartPosition=FormStartPosition.CenterScreen,FormBorderStyle=FormBorderStyle.FixedDialog,MaximizeBox=false,MinimizeBox=false }) {
    var label=new Label { Text="Адрес приложения (например, http://сервер:1500)",Left=12,Top=12,Width=440 };var box=new TextBox { Text=baseUrl,Left=12,Top=36,Width=440 };var save=new Button { Text="Сохранить",Left=330,Top=68,Width=120,DialogResult=DialogResult.OK };f.Controls.AddRange(new Control[]{label,box,save});f.AcceptButton=save;
    if(f.ShowDialog()!=DialogResult.OK)return;Uri u;if(!Uri.TryCreate(box.Text,UriKind.Absolute,out u)||(u.Scheme!="http"&&u.Scheme!="https")||!String.IsNullOrEmpty(u.UserInfo)){MessageBox.Show("Укажите корректный адрес сервера.");return;}
    baseUrl=u.GetLeftPart(UriPartial.Authority)+"/";File.WriteAllText(configFile,baseUrl);token=null;since=null;employeeId=0;
   }} finally {configuring=false;Poll();}
  }
  string Request(string path,string method,string bearer) { var req=(HttpWebRequest)WebRequest.Create(new Uri(new Uri(baseUrl),path));req.Method=method;req.UseDefaultCredentials=true;req.Timeout=10000;req.ReadWriteTimeout=10000;req.AllowAutoRedirect=false;if(bearer!=null)req.Headers["X-TC-Token"]=bearer;if(method=="POST")req.ContentLength=0;using(var response=req.GetResponse())using(var reader=new StreamReader(response.GetResponseStream(),Encoding.UTF8))return reader.ReadToEnd(); }
  Dictionary<string,object> Parse(string s){return json.Deserialize<Dictionary<string,object>>(s);}
  string LoadCursor(){try {return Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(cursorFile),null,DataProtectionScope.CurrentUser));}catch{return null;}}
  void SaveCursor(string value){File.WriteAllBytes(cursorFile,ProtectedData.Protect(Encoding.UTF8.GetBytes(value),null,DataProtectionScope.CurrentUser));}
  void Poll(){if(!closing&&!configuring&&!worker.IsBusy)worker.RunWorkerAsync();}
  void FinishPoll(RunWorkerCompletedEventArgs e){if(closing)return;try {if(e.Error!=null)throw e.Error;var result=(List<Tuple<string,string,string>>)e.Result;if(result==null)return;foreach(var n in result){lastTarget=n.Item3;string target=n.Item3;new NoticeWindow(n.Item1,n.Item2,()=>Open(target)).Show();}if(since!=null)SaveCursor(baseUrl+"|"+employeeId+"|"+since);lastError=null;tray.Text="Контроль задач · уведомления";}catch(Exception error){lastError="Нет связи или Windows-вход не выполнен. Проверьте адрес и доступ к приложению. "+error.Message;tray.Text="Контроль задач · нет связи";}}
  List<Tuple<string,string,string>> Fetch(){if(token==null){var login=Parse(Request("api/windows-login","POST",null));token=(string)login["token"];var u=(Dictionary<string,object>)login["user"];int newId=Convert.ToInt32(u["employeeId"]);if(employeeId!=newId){employeeId=newId;since=null;}if(since==null){var saved=LoadCursor();var prefix=baseUrl+"|"+employeeId+"|";if(saved!=null&&saved.StartsWith(prefix,StringComparison.Ordinal))since=saved.Substring(prefix.Length);}}
   Dictionary<string,object> data;try {data=Parse(Request("api/notices"+(since==null?"":"?since="+Uri.EscapeDataString(since)),"GET",token));}catch(WebException e){if(e.Response is HttpWebResponse&&(((HttpWebResponse)e.Response).StatusCode==HttpStatusCode.Unauthorized||((HttpWebResponse)e.Response).StatusCode==HttpStatusCode.Forbidden)){token=null;}throw;}
   var list=new List<Tuple<string,string,string>>();foreach(var item in (System.Collections.IEnumerable)data["notices"]){var n=(Dictionary<string,object>)item;string url=Convert.ToString(n["url"]);if(!url.StartsWith("/")||url.StartsWith("//"))url="/";list.Add(Tuple.Create(Convert.ToString(n["title"]),Convert.ToString(n["body"]),url));}
   since=Convert.ToString(data["now"]);return list;
  }
  void Open(string path){try{Process.Start(new Uri(new Uri(baseUrl),path).ToString());}catch{MessageBox.Show("Не удалось открыть приложение.");}}
  protected override void ExitThreadCore(){closing=true;timer.Stop();tray.Visible=false;tray.Dispose();timer.Dispose();base.ExitThreadCore();}
 }
}
