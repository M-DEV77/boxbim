@echo off
rem Servidor do BoxBim neste PC: abre o navegador em http://localhost:3000 (na rede: o endereço mostrado abaixo)
cd /d "%~dp0"
if not exist node_modules call npm install
start "" cmd /c "timeout /t 4 >nul & start http://localhost:3000"
call npm start
