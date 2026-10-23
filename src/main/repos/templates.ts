// Starter files for new repositories. The .gitignore lists are written for Forklift (in the spirit of
// github/gitignore, CC0); license texts are the standard SPDX texts of short permissive licenses.

export const GITIGNORE_TEMPLATES: Record<string, { label: string; lines: string[] }> = {
  os: { label: 'macOS, Windows, Linux files', lines: ['.DS_Store', '._*', 'Thumbs.db', 'ehthumbs.db', 'Desktop.ini', '$RECYCLE.BIN/', '*~', '.directory'] },
  editors: { label: 'Editors and IDEs', lines: ['.vscode/*', '!.vscode/extensions.json', '!.vscode/settings.json', '.idea/', '*.iml', '*.swp', '*.swo', '.project', '.classpath', '.settings/'] },
  node: { label: 'Node.js', lines: ['node_modules/', 'npm-debug.log*', 'yarn-debug.log*', 'yarn-error.log*', 'pnpm-debug.log*', '.npm/', 'dist/', 'build/', 'coverage/', '.env', '.env.*', '!.env.example'] },
  python: { label: 'Python', lines: ['__pycache__/', '*.py[cod]', '*.egg-info/', '.eggs/', 'build/', 'dist/', '.venv/', 'venv/', '.pytest_cache/', '.mypy_cache/', '.ruff_cache/', '.coverage', 'htmlcov/', '.env'] },
  java: { label: 'Java (Maven, Gradle)', lines: ['*.class', '*.jar', '*.war', 'target/', '.gradle/', 'build/', '!gradle/wrapper/gradle-wrapper.jar', 'out/', 'hs_err_pid*'] },
  dotnet: { label: '.NET', lines: ['bin/', 'obj/', '*.user', '*.suo', '.vs/', 'TestResults/', '*.nupkg', 'packages/'] },
  go: { label: 'Go', lines: ['*.exe', '*.test', '*.out', '/vendor/', 'go.work.sum'] },
  rust: { label: 'Rust', lines: ['/target/', '**/*.rs.bk'] },
  c: { label: 'C and C++', lines: ['*.o', '*.obj', '*.a', '*.lib', '*.so', '*.dylib', '*.dll', '*.exe', '/build/', 'cmake-build-*/', 'CMakeCache.txt', 'CMakeFiles/', 'compile_commands.json'] },
};

const MIT = `MIT License

Copyright (c) {year} {holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

const ISC = `ISC License

Copyright (c) {year} {holder}

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
`;

const BSD_INTRO = `Copyright (c) {year} {holder}

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
`;

const BSD_DISCLAIMER = `
THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
`;

const UNLICENSE = `This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any
means.

In jurisdictions that recognize copyright laws, the author or authors
of this software dedicate any and all copyright interest in the
software to the public domain. We make this dedication for the benefit
of the public at large and to the detriment of our heirs and
successors. We intend this dedication to be an overt act of
relinquishment in perpetuity of all present and future rights to this
software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <https://unlicense.org>
`;

export const LICENSE_TEMPLATES: Record<string, { label: string; text: string }> = {
  MIT: { label: 'MIT', text: MIT },
  ISC: { label: 'ISC', text: ISC },
  'BSD-2-Clause': { label: 'BSD 2-Clause', text: `BSD 2-Clause License\n\n${BSD_INTRO}${BSD_DISCLAIMER}` },
  'BSD-3-Clause': {
    label: 'BSD 3-Clause',
    text: `BSD 3-Clause License\n\n${BSD_INTRO}\n3. Neither the name of the copyright holder nor the names of its\n   contributors may be used to endorse or promote products derived from\n   this software without specific prior written permission.\n${BSD_DISCLAIMER}`,
  },
  Unlicense: { label: 'Unlicense (public domain)', text: UNLICENSE },
};

export function gitignoreText(keys: readonly string[]): string {
  return keys
    .filter((key) => GITIGNORE_TEMPLATES[key])
    .map((key) => `# ${GITIGNORE_TEMPLATES[key]!.label}\n${GITIGNORE_TEMPLATES[key]!.lines.join('\n')}\n`)
    .join('\n');
}

export function licenseText(key: string, holder: string, year = new Date().getFullYear()): string | null {
  const template = LICENSE_TEMPLATES[key];
  return template ? template.text.replace('{year}', String(year)).replace('{holder}', holder || 'the authors') : null;
}
