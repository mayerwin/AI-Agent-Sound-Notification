# Generates resources/icon.png — 256x256 PNG used as the VS Marketplace icon.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/generate-icon.ps1

param(
    [int]$Size = 256,
    [string]$Out = (Join-Path $PSScriptRoot '..\resources\icon.png')
)

Add-Type -AssemblyName System.Drawing

$S = [int]$Size
$sc = [single]($S / 256.0)
function X([single]$v) { return [single]($v * $sc) }
function Rect([single]$x, [single]$y, [single]$w, [single]$h) {
    return (New-Object System.Drawing.RectangleF((X $x), (X $y), (X $w), (X $h)))
}
function Pt([single]$x, [single]$y) {
    return (New-Object System.Drawing.PointF((X $x), (X $y)))
}

$bmp = New-Object System.Drawing.Bitmap($S, $S)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
$g.Clear([System.Drawing.Color]::Transparent)

# --- Rounded-rect gradient background -------------------------------------
$radius = [int]($S * 0.18)
$d = $radius * 2
$bgPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$bgPath.AddArc(0, 0, $d, $d, 180, 90)
$bgPath.AddArc($S - $d, 0, $d, $d, 270, 90)
$bgPath.AddArc($S - $d, $S - $d, $d, $d, 0, 90)
$bgPath.AddArc(0, $S - $d, $d, $d, 90, 90)
$bgPath.CloseFigure()

$bgRect = New-Object System.Drawing.RectangleF(0, 0, $S, $S)
$gradBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $bgRect,
    [System.Drawing.Color]::FromArgb(255, 30, 27, 75),     # indigo-950
    [System.Drawing.Color]::FromArgb(255, 147, 51, 234),   # purple-600
    45.0
)
$blend = New-Object System.Drawing.Drawing2D.Blend(3)
$blend.Positions = @([single]0.0, [single]0.55, [single]1.0)
$blend.Factors   = @([single]0.0, [single]0.55, [single]1.0)
$gradBrush.Blend = $blend
$g.FillPath($gradBrush, $bgPath)

# Top highlight for a bit of glass feel
$hlRect = New-Object System.Drawing.RectangleF(0, 0, $S, [single]($S * 0.55))
$hlBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $hlRect,
    [System.Drawing.Color]::FromArgb(55, 255, 255, 255),
    [System.Drawing.Color]::FromArgb(0,  255, 255, 255),
    90.0
)
$g.SetClip($bgPath)
$g.FillRectangle($hlBrush, $hlRect)
$g.ResetClip()

# --- Bell silhouette ------------------------------------------------------
# Compose from: upper dome (pie), trapezoidal body (polygon), rim (rounded
# rect), handle (rounded rect), clapper (ellipse).
$bell = New-Object System.Drawing.Drawing2D.GraphicsPath

# Upper dome as half-circle: ellipse rect (70,70,116,116), angles 180..360
$bell.AddPie((X 70), (X 70), (X 116), (X 116), 180, 180)

# Flared body: polygon top=(70,128)→(186,128), bottom=(54,204)→(202,204)
$bodyPts = New-Object 'System.Drawing.PointF[]' 4
$bodyPts[0] = (Pt 70 128)
$bodyPts[1] = (Pt 186 128)
$bodyPts[2] = (Pt 202 204)
$bodyPts[3] = (Pt 54 204)
$bell.AddPolygon($bodyPts)

$bellBounds = $bell.GetBounds()
$bellBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $bellBounds,
    [System.Drawing.Color]::FromArgb(255, 255, 255, 255),
    [System.Drawing.Color]::FromArgb(255, 226, 232, 240),   # slate-200
    90.0
)

# Shadow behind bell for depth
$shadowPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$shadowPath.AddPath($bell, $false)
$m = New-Object System.Drawing.Drawing2D.Matrix
$m.Translate(0, (X 4))
$shadowPath.Transform($m)
$shadowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(70, 0, 0, 0))
$g.FillPath($shadowBrush, $shadowPath)

$g.FillPath($bellBrush, $bell)

# --- Rim (small band under the bell body) ---------------------------------
function AddRoundedRect([System.Drawing.Drawing2D.GraphicsPath]$path, [single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
    $d = $r * 2
    $path.AddArc($x, $y, $d, $d, 180, 90)
    $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $path.CloseFigure()
}

$rim = New-Object System.Drawing.Drawing2D.GraphicsPath
AddRoundedRect $rim (X 46) (X 202) (X 164) (X 16) (X 8)
$rimBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 241, 245, 249))
$g.FillPath($rimBrush, $rim)

# --- Handle (crown) on top ------------------------------------------------
$handle = New-Object System.Drawing.Drawing2D.GraphicsPath
AddRoundedRect $handle (X 116) (X 44) (X 24) (X 22) (X 7)
$g.FillPath($bellBrush, $handle)

# --- Clapper (small ball beneath the rim) ---------------------------------
$clapperD = X 20
$cx = X 118
$cy = X 222
$g.FillEllipse($bellBrush, $cx, $cy, $clapperD, $clapperD)

# --- Sound-wave arcs (both sides of the bell) -----------------------------
$wavePen = New-Object System.Drawing.Pen(
    [System.Drawing.Color]::FromArgb(235, 255, 255, 255),
    (X 9)
)
$wavePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$wavePen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round

$cxWave = X 128
$cyWave = X 148
$radii = @(60, 86)
foreach ($r in $radii) {
    $rx = X $r
    $box = New-Object System.Drawing.RectangleF(($cxWave - $rx), ($cyWave - $rx), (2 * $rx), (2 * $rx))
    $g.DrawArc($wavePen, $box, -40, 80)   # right side
    $g.DrawArc($wavePen, $box, 140, 80)   # left side
}

# --- AI sparkle (tiny 4-point star, top-right) ----------------------------
function AddSparkle([System.Drawing.Drawing2D.GraphicsPath]$path, [single]$cx, [single]$cy, [single]$outer, [single]$inner) {
    $pts = New-Object 'System.Drawing.PointF[]' 8
    $pts[0] = New-Object System.Drawing.PointF($cx, ($cy - $outer))
    $pts[1] = New-Object System.Drawing.PointF(($cx + $inner), ($cy - $inner))
    $pts[2] = New-Object System.Drawing.PointF(($cx + $outer), $cy)
    $pts[3] = New-Object System.Drawing.PointF(($cx + $inner), ($cy + $inner))
    $pts[4] = New-Object System.Drawing.PointF($cx, ($cy + $outer))
    $pts[5] = New-Object System.Drawing.PointF(($cx - $inner), ($cy + $inner))
    $pts[6] = New-Object System.Drawing.PointF(($cx - $outer), $cy)
    $pts[7] = New-Object System.Drawing.PointF(($cx - $inner), ($cy - $inner))
    $path.AddPolygon($pts)
}

$sparkles = New-Object System.Drawing.Drawing2D.GraphicsPath
AddSparkle $sparkles (X 212) (X 44) (X 14) (X 4)
AddSparkle $sparkles (X 48)  (X 212) (X 10) (X 3)
$sparkleBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 253, 224, 71)) # amber-300
$g.FillPath($sparkleBrush, $sparkles)

# --- Save -----------------------------------------------------------------
$outDir = Split-Path -Parent $Out
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()

Write-Host "Wrote $Out ($S x $S)"
