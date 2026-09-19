$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
public sealed class StellaJob : IDisposable {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length, out uint returned);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool inside);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
    public long processTime, jobTime; public uint flags; public UIntPtr minWorkingSet, maxWorkingSet;
    public uint activeLimit; public UIntPtr affinity; public uint priority, scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong r1, r2, r3, r4, r5, r6; }
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
    public BasicLimits basic; public IoCounters io; public UIntPtr processMemory, jobMemory, peakProcessMemory, peakJobMemory;
  }
  readonly IntPtr job; readonly int rootPid;
  public StellaJob(int pid) {
    rootPid = pid; job = CreateJobObject(IntPtr.Zero, null);
    if (job == IntPtr.Zero) throw new Win32Exception();
    try {
      var limits = new ExtendedLimits(); limits.basic.flags = 0x2000; // KILL_ON_JOB_CLOSE; no breakaway
      int size = Marshal.SizeOf(limits); IntPtr memory = Marshal.AllocHGlobal(size);
      try { Marshal.StructureToPtr(limits, memory, false); if (!SetInformationJobObject(job, 9, memory, (uint)size)) throw new Win32Exception(); }
      finally { Marshal.FreeHGlobal(memory); }
      IntPtr process = OpenProcess(0x0101, false, pid); // SET_QUOTA | TERMINATE
      if (process == IntPtr.Zero) throw new Win32Exception();
      try { if (!AssignProcessToJobObject(job, process)) throw new Win32Exception(); }
      finally { CloseHandle(process); }
    } catch { CloseHandle(job); throw; }
  }
  int[] Members() {
    int capacity = 64;
    while (true) {
      int size = 8 + capacity * IntPtr.Size; IntPtr memory = Marshal.AllocHGlobal(size);
      try {
        uint returned;
        if (QueryInformationJobObject(job, 3, memory, (uint)size, out returned)) {
          int count = Marshal.ReadInt32(memory, 4); var pids = new int[count];
          for (int i = 0; i < count; i++) pids[i] = Marshal.ReadIntPtr(memory, 8 + i * IntPtr.Size).ToInt32();
          return pids;
        }
        int error = Marshal.GetLastWin32Error();
        if (error != 234) throw new Win32Exception(error);
        capacity = Math.Max(capacity * 2, Marshal.ReadInt32(memory));
      } finally { Marshal.FreeHGlobal(memory); }
    }
  }
  public int StopChildren() {
    var stopped = new HashSet<int>(); var clock = Stopwatch.StartNew();
    while (true) {
      bool found = false;
      foreach (int pid in Members()) {
        if (pid == rootPid) continue;
        found = true; IntPtr process = OpenProcess(0x1001, false, pid); // QUERY_LIMITED_INFORMATION | TERMINATE
        if (process == IntPtr.Zero) {
          int error = Marshal.GetLastWin32Error(); if (error == 87) continue; throw new Win32Exception(error);
        }
        try {
          bool inside;
          if (!IsProcessInJob(process, job, out inside)) throw new Win32Exception();
          if (!inside) continue; // PID reuse must never target another application.
          if (!TerminateProcess(process, 1)) {
            uint code; if (!GetExitCodeProcess(process, out code) || code == 259) throw new Win32Exception();
          }
          stopped.Add(pid);
        } finally { CloseHandle(process); }
      }
      if (!found) return stopped.Count;
      if (clock.ElapsedMilliseconds > 10000) throw new Exception("Background processes remain after termination; stop is not confirmed.");
      Thread.Sleep(20);
    }
  }
  public void Dispose() { CloseHandle(job); }
}
'@
$job = $null
try {
  $job = [StellaJob]::new([int]$env:STELLA_SUPERVISED_PID)
  [Console]::Out.WriteLine('{"ready":true}')
  while (($line = [Console]::ReadLine()) -ne $null) {
    $request = $line | ConvertFrom-Json
    if ($request.action -eq 'close') { break }
    try {
      if ($request.action -ne 'stop') { throw 'Unknown job operation' }
      $count = $job.StopChildren()
      [Console]::Out.WriteLine((@{ id = $request.id; count = $count } | ConvertTo-Json -Compress))
    } catch {
      [Console]::Out.WriteLine((@{ id = $request.id; error = $_.Exception.Message } | ConvertTo-Json -Compress))
    }
  }
} catch {
  [Console]::Out.WriteLine((@{ error = $_.Exception.Message } | ConvertTo-Json -Compress))
  exit 1
} finally { if ($null -ne $job) { $job.Dispose() } }
