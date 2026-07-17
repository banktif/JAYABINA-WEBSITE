$ErrorActionPreference = 'Stop'

$root = (Resolve-Path $PSScriptRoot).Path
$out = Join-Path $root 'admin-public'
if (-not $out.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'Unsafe admin build output path.'
}
if (Test-Path -LiteralPath $out) {
  Remove-Item -LiteralPath $out -Recurse -Force
}
New-Item -ItemType Directory -Path $out | Out-Null

Copy-Item -LiteralPath (Join-Path $root 'admin\index.html') -Destination (Join-Path $out 'index.html')
Copy-Item -LiteralPath (Join-Path $root 'admin\editor.html') -Destination (Join-Path $out 'editor.html')
Copy-Item -LiteralPath (Join-Path $root 'admin\vendor') -Destination (Join-Path $out 'vendor') -Recurse
@('theme.css','admin-modern.css','jc-api.js','admin-favicon.svg','admin-manifest.json') | ForEach-Object {
  Copy-Item -LiteralPath (Join-Path $root $_) -Destination (Join-Path $out $_)
}

@'
/*
  X-Robots-Tag: noindex, nofollow, noarchive
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()

/
  Cache-Control: no-store, max-age=0

/index.html
  Cache-Control: no-store, max-age=0

/*.html
  Cache-Control: no-store, max-age=0

/vendor/*
  Cache-Control: public, max-age=31536000, immutable
'@ | Set-Content -LiteralPath (Join-Path $out '_headers') -Encoding utf8

Write-Host "JAYABINA admin build ready: $out"
