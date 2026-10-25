# Puts "EasyShop Runner" and "EasyShop" shortcuts on your desktop (works with OneDrive desktops too).
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell

$s = $shell.CreateShortcut((Join-Path $desktop 'EasyShop Runner.lnk'))
$s.TargetPath = Join-Path $here 'Start EasyShop runner.cmd'
$s.WorkingDirectory = $here
$s.IconLocation = (Join-Path $here 'easyshop.ico') + ',0'
$s.Description = 'Start the EasyShop shop runner'
$s.Save()

$u = Join-Path $desktop 'EasyShop.url'
$lines = @('[InternetShortcut]', 'URL=https://easy-shop-omega-red.vercel.app/', ('IconFile=' + (Join-Path $here 'easyshop.ico')), 'IconIndex=0')
Set-Content -Path $u -Value $lines -Encoding ASCII

Write-Host "Done - two shortcuts are on your desktop: 'EasyShop Runner' and 'EasyShop'."
