fn main() {
    let mut build = cc::Build::new();
    build
        .std("c11")
        .include("src")
        .file("src/parser.c")
        .file("src/scanner.c");
    #[cfg(target_env = "msvc")]
    build.flag("-utf-8");
    build.compile("tree-sitter-ppphp");
    for path in ["src/parser.c", "src/scanner.c", "src/scanner.h", "src/tree_sitter"] {
        println!("cargo:rerun-if-changed={path}");
    }
}
