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
        packages = {
          default = pkgs.stdenv.mkDerivation (finalAttrs: {
            pname = "pi-extensions";
            version = "0.18.0";

            src = self;

            pnpmDeps = pkgs.fetchPnpmDeps {
              inherit (finalAttrs) pname version src;
              pnpm = pkgs.pnpm;
              fetcherVersion = 3;
              hash = "sha256-UD15GH/XXCu+x6c5jfX8ZvyR3a4e5Y1SWJUyPrbESNI=";
            };

            nativeBuildInputs = [
              pkgs.nodejs
              pkgs.pnpm
              pkgs.pnpmConfigHook
            ];

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
          });
        };
      }
    );
}
