param(
  [ValidateSet('Debug', 'Release')][string]$Configuration = 'Debug',
  [string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
$stellaRepository = Split-Path -Parent $PSScriptRoot
$stellaCompanion = Join-Path $stellaRepository 'apps\companion'
$stellaPackage = Get-Content -LiteralPath (Join-Path $stellaCompanion 'package.json') -Raw | ConvertFrom-Json
$stellaSdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not (Test-Path -LiteralPath $stellaSdk)) { throw "Android SDK 不存在：$stellaSdk" }
if (-not $env:JAVA_HOME -or -not (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin\java.exe'))) { throw '请配置 JAVA_HOME，使用 JDK 21 或兼容版本。' }
if ($Configuration -eq 'Release') {
  foreach ($stellaSigningName in @('STELLA_ANDROID_KEYSTORE', 'STELLA_ANDROID_KEYSTORE_PASSWORD', 'STELLA_ANDROID_KEY_ALIAS', 'STELLA_ANDROID_KEY_PASSWORD')) {
    if (-not [Environment]::GetEnvironmentVariable($stellaSigningName)) { throw "缺少 Release 签名变量：$stellaSigningName" }
  }
  if (-not (Test-Path -LiteralPath $env:STELLA_ANDROID_KEYSTORE)) { throw 'Release keystore 文件不存在。' }
}
$env:ANDROID_HOME = $stellaSdk
Push-Location $stellaRepository
try {
  npm --prefix $stellaCompanion run cap:sync
  if ($LASTEXITCODE -ne 0) { throw 'Companion Web 构建或 Capacitor 同步失败。' }
  Push-Location (Join-Path $stellaCompanion 'android')
  try {
    & .\gradlew.bat "assemble$Configuration"
    if ($LASTEXITCODE -ne 0) { throw 'Android Gradle 构建失败。' }
  } finally { Pop-Location }
  $stellaVariant = $Configuration.ToLowerInvariant()
  $stellaApk = Join-Path $stellaCompanion "android\app\build\outputs\apk\$stellaVariant\app-$stellaVariant.apk"
  if (-not (Test-Path -LiteralPath $stellaApk)) { throw "构建结束但 APK 不存在：$stellaApk" }
  $stellaSigner = Get-ChildItem -LiteralPath (Join-Path $stellaSdk 'build-tools') -Directory | Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName 'apksigner.bat' } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (-not $stellaSigner) { throw 'Android SDK 中没有 apksigner。' }
  & $stellaSigner verify --verbose $stellaApk
  if ($LASTEXITCODE -ne 0) { throw 'APK 签名验证失败。' }
  if (-not $OutputDirectory) { $OutputDirectory = Join-Path $stellaRepository "release\v$($stellaPackage.version)" }
  New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
  $stellaVersionCode = if ($env:STELLA_ANDROID_VERSION_CODE) { $env:STELLA_ANDROID_VERSION_CODE } else { $stellaPackage.androidVersionCode }
  $stellaQualifier = if ($Configuration -eq 'Debug') { '-debug' } else { '' }
  $stellaArtifact = Join-Path $OutputDirectory "Stella-Companion-$($stellaPackage.version)-android$stellaQualifier-vc$stellaVersionCode.apk"
  Copy-Item -LiteralPath $stellaApk -Destination $stellaArtifact
  $stellaDigest = (Get-FileHash -LiteralPath $stellaArtifact -Algorithm SHA256).Hash
  "$stellaDigest  $(Split-Path -Leaf $stellaArtifact)" | Set-Content -LiteralPath (Join-Path $OutputDirectory 'SHA256SUMS-android.txt') -Encoding ascii
  Write-Output "APK: $stellaArtifact"
  Write-Output "SHA256: $stellaDigest"
} finally { Pop-Location }
