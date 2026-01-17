[void][Reflection.Assembly]::LoadWithPartialName('System.Drawing')
$srcPath = 'C:\Users\Morris\.gemini\antigravity\brain\5ade2e0b-a215-4c6d-bfaf-519a84c467fc\cursor_solid_bg_1768115960684.png'
$destPath = 'd:\GOOGLE\TWCARDGAME\TWCARDGAME\img\cursor_default.png'

$img = [Drawing.Bitmap]::FromFile($srcPath)
# Get the background color from top-left pixel
$bgColor = $img.GetPixel(0, 0)
$img.MakeTransparent($bgColor)

# Create 32x32 resized version
$bmp = new-object Drawing.Bitmap(32, 32)
$g = [Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($img, 0, 0, 32, 32)

$img.Dispose()
$bmp.Save($destPath, [Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

Write-Host "Cursor processed and saved to $destPath"
