// Monaco internals used to style codicons outside an editor; shipped without type declarations.
declare module 'monaco-editor/base/common/codicons' {}
declare module 'monaco-editor/base/common/codiconsUtil' {
  export function getCodiconFontCharacters(): Record<string, number>;
}
