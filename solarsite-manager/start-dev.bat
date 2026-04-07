@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo === SolarSite Manager 開発サーバー ===
echo フォルダ: %CD%
echo.
if not exist "package.json" (
  echo エラー: package.json がありません。この bat は solarsite-manager フォルダに置いてください。
  pause
  exit /b 1
)
if not exist "node_modules\" (
  echo 初回のみ npm install を実行します...
  call npm install
  if errorlevel 1 (
    echo npm install に失敗しました。Node.js が入っているか確認してください。
    pause
    exit /b 1
  )
)
echo ブラウザで開く: http://localhost:3000/login
echo 止めるときはこのウィンドウで Ctrl+C
echo.
call npm run dev
pause
