# ++PHP Tree-sitter grammar

This grammar extends the MIT-licensed PHP grammar at the revision in [UPSTREAM](UPSTREAM). The upstream grammar generator is vendored unchanged under `vendor`; its license is retained in [LICENSE](LICENSE). The scanner and Tree-sitter support headers are derived from the same revision.

The ++PHP rules add nested generic types, constrained generic declarations, nullable and union/intersection type expressions, typed local/loop bindings, `throws` clauses, and `when` expressions. They preserve the upstream PHP nodes so the Zed editing queries continue to work. Type and generic highlighting does not require Node.js, the language server, the compiler, or semantic-token settings.

Regenerate from the repository root with:

```shell
php scripts/build.php zed-grammar
```

The CLI version is locked in the root npm manifest. Regenerate whenever the grammar **or generator dependency** changes. Commit the generated `src/parser.c`, `src/grammar.json`, `src/node-types.json`, and `src/tree_sitter` support headers: Zed compiles these sources when packaging the grammar. CI regenerates them and rejects drift.

Run `php scripts/build.php zed-check` for query compilation, PHP compatibility, ++PHP parsing, native type captures, and generic-bracket tests. The same suite runs against both this checkout's grammar and the adapter's pinned grammar, so local regressions cannot be hidden by a previously passing release. `editors/zed/extension.toml` and the adapter's Rust test dependency pin the same repository commit; update both when changing the grammar. Integrate validated grammar changes through `develop`, then pin that published commit in the adapter before release.

Tree-sitter supplies editing structure and lexical roles. The shared language server and ++PHP compiler remain responsible for semantic correctness, diagnostics, navigation, and edits.
