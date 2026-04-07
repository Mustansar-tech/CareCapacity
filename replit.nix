{pkgs}: {
  deps = [
    pkgs.eudev
    pkgs.libxkbcommon
    pkgs.expat
    pkgs.fontconfig
    pkgs.gtk3
    pkgs.cairo
    pkgs.pango
    pkgs.dbus
    pkgs.cups
    pkgs.atk
    pkgs.at-spi2-atk
    pkgs.alsa-lib
    pkgs.xorg.libxcb
    pkgs.mesa
    pkgs.xorg.libXrandr
    pkgs.xorg.libXfixes
    pkgs.xorg.libXext
    pkgs.xorg.libXdamage
    pkgs.xorg.libXcomposite
    pkgs.xorg.libX11
    pkgs.libdrm
    pkgs.nspr
    pkgs.nss
    pkgs.glib
  ];
}
