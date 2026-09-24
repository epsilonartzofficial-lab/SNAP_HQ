# Incident Report: NVIDIA Driver 617.14 Causes System-Wide Blocky/Degraded Text Rendering

## Summary

After updating/reinstalling the **NVIDIA GeForce Game Ready Driver to version 617.14** (released Tue Sep 22, 2026), all text across the Windows desktop — File Explorer, browsers, every application — rendered as blocky, inconsistent, and visually "broken." Text was not flickering and not literally missing characters, but glyphs appeared distorted, uneven, and lost the smooth anti-aliased look expected from ClearType/standard Windows font rendering. In some cases, the wrong font (a decorative/handwriting-style font) was substituted in place of the expected UI font (e.g., Segoe UI) in specific applications.

## Affected Component

- **Component:** GeForce Game Ready Driver
- **Version:** 617.14
- **Released:** September 22, 2026
- **Also bundled in this update:** PhysX System Software 9.26.0703, HD Audio Driver 1.4.6.3, USB-C Driver 1.52.831.832

## Symptoms

- All text system-wide (not app-specific) appeared blocky, "robotic," and inconsistent.
- Text did not flicker, but looked as if partially rendered or degraded.
- In some applications, text rendered in an unexpected/incorrect font instead of the system default.
- Display resolution, refresh rate, Windows display scaling, and NVIDIA Control Panel scaling settings all appeared correct and were not the cause.
- ClearType tuning did not resolve the issue on its own.

## Root Cause

The driver installation/reinstallation left the **Windows Font Cache Service (`FontCache`)** in a corrupted or stale state. Rather than a GPU rendering, scaling, or chroma-subsampling problem (all of which were investigated and ruled out), the actual defect was a **corrupted font cache**, likely triggered by the driver installer touching font-related resources, system fonts, or interrupting the font cache service during install.

Because the font cache stores pre-rendered/pre-processed glyph data used by the Windows rendering pipeline, a corrupted cache causes glyphs to be drawn incorrectly system-wide — producing the "blocky," inconsistent text described, and in some cases causing incorrect font substitution.

## Diagnostic Steps Taken (Ruled Out)

1. ClearType tuning wizard (`Adjust ClearType text`) — no effect.
2. Windows display resolution/refresh rate verification — correct, no effect.
3. NVIDIA Control Panel desktop scaling (GPU vs. Display) — correct, no effect.
4. Windows display scaling percentage — correct, no effect.
5. NVIDIA Control Panel output color format/dynamic range (RGB vs. YCbCr 4:2:0, ruled out as a possible chroma-subsampling cause) — not the root cause in this case.

## Fix

Rebuild the Windows Font Cache from an elevated PowerShell session:

```powershell
Stop-Service -Name fontcache -Force
Remove-Item -Path "$env:windir\ServiceProfiles\LocalService\AppData\Local\FontCache\*" -Recurse -Force
Start-Service -Name fontcache
```

Then **fully reboot** the machine (a sign-out/restart of the shell is not sufficient — the font cache and dependent rendering services need a full system restart to reload cleanly).

After reboot, text rendering returned to normal system-wide.

### Note on syntax

The equivalent Command Prompt (`cmd.exe`) syntax (`del /f /s /q ...`) will fail if run inside PowerShell, since PowerShell does not support those flags. Use the PowerShell cmdlets above (`Stop-Service`, `Remove-Item`, `Start-Service`) when working in a PowerShell terminal.

## Fallback Fix (Not Needed in This Case, But Recommended if Font Cache Rebuild Fails)

If clearing the font cache does not resolve the issue:

1. Use **DDU (Display Driver Uninstaller)** in Safe Mode to fully remove the NVIDIA driver and any leftover configuration.
2. Install the **previous stable Game Ready driver** (the version released before 617.14) using a clean install.
3. Report the regression to NVIDIA via their forums/feedback tool so it can be fixed upstream for other users.

## Recommendation

- Before/after installing a new NVIDIA driver, consider proactively clearing the font cache if any text rendering anomalies appear.
- Treat "blocky but not flickering" text as a font cache/rendering pipeline symptom first, before assuming a GPU scaling, chroma subsampling, or display configuration issue — those are more commonly associated with genuinely blurry or color-fringed text, not blocky/inconsistent glyphs.
