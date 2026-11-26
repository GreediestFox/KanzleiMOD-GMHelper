@echo off
rem Builds AmIAlive.exe with the C# compiler that ships with Windows (.NET Framework 4.x, C# 5). No Visual Studio needed.
setlocal
set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" set CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe
if not exist "%CSC%" (echo csc.exe not found - install the .NET Framework 4.5 or newer & exit /b 1)
cd /d "%~dp0"
"%CSC%" /nologo /target:exe /optimize+ /out:AmIAlive.exe /r:System.Management.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll src\*.cs
if errorlevel 1 (echo. & echo BUILD FAILED - send the messages above & exit /b 1)
echo.
echo Built AmIAlive.exe.  Next:  AmIAlive.exe selftest
