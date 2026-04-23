@echo off
title Clipping de Noticias
cd /d "%~dp0"

echo ==================================================
echo   Sistema de Clipping Automatizado
echo ==================================================
echo.

if not exist .env (
    echo [ERRO] Arquivo .env nao encontrado.
    echo Copie .env.example para .env e preencha as variaveis.
    echo.
    pause
    exit /b 1
)

if not exist google-token.json (
    echo [AVISO] google-token.json nao encontrado.
    echo Execute primeiro: node auth-google.js
    echo.
    pause
    exit /b 1
)

if not exist node_modules (
    echo Instalando dependencias pela primeira vez...
    call npm install
    if errorlevel 1 (
        echo [ERRO] Falha na instalacao das dependencias.
        pause
        exit /b 1
    )
    echo.
)

echo Iniciando pipeline de clipping...
echo.
node run.js
echo.
echo ==================================================
echo Pressione qualquer tecla para fechar.
pause > nul
