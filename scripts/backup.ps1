# ============================================================
#  Backup de la base de datos (viguetas-api)
#  Genera un dump completo con pg_dump y conserva solo los
#  últimos 8 archivos en la carpeta /backups.
#
#  Requisito: herramientas de PostgreSQL (incluye pg_dump):
#    winget install --id PostgreSQL.PostgreSQL.18
#
#  El script busca pg_dump en el PATH y, si no esta, en las instalaciones
#  tipicas de C:\Program Files\PostgreSQL (version mas nueva primero).
#
#  Uso manual:
#    powershell -ExecutionPolicy Bypass -File scripts\backup.ps1
#
#  Programación semanal (Programador de tareas de Windows):
#    schtasks /create /tn "viguetas-backup" /sc weekly /d SUN /st 03:00 /tr "powershell -ExecutionPolicy Bypass -File \"C:\ruta\viguetas-api\scripts\backup.ps1\""
#
#  Restaurar un backup (si algo se pierde):
#    pg_restore --clean --if-exists --no-owner --dbname="URL_DE_CONEXION" backups\viguetas-FECHA.dump
# ============================================================
$ErrorActionPreference = 'Stop'

# Localiza pg_dump: PATH del sistema o instalaciones tipicas de PostgreSQL
$pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue
if (-not $pgDump) {
    $candidates = Get-ChildItem -Path 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue |
        Sort-Object { try { [version]$_.Name } catch { [version]'0.0' } } -Descending |
        ForEach-Object { Join-Path $_.FullName 'bin\pg_dump.exe' } |
        Where-Object { Test-Path $_ }
    if ($candidates) {
        $pgDump = $candidates | Select-Object -First 1
    }
}
if (-not $pgDump) {
    Write-Error "No se encontro 'pg_dump'. Instala las herramientas de PostgreSQL con:  winget install --id PostgreSQL.PostgreSQL.18"
}
$pgDumpPath = if ($pgDump.Source) { $pgDump.Source } else { $pgDump }

# Lee DATABASE_URL del .env de la API (la URL nunca queda escrita en este script)
$envFile = Join-Path $PSScriptRoot '..\.env'
$line = Select-String -Path $envFile -Pattern '^DATABASE_URL=' | Select-Object -First 1
if (-not $line) {
    Write-Error "No se encontro DATABASE_URL en $envFile"
}
$dbUrl = ($line.Line -split '=', 2)[1].Trim().Trim('"')

$backupDir = Join-Path $PSScriptRoot '..\backups'
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

$fecha = Get-Date -Format 'yyyy-MM-dd_HHmm'
$file = Join-Path $backupDir "viguetas-$fecha.dump"

& $pgDumpPath --format=custom --no-owner --no-privileges --file=$file $dbUrl
if ($LASTEXITCODE -ne 0) {
    Write-Error "pg_dump fallo con codigo $LASTEXITCODE"
}
Write-Host "Backup OK -> $file"

# Conservar solo los 8 dumps mas recientes
Get-ChildItem $backupDir -Filter 'viguetas-*.dump' |
    Sort-Object Name -Descending |
    Select-Object -Skip 8 |
    Remove-Item -Force
