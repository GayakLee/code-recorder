# Licensing and third-party notices

## Original project work

Copyright (c) 2026 GayakLee and code-recorder contributors.

Original recording logic, TypeIt, synthesized typing sounds, MCP integration, scripts, documentation and original artwork are available under the root [MIT License](LICENSE). Upstream copyright notices remain intact. Original project additions do not transfer upstream ownership. Original intro captions and demonstration code are also MIT licensed; the editor UI retains its upstream rights.

## Upstream components

| Component | Ownership and license | Included here |
| --- | --- | --- |
| Code - OSS | Microsoft Corporation; MIT | Integration code and notices, not the full checkout |
| VSCodium | The VSCodium contributors, Peter Squicciarini and Microsoft Corporation; MIT plus bundled notices | Integration scripts, not runtime binaries |
| MCP TypeScript SDK | Anthropic, PBC; MIT | npm dependency declaration |
| Zod | Colin McDonnell; MIT | npm dependency declaration |

Preserved texts: [Code - OSS](licenses/Code-OSS-MIT.txt), [VSCodium](licenses/VSCodium-MIT.txt), [MCP SDK](licenses/MCP-SDK-MIT.txt), [Zod](licenses/Zod-MIT.txt).

References: [Code - OSS license](https://github.com/microsoft/vscode/blob/main/LICENSE.txt), [VSCodium license](https://github.com/VSCodium/vscodium/blob/master/LICENSE), [distribution FAQ](https://code.visualstudio.com/docs/supporting/faq).

Microsoft headers already present in integration files are retained conservatively. Project additions are MIT licensed by their contributors; these notices do not claim Microsoft authorship of those additions.

## Artwork and trademarks

Current SVG, PNG and ICO assets were drawn for this project using a generic editor-window, code-bracket and recording-circle motif. They do not embed the Microsoft Visual Studio Code logo. The icon builder no longer reads an installed Microsoft product.

Microsoft, Visual Studio Code and VSCodium names and marks remain with their respective owners. code-recorder is an independent project and is not endorsed by them.

See the [Microsoft brand guidelines](https://code.visualstudio.com/brand). MIT does not grant rights to third-party trademarks or proprietary artwork.

## External tools and distribution

FFmpeg is invoked as a separate system executable, not bundled here. Its license depends on the actual build and enabled components. Consult [FFmpeg legal information](https://ffmpeg.org/legal.html) and your executable's `-L` and `-buildconf` output before packaging it. Codec/patent questions are separate from source licensing.

Node.js, Electron, editor dependencies, fonts, extensions and optional icon-build tools retain their own terms. Keep the runtime's `LICENSE.txt`, `ThirdPartyNotices.txt` and other bundled notices when redistributing it. An installed extension does not become MIT licensed by this project.

This is a source-and-demo repository, not a complete binary distribution compliance report. Original project work is MIT licensed while upstream terms are preserved. This does not guarantee clearance of all future packaging, naming or distribution choices.
