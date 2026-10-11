using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Windows.Forms;
class StudioLauncher {
  [STAThread] static int Main(string[] args) {
    using(var gate=new Mutex(false,"Local\\CanvasProSeedanceStudioLauncher")) {
      bool owned=false;
      try {
        try { owned=gate.WaitOne(15000); } catch(AbandonedMutexException) { owned=true; }
        if(!owned) { MessageBox.Show("客户端正在启动，请稍候。", "CanvasPro 视频工作室"); return 1; }
        var root=AppDomain.CurrentDomain.BaseDirectory;
        var info=new ProcessStartInfo(Path.Combine(root,"runtime","node.exe"),"\""+Path.Combine(root,"app","server.mjs")+"\"");
        info.WorkingDirectory=root; info.UseShellExecute=false; info.CreateNoWindow=true; info.WindowStyle=ProcessWindowStyle.Hidden;
        info.RedirectStandardOutput=true; info.RedirectStandardError=true;
        var p=Process.Start(info); string url=null;
        var read=p.StandardOutput.ReadLineAsync(); if(read.Wait(20000)) url=read.Result;
        Uri u;
        if(!Uri.TryCreate(url,UriKind.Absolute,out u)||u.Scheme!="http"||u.Host!="127.0.0.1"||u.Fragment.Length!=65) {
          MessageBox.Show("无法启动本地客户端。请完整解压文件夹后再试，不要直接在压缩包里运行。", "CanvasPro 视频工作室"); return 1;
        }
        if(args.Length>0&&args[0]=="--smoke") Console.WriteLine(url);
        else Process.Start(new ProcessStartInfo(url) {UseShellExecute=true});
        return 0;
      } catch {
        MessageBox.Show("启动失败。请确认 runtime 与 app 文件夹保留在客户端旁边，并使用 Windows 10/11。", "CanvasPro 视频工作室"); return 1;
      } finally { if(owned) gate.ReleaseMutex(); }
    }
  }
}
