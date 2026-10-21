#define MyAppName "iPresenterPlux"
#define MyAppPublisher "Lightworld Technologies Limited"
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceRoot
  #define SourceRoot "..\..\publish\windows-release"
#endif
#ifndef OutputRoot
  #define OutputRoot "..\..\publish\windows-release"
#endif

[Setup]
AppId={{A5B8BF57-B06E-4AB5-9D84-C57669DFD63D}
AppName={#MyAppName}
AppVersion={#AppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL=https://lightworldtech.com
AppSupportURL=https://lightworldtech.com
DefaultDirName={localappdata}\Programs\Lightworld Technologies\iPresenterPlux
DefaultGroupName=Lightworld Technologies\iPresenterPlux
PrivilegesRequired=lowest
OutputDir={#OutputRoot}
OutputBaseFilename=iPresenterPlux-Setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes
RestartApplications=no
UninstallDisplayIcon={app}\current\iPresenterPlux.Edge.Desktop.exe
SetupLogging=yes

[Files]
Source: "{#SourceRoot}\current\*"; DestDir: "{app}\current"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceRoot}\Lightworld.Update.Helper.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\iPresenterPlux"; Filename: "{app}\current\iPresenterPlux.Edge.Desktop.exe"; WorkingDir: "{app}\current"

[Run]
Filename: "{app}\current\iPresenterPlux.Edge.Desktop.exe"; Description: "Launch iPresenterPlux"; Flags: nowait postinstall skipifsilent
