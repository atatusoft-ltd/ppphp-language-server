use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};
use zed_extension_api::Result;

pub(crate) const VERSION: &str = env!("CARGO_PKG_VERSION");
const MAX_SERVER_BYTES: u64 = 16 * 1024 * 1024;

/// Use only a complete, checksum-verified release from this extension host's
/// cache. A partial download or damaged cache is never returned for execution.
pub(crate) fn install(
    directory: &Path,
    version: &str,
    mut download: impl FnMut(&str, &Path) -> Result<()>,
) -> Result<PathBuf> {
    let cache = directory.join(format!("language-server-{version}"));
    let server = cache.join("server.cjs");
    let sums = cache.join("SHA256SUMS");
    let asset = format!("ppphp-language-server-{version}.cjs");
    if verify(&server, &sums, &asset).is_ok() {
        return Ok(server);
    }
    fs::create_dir_all(&cache).map_err(|e| format!("Could not create server cache: {e}"))?;
    let partial = cache.join("server.cjs.partial");
    let partial_sums = cache.join("SHA256SUMS.partial");
    let base = format!(
        "https://github.com/atatusoft-ltd/ppphp-language-server/releases/download/v{version}"
    );
    let result = (|| {
        download(&format!("{base}/SHA256SUMS"), &partial_sums)?;
        download(&format!("{base}/{asset}"), &partial)?;
        verify(&partial, &partial_sums, &asset)?;
        fs::rename(&partial, &server).map_err(|e| e.to_string())?;
        fs::rename(&partial_sums, &sums).map_err(|e| e.to_string())?;
        Ok(server)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&partial);
        let _ = fs::remove_file(&partial_sums);
    }
    result.map_err(|error: String| {
        format!(
            "Could not install ++PHP language server v{version}: {error}. \
         Check your connection and that the matching GitHub release and SHA256SUMS are published. \
         An existing server can be selected with lsp.ppphp-ls.binary."
        )
    })
}

fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.is_empty() || bytes.len() as u64 > limit {
        return Err("download is empty or exceeds the supported size".into());
    }
    Ok(bytes)
}

fn verify(server: &Path, sums: &Path, asset: &str) -> Result<()> {
    let bytes = read_bounded(sums, 64 * 1024)?;
    let text = std::str::from_utf8(&bytes).map_err(|e| e.to_string())?;
    let expected = text
        .lines()
        .find_map(|line| {
            let fields = line.split_whitespace().collect::<Vec<_>>();
            (fields.len() == 2
                && fields[1] == asset
                && fields[0].len() == 64
                && fields[0].bytes().all(|byte| byte.is_ascii_hexdigit()))
            .then(|| fields[0].to_ascii_lowercase())
        })
        .ok_or("release checksum is missing or malformed")?;
    let source = read_bounded(server, MAX_SERVER_BYTES)?;
    let actual = format!("{:x}", Sha256::digest(&source));
    if actual != expected {
        return Err("language-server SHA-256 checksum mismatch".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT: AtomicU64 = AtomicU64::new(0);
    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "ppphp-server-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn release_file(path: &Path, version: &str, source: &[u8]) -> Result<()> {
        if path.ends_with("SHA256SUMS.partial") {
            fs::write(
                path,
                format!(
                    "{:x}  ppphp-language-server-{version}.cjs\n",
                    Sha256::digest(source)
                ),
            )
            .unwrap();
        } else {
            fs::write(path, source).unwrap();
        }
        Ok(())
    }

    #[test]
    fn clean_host_installs_once_then_works_offline() {
        let root = Temp::new();
        let server = install(&root.0, "2026.3.2", |url, path| {
            assert!(url.starts_with("https://github.com/atatusoft-ltd/ppphp-language-server/releases/download/v2026.3.2/"));
            assert!(url.ends_with("/SHA256SUMS") || url.ends_with("/ppphp-language-server-2026.3.2.cjs"));
            release_file(path, "2026.3.2", b"release one")
        }).unwrap();
        assert!(server.is_absolute());
        assert_eq!(
            install(&root.0, "2026.3.2", |_, _| panic!(
                "cached installs must work offline"
            ))
            .unwrap(),
            server
        );
        let upgraded = install(&root.0, "2026.3.3", |_, path| {
            release_file(path, "2026.3.3", b"release two")
        })
        .unwrap();
        assert_ne!(upgraded, server);
        assert_eq!(fs::read(&server).unwrap(), b"release one");
    }

    #[test]
    fn interrupted_and_empty_downloads_are_not_reused() {
        let root = Temp::new();
        let error = install(&root.0, "2026.3.2", |_, path| {
            release_file(path, "2026.3.2", b"partial")?;
            if path.ends_with("server.cjs.partial") {
                Err("connection interrupted".into())
            } else {
                Ok(())
            }
        })
        .unwrap_err();
        assert!(error.contains("connection interrupted"));
        for name in ["server.cjs", "server.cjs.partial", "SHA256SUMS.partial"] {
            assert!(!root.0.join("language-server-2026.3.2").join(name).exists());
        }
        assert!(install(&root.0, "2026.3.2", |_, path| release_file(
            path, "2026.3.2", b""
        ))
        .unwrap_err()
        .contains("empty"));
        assert!(install(&root.0, "2026.3.2", |_, path| release_file(
            path,
            "2026.3.2",
            b"complete"
        ))
        .is_ok());
    }

    #[test]
    fn wrong_checksums_and_corrupted_caches_cannot_start() {
        let root = Temp::new();
        let error = install(&root.0, "2026.3.2", |_, path| {
            release_file(path, "2026.3.2", b"expected")?;
            if path.ends_with("server.cjs.partial") {
                fs::write(path, b"corrupt").unwrap();
            }
            Ok(())
        })
        .unwrap_err();
        assert!(error.contains("checksum mismatch"));
        let server = install(&root.0, "2026.3.2", |_, path| {
            release_file(path, "2026.3.2", b"expected")
        })
        .unwrap();
        fs::write(&server, "damaged cache").unwrap();
        let mut downloads = 0;
        install(&root.0, "2026.3.2", |_, path| {
            downloads += 1;
            release_file(path, "2026.3.2", b"expected")
        })
        .unwrap();
        assert_eq!(downloads, 2);
        assert_eq!(fs::read(server).unwrap(), b"expected");
    }
}
