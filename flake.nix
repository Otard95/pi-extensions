{
  description = "Personal pi extensions package";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    systems.url = "github:nix-systems/default";
    flake-utils = {
      url = "github:numtide/flake-utils";
      inputs.systems.follows = "systems";
    };
  };

  outputs = { self, nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_22
            whisper-cpp
            ffmpeg
          ];
        };

        packages = {
          default = pkgs.buildNpmPackage {
            pname = "pi-extensions";
            version = "0.8.0";

            src = self;

            npmDepsHash = "sha256-0QjyuVoG9vOkHWFRiwB8rjQ5GWgNL0J5Ktr+QpP7goM=";

            npmPackFlags = [ "--ignore-scripts" ];
            npmInstallFlags = [ "--ignore-scripts" "--omit=dev" "--omit=peer" "--omit=optional" ];

            buildPhase = ''
              runHook preBuild
              mkdir -p $out/lib/{extensions,utils}
              runHook postBuild
            '';
            installPhase = ''
              runHook preBuild
              cp -r node_modules $out/lib/
              cp -r extensions $out/lib/
              cp -r utils $out/lib/
              cp package.json $out/lib/
              runHook postBuild
            '';

            meta = {
              description = "A pi-coding-agent package";
            };
          };
        };
      }
    );
}
