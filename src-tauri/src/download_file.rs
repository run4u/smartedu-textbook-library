use std::{fs, io::Read, path::Path};

// Match Electron's file signature check. A signature inside an HTML response
// must not turn that response into a valid textbook.
pub fn has_pdf_signature(bytes: &[u8]) -> bool {
    bytes.starts_with(b"%PDF-")
}

pub fn validate_and_commit(part: &Path, target: &Path, expected_size: u64) -> Result<u64, String> {
    if part == target {
        return Err("Temporary and destination paths must differ".into());
    }
    let size = {
        let mut file = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(part)
            .map_err(|error| error.to_string())?;
        let mut header = [0; 5];
        file.read_exact(&mut header)
            .map_err(|error| format!("Cannot read PDF signature: {error}"))?;
        if !has_pdf_signature(&header) {
            return Err("Downloaded response is not a PDF".into());
        }
        let size = file.metadata().map_err(|error| error.to_string())?.len();
        if expected_size > 0 && size != expected_size {
            return Err(format!(
                "PDF size mismatch: expected {expected_size}, received {size}"
            ));
        }
        file.sync_all().map_err(|error| error.to_string())?;
        size
    };
    // Close the reader first and replace in one filesystem operation. Never
    // delete an existing textbook before knowing the replacement succeeded.
    fs::rename(part, target).map_err(|error| format!("Cannot commit PDF: {error}"))?;
    Ok(size)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    static NEXT: AtomicUsize = AtomicUsize::new(0);

    struct TestDir(std::path::PathBuf);
    impl TestDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "smartedu-file-test-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn rejects_html_containing_pdf_signature() {
        assert!(!has_pdf_signature(b"<html>%PDF-1.7</html>"));
        assert!(has_pdf_signature(b"%PDF-1.7\n"));
    }

    #[test]
    fn invalid_download_preserves_existing_file() {
        let dir = TestDir::new();
        let part = dir.0.join("book.part");
        let target = dir.0.join("book.pdf");
        fs::write(&target, b"existing textbook").unwrap();
        for bytes in [b"<html>denied</html>".as_slice(), b"%PDF-short".as_slice()] {
            fs::write(&part, bytes).unwrap();
            assert!(validate_and_commit(&part, &target, 100).is_err());
            assert_eq!(fs::read(&target).unwrap(), b"existing textbook");
        }
    }

    #[test]
    fn valid_download_replaces_existing_file() {
        let dir = TestDir::new();
        let part = dir.0.join("book.part");
        let target = dir.0.join("book.pdf");
        let bytes = b"%PDF-1.7\nfixture";
        fs::write(&part, bytes).unwrap();
        fs::write(&target, b"old").unwrap();
        assert_eq!(
            validate_and_commit(&part, &target, bytes.len() as u64).unwrap(),
            bytes.len() as u64
        );
        assert_eq!(fs::read(target).unwrap(), bytes);
        assert!(!part.exists());
    }
}
