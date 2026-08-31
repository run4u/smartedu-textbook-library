@echo off
setlocal
pushd "%~dp0"
call npm.cmd run dev
set "exitCode=%errorlevel%"
echo.
echo Application exited with code %exitCode%.
pause
popd
endlocal
