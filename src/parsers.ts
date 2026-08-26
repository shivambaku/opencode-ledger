import { addDefaultParsers, getTreeSitterClient } from "@opentui/core"
import type { FiletypeParserOptions } from "@opentui/core"

const commonParsers: FiletypeParserOptions[] = [
  {
    filetype: "python",
    wasm: "https://github.com/tree-sitter/tree-sitter-python/releases/download/v0.23.6/tree-sitter-python.wasm",
    queries: {
      highlights: ["https://github.com/tree-sitter/tree-sitter-python/raw/refs/heads/master/queries/highlights.scm"],
    },
  },
  {
    filetype: "rust",
    wasm: "https://github.com/tree-sitter/tree-sitter-rust/releases/download/v0.24.0/tree-sitter-rust.wasm",
    queries: {
      highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/rust/highlights.scm"],
    },
  },
  {
    filetype: "go",
    wasm: "https://github.com/tree-sitter/tree-sitter-go/releases/download/v0.25.0/tree-sitter-go.wasm",
    queries: {
      highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/go/highlights.scm"],
    },
  },
  {
    filetype: "csharp",
    wasm: "https://github.com/tree-sitter/tree-sitter-c-sharp/releases/download/v0.23.1/tree-sitter-c_sharp.wasm",
    queries: {
      highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/c_sharp/highlights.scm"],
    },
  },
  {
    filetype: "c",
    wasm: "https://github.com/tree-sitter/tree-sitter-c/releases/download/v0.24.1/tree-sitter-c.wasm",
    queries: {
      highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/c/highlights.scm"],
    },
  },
  {
    filetype: "cpp",
    wasm: "https://github.com/tree-sitter/tree-sitter-cpp/releases/download/v0.23.4/tree-sitter-cpp.wasm",
    queries: {
      highlights: [
        "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/c/highlights.scm",
        "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/cpp/highlights.scm",
      ],
    },
  },
  {
    filetype: "java",
    wasm: "https://github.com/tree-sitter/tree-sitter-java/releases/download/v0.23.5/tree-sitter-java.wasm",
    queries: {
      highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/java/highlights.scm"],
    },
  },
  {
    filetype: "kotlin",
    wasm: "https://github.com/fwcd/tree-sitter-kotlin/releases/download/0.3.8/tree-sitter-kotlin.wasm",
    queries: {
      highlights: ["https://raw.githubusercontent.com/fwcd/tree-sitter-kotlin/0.3.8/queries/highlights.scm"],
    },
  },
  {
    filetype: "bash",
    wasm: "https://github.com/tree-sitter/tree-sitter-bash/releases/download/v0.25.0/tree-sitter-bash.wasm",
    queries: {
      highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/bash/highlights.scm"],
    },
  },
  {
    filetype: "json",
    wasm: "https://github.com/tree-sitter/tree-sitter-json/releases/download/v0.24.8/tree-sitter-json.wasm",
    queries: {
      highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/json/highlights.scm"],
    },
  },
  {
    filetype: "yaml",
    wasm: "https://github.com/tree-sitter-grammars/tree-sitter-yaml/releases/download/v0.7.2/tree-sitter-yaml.wasm",
    queries: {
      highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/yaml/highlights.scm"],
    },
  },
  {
    filetype: "toml",
    wasm: "https://github.com/tree-sitter-grammars/tree-sitter-toml/releases/download/v0.7.0/tree-sitter-toml.wasm",
    queries: {
      highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/master/queries/toml/highlights.scm"],
    },
  },
  {
    filetype: "html",
    wasm: "https://github.com/tree-sitter/tree-sitter-html/releases/download/v0.23.2/tree-sitter-html.wasm",
    queries: {
      highlights: ["https://github.com/tree-sitter/tree-sitter-html/raw/refs/heads/master/queries/highlights.scm"],
    },
  },
  {
    filetype: "css",
    wasm: "https://github.com/tree-sitter/tree-sitter-css/releases/download/v0.25.0/tree-sitter-css.wasm",
    queries: {
      highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/css/highlights.scm"],
    },
  },
  {
    filetype: "ruby",
    wasm: "https://github.com/tree-sitter/tree-sitter-ruby/releases/download/v0.23.1/tree-sitter-ruby.wasm",
    queries: {
      highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/ruby/highlights.scm"],
    },
  },
  {
    filetype: "php",
    wasm: "https://github.com/tree-sitter/tree-sitter-php/releases/download/v0.24.2/tree-sitter-php.wasm",
    queries: {
      highlights: ["https://github.com/tree-sitter/tree-sitter-php/raw/refs/heads/master/queries/highlights.scm"],
    },
  },
  {
    filetype: "swift",
    wasm: "https://github.com/alex-pinkus/tree-sitter-swift/releases/download/0.7.1/tree-sitter-swift.wasm",
    queries: {
      highlights: ["https://raw.githubusercontent.com/alex-pinkus/tree-sitter-swift/0.7.1/queries/highlights.scm"],
    },
  },
]

let registered = false

export function registerCommonParsers() {
  if (registered) return
  registered = true
  addDefaultParsers(commonParsers)
  const client = getTreeSitterClient()
  if (client.isInitialized()) {
    for (const parser of commonParsers) client.addFiletypeParser(parser)
  }
}
