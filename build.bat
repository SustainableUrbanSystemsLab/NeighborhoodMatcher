@echo off
rem Builds NeighborhoodMatcher: the website, the self-host zip, and the desktop
rem app installer for this computer (Windows: NSIS setup.exe with WebView2),
rem all collected in release\.
rem
rem   build.bat              everything
rem   build.bat --web-only   without the desktop app (no Rust needed)
rem   build.bat --test       everything, plus all tests and the app's self-test
rem   build.bat --help       prerequisites and outputs
rem
rem The steps live in scripts\build-all.mjs, shared with build.sh (macOS, Linux).
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo error: Node.js 20 or newer is required: https://nodejs.org/
  set "RC=1"
  goto :done
)

node scripts\build-all.mjs %*
set "RC=%ERRORLEVEL%"

:done
rem Double-clicked from Explorer: keep the window open so the result stays readable.
if not "%~1"=="" goto :exit
if defined CI goto :exit
echo %CMDCMDLINE% | find /i "%~nx0" >nul && pause
:exit
exit /b %RC%
