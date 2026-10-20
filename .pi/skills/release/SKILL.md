---
name: release
description: Prepare and publish a version release for this project. Use when a user asks to select the next version, update flake.nix and package.json, commit the release, create an annotated tag, or push a release.
---

1. Read `AGENTS.md` and the release files.
2. Run `git status --short`.
3. Stop if the tree has changes that are not part of the release.
4. Run `git fetch --tags` before you select a tag.
5. Get the latest reachable tag with `git describe --tags --abbrev=0`.
6. Read `git log --oneline <tag>..HEAD` and `git diff <tag>..HEAD`.
7. Select the next version from the changes. Use a major version for breaking changes, a minor version for features, and a patch version for fixes. Ask the user if the version is not clear.
8. Update the same version in `package.json` and `flake.nix`.
9. Run the project checks from `AGENTS.md`.
10. Stage only `package.json` and `flake.nix`.
11. Run `git diff --cached`.
12. Commit with `chore: Bump version to <version>`.
13. Create an annotated tag with `git tag v<version> -m 'Release version v<version>'`.
14. Run `git show --stat v<version>` and `git status --short`.
15. Ask for confirmation before `git push` and `git push origin v<version>`.

Do not amend, rebase, force-push, or move an existing tag. Stop when a command fails. Do not create a release from a detached HEAD.
