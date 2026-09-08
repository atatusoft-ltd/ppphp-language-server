# ++PHP Tree-sitter grammar

This grammar extends the MIT-licensed PHP grammar at the revision in [UPSTREAM](UPSTREAM). The upstream grammar generator is vendored unchanged under `vendor`; its license is retained in [LICENSE](LICENSE). The scanner and Tree-sitter support headers are derived from the same revision.

The ++PHP rules add nested generic types, constrained generic declarations, nullable and union/intersection type expressions, typed local/loop bindings, `throws` clauses, and `when` expressions. They preserve the upstream PHP nodes so the Zed editing queries continue to work. Type and generic highlighting does not require Node.js, the language server, the compiler, or semantic-token settings.

Regenerate from the repository root with:

```shell
php scripts/build.php zed-grammar
```

The CLI version is locked in the root npm manifest. Commit `src/parser.c`, `src/grammar.json`, and `src/node-types.json`: Zed compiles these sources when packaging the grammar. CI regenerates them and rejects drift.

Run `php scripts/build.php zed-check` for query compilation, PHP compatibility, ++PHP parsing, native type captures, and generic-bracket tests. `editors/zed/extension.toml` and the Rust test dependency pin the same repository commit; update both when changing the grammar. Commit and push grammar changes first, then pin that commit in the adapter.

Tree-sitter supplies editing structure and lexical roles. The shared language server and ++PHP compiler remain responsible for semantic correctness, diagnostics, navigation, and edits.
