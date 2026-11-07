; Staaash Server for Windows. build.mjs passes VERSION, PAYLOAD, ICON and
; OUTFILE. The installer only copies files and asks questions; setup.mjs does
; the work, so an update and a first install run the same steps.

Unicode true
ManifestDPIAware true
ManifestLongPathAware true
RequestExecutionLevel admin
SetCompressor /SOLID lzma

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "x64.nsh"

!define PRODUCT "Staaash Server"
!define REG_KEY "Software\Staaash Server"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\StaaashServer"

Name "${PRODUCT}"
OutFile "${OUTFILE}"
InstallDir "$PROGRAMFILES64\Staaash Server"
BrandingText "Staaash ${VERSION}"
VIProductVersion "${VERSION_NUMBER}.0"
VIAddVersionKey "ProductName" "${PRODUCT}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "FileDescription" "${PRODUCT} installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "Staaash contributors"

Var DataDir
Var Port
Var Account
Var Firewall
Var Installed
Var PortField
Var AccountField
Var FirewallField

!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_ABORTWARNING

!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipOnUpdate
!insertmacro MUI_PAGE_LICENSE "${PAYLOAD}\LICENSE.txt"
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipOnUpdate
!insertmacro MUI_PAGE_DIRECTORY
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipOnUpdate
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE CheckDataDir
!define MUI_DIRECTORYPAGE_VARIABLE $DataDir
!define MUI_PAGE_HEADER_TEXT "Choose where your files live"
!define MUI_PAGE_HEADER_SUBTEXT "Uploaded files, the database, and logs go in this folder."
!define MUI_DIRECTORYPAGE_TEXT_TOP "Staaash keeps every uploaded file, its database, and its logs in this folder. Pick a drive with room for your files. Uninstalling never deletes it."
!define MUI_DIRECTORYPAGE_TEXT_DESTINATION "Data folder"
!insertmacro MUI_PAGE_DIRECTORY
Page custom OptionsPage OptionsPageLeave
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Open Staaash in the browser"
!define MUI_FINISHPAGE_RUN_FUNCTION OpenStaaash
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "Staaash Server needs 64-bit Windows." /SD IDOK
    Abort
  ${EndIf}
  SetRegView 64
  SetShellVarContext all

  ReadRegStr $Installed HKLM "${REG_KEY}" "Version"
  ReadRegStr $0 HKLM "${REG_KEY}" "InstallDir"
  ${If} $0 != ""
    StrCpy $INSTDIR $0
  ${EndIf}
  ReadRegStr $DataDir HKLM "${REG_KEY}" "DataDir"
  ReadRegStr $Port HKLM "${REG_KEY}" "Port"
  ReadRegStr $Account HKLM "${REG_KEY}" "Account"
  ReadRegStr $Firewall HKLM "${REG_KEY}" "Firewall"
  ${If} $DataDir == ""
    ; With SetShellVarContext all, $APPDATA is C:\ProgramData.
    StrCpy $DataDir "$APPDATA\Staaash"
  ${EndIf}
  ${If} $Port == ""
    StrCpy $Port "2113"
  ${EndIf}
  ${If} $Account == ""
    StrCpy $Account "NetworkService"
  ${EndIf}
  ${If} $Firewall == ""
    StrCpy $Firewall "1"
  ${EndIf}

  ; Silent installs: /DATA=D:\Staaash /PORT=2113 /ACCOUNT=LocalSystem /FIREWALL=0
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/DATA=" $R1
  ${IfNot} ${Errors}
    StrCpy $DataDir $R1
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "/PORT=" $R1
  ${IfNot} ${Errors}
    StrCpy $Port $R1
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "/ACCOUNT=" $R1
  ${IfNot} ${Errors}
    StrCpy $Account $R1
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "/FIREWALL=" $R1
  ${IfNot} ${Errors}
    StrCpy $Firewall $R1
  ${EndIf}
FunctionEnd

Function SkipOnUpdate
  ${If} $Installed != ""
    Abort
  ${EndIf}
FunctionEnd

Function CheckDataDir
  ; The app folder is replaced on every update, so data cannot live in it.
  StrLen $0 $INSTDIR
  StrCpy $1 $DataDir $0
  ${If} $1 == $INSTDIR
    MessageBox MB_ICONEXCLAMATION "Pick a data folder outside the Staaash Server program folder."
    Abort
  ${EndIf}
FunctionEnd

Function OptionsPage
  ${If} $Installed != ""
    Abort
  ${EndIf}
  !insertmacro MUI_HEADER_TEXT "Server options" "How other devices reach Staaash."
  nsDialogs::Create 1018
  Pop $0

  ${NSD_CreateLabel} 0 0 100% 12u "Web port"
  Pop $0
  ${NSD_CreateNumber} 0 13u 60u 12u $Port
  Pop $PortField

  ${NSD_CreateLabel} 0 36u 100% 12u "Run the Staaash services as"
  Pop $0
  ${NSD_CreateDropList} 0 49u 160u 12u ""
  Pop $AccountField
  ${NSD_CB_AddString} $AccountField "Network Service (recommended)"
  ${NSD_CB_AddString} $AccountField "Local System"
  ${If} $Account == "LocalSystem"
    ${NSD_CB_SelectString} $AccountField "Local System"
  ${Else}
    ${NSD_CB_SelectString} $AccountField "Network Service (recommended)"
  ${EndIf}
  ${NSD_CreateLabel} 0 64u 100% 20u "Network Service can only open its data folder. Local System can open anything on this computer."
  Pop $0

  ${NSD_CreateCheckbox} 0 92u 100% 12u "Let other devices on the network open Staaash (adds a Windows Firewall rule)"
  Pop $FirewallField
  ${If} $Firewall == "1"
    ${NSD_Check} $FirewallField
  ${EndIf}

  nsDialogs::Show
FunctionEnd

Function OptionsPageLeave
  ${NSD_GetText} $PortField $Port
  ${If} $Port < 1
  ${OrIf} $Port > 65535
    MessageBox MB_ICONEXCLAMATION "Enter a port from 1 to 65535."
    Abort
  ${EndIf}
  ${NSD_GetText} $AccountField $0
  ${If} $0 == "Local System"
    StrCpy $Account "LocalSystem"
  ${Else}
    StrCpy $Account "NetworkService"
  ${EndIf}
  ${NSD_GetState} $FirewallField $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $Firewall "1"
  ${Else}
    StrCpy $Firewall "0"
  ${EndIf}
FunctionEnd

Function OpenStaaash
  ExecShell "open" "http://localhost:$Port/"
FunctionEnd

; Runs setup.mjs with the Node.js that ships in this installer.
!macro Setup NODE SCRIPT ARGS
  nsExec::ExecToLog '"${NODE}" "${SCRIPT}" ${ARGS}'
  Pop $0
!macroend

Section "Staaash Server"
  SetRegView 64
  SetShellVarContext all

  ; Check before changing anything: no downgrade, no other PostgreSQL major.
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\setup"
  File "${PAYLOAD}\node\node.exe"
  File "${PAYLOAD}\setup\setup.mjs"
  File "${PAYLOAD}\setup\version.mjs"
  !insertmacro Setup "$PLUGINSDIR\setup\node.exe" "$PLUGINSDIR\setup\setup.mjs" 'precheck --installed "$Installed" --version "${VERSION}" --app "$INSTDIR" --data "$DataDir" --port "$Port" --account "$Account"'
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Nothing was changed. See the details below." /SD IDOK
    SetErrorLevel $0
    Abort
  ${EndIf}

  ${If} $Installed != ""
    DetailPrint "Stopping Staaash $Installed"
    !insertmacro Setup "$PLUGINSDIR\setup\node.exe" "$PLUGINSDIR\setup\setup.mjs" "stop"
    ${If} $0 != 0
      MessageBox MB_ICONSTOP "The Staaash services did not stop, so nothing was replaced." /SD IDOK
      SetErrorLevel $0
      Abort
    ${EndIf}
  ${EndIf}

  ; Replace the program files only. The data folder is never touched here.
  SetOutPath "$PLUGINSDIR"
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\node"
  RMDir /r "$INSTDIR\pgsql"
  RMDir /r "$INSTDIR\ffmpeg"
  RMDir /r "$INSTDIR\setup"
  RMDir /r "$INSTDIR\services"
  SetOutPath "$INSTDIR"
  File /r "${PAYLOAD}\*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  WriteRegStr HKLM "${REG_KEY}" "Version" "${VERSION}"
  WriteRegStr HKLM "${REG_KEY}" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "${REG_KEY}" "DataDir" "$DataDir"
  WriteRegStr HKLM "${REG_KEY}" "Port" "$Port"
  WriteRegStr HKLM "${REG_KEY}" "Account" "$Account"
  WriteRegStr HKLM "${REG_KEY}" "Firewall" "$Firewall"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "DisplayName" "${PRODUCT}"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "Publisher" "Staaash"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKLM "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $1 $2 $3
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "EstimatedSize" $1

  DetailPrint "Setting up the database and services"
  !insertmacro Setup "$INSTDIR\node\node.exe" "$INSTDIR\setup\setup.mjs" 'install --app "$INSTDIR" --data "$DataDir" --port "$Port" --account "$Account" --firewall "$Firewall"'
  ${If} $0 == 2
    MessageBox MB_ICONEXCLAMATION "Staaash did not start. See the logs in $DataDir\logs." /SD IDOK
    SetErrorLevel 2
  ${ElseIf} $0 != 0
    MessageBox MB_ICONSTOP "Setup failed. See the details below or $DataDir\logs\setup.log." /SD IDOK
    SetErrorLevel $0
    Abort
  ${EndIf}
SectionEnd

Function un.onInit
  SetRegView 64
  SetShellVarContext all
  ReadRegStr $DataDir HKLM "${REG_KEY}" "DataDir"
FunctionEnd

Section "Uninstall"
  !insertmacro Setup "$INSTDIR\node\node.exe" "$INSTDIR\setup\setup.mjs" 'uninstall --app "$INSTDIR"'
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "The Staaash services could not be removed. See the details below." /SD IDOK
    SetErrorLevel $0
    Abort
  ${EndIf}
  SetOutPath "$TEMP"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKLM "${UNINSTALL_KEY}"
  DeleteRegKey HKLM "${REG_KEY}"
  MessageBox MB_ICONINFORMATION "Your files and database are still in $DataDir. Delete that folder yourself to remove them." /SD IDOK
SectionEnd
