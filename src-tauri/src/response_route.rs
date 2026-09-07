use reqwest::Url;

pub struct ResponseRoute {
    expected: Url,
    redirects: u8,
}

fn normalize(mut url: Url) -> Url {
    url.set_fragment(None);
    url
}

impl ResponseRoute {
    pub fn new(url: &str) -> Result<Self, String> {
        let expected = normalize(Url::parse(url).map_err(|error| error.to_string())?);
        if expected.scheme() != "https" {
            return Err("PDF address must use HTTPS".into());
        }
        Ok(Self {
            expected,
            redirects: 0,
        })
    }

    pub fn matches(&self, url: &str) -> bool {
        Url::parse(url)
            .map(normalize)
            .is_ok_and(|url| url == self.expected)
    }

    pub fn redirect(&mut self, location: &str) -> Result<(), String> {
        if location.is_empty() || self.redirects >= 10 {
            return Err("Missing redirect destination or too many redirects".into());
        }
        let next = normalize(
            self.expected
                .join(location)
                .map_err(|error| error.to_string())?,
        );
        if next.scheme() != "https" || next == self.expected {
            return Err("Invalid PDF redirect".into());
        }
        self.expected = next;
        self.redirects += 1;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unrelated_pdf_and_case_or_query_changes() {
        let route = ResponseRoute::new("https://a.example/Book.pdf?version=1").unwrap();
        assert!(route.matches("https://a.example/Book.pdf?version=1#page=2"));
        assert!(!route.matches("https://b.example/Book.pdf?version=1"));
        assert!(!route.matches("https://a.example/book.pdf?version=1"));
        assert!(!route.matches("https://a.example/Book.pdf?version=2"));
    }

    #[test]
    fn follows_only_explicit_redirect_destinations() {
        let mut route = ResponseRoute::new("https://a.example/books/book.pdf").unwrap();
        route.redirect("../download?id=1").unwrap();
        assert!(route.matches("https://a.example/download?id=1"));
        route.redirect("https://cdn.example/object/123").unwrap();
        assert!(route.matches("https://cdn.example/object/123"));
        assert!(!route.matches("https://a.example/download?id=1"));
        assert!(route.redirect("http://cdn.example/object/123").is_err());
    }
}
