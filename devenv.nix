{ pkgs, ... }:

{
  languages.javascript = {
    enable = true;
    package = pkgs.nodejs-slim_22;
    pnpm.enable = true;
  };

  packages = with pkgs; [
    whisper-cpp
    ffmpeg
  ];
}
