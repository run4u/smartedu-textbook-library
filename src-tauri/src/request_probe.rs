use super::*;

// In-memory only. Never persist authorization headers or signed resource URLs.
#[derive(Clone, Deserialize)]
pub(super) struct ObservedRequest {
    pub url: String,
    pub auth: String,
}

fn normalize_url(value: &str) -> Option<tauri::Url> {
    let mut url = tauri::Url::parse(value).ok()?;
    url.set_fragment(None);
    Some(url)
}

pub(super) fn auth_for(requests: &[ObservedRequest], target: &str) -> Option<String> {
    let target = normalize_url(target)?;
    requests.iter().rev().find_map(|request| {
        (!request.auth.is_empty() && normalize_url(&request.url).as_ref() == Some(&target))
            .then(|| request.auth.clone())
    })
}

#[derive(Default)]
pub(super) struct CandidateWait {
    current: Option<(String, Duration)>,
}

impl CandidateWait {
    pub fn clear(&mut self) {
        self.current = None;
    }

    pub fn ready(&mut self, url: &str, elapsed: Duration, authorized: bool) -> bool {
        let url = normalize_url(url)
            .map(|url| url.to_string())
            .unwrap_or_else(|| url.into());
        if self.current.as_ref().map(|(known, _)| known) != Some(&url) {
            self.current = Some((url, elapsed));
        }
        authorized
            || self
                .current
                .as_ref()
                .is_some_and(|(_, seen)| elapsed.saturating_sub(*seen) >= Duration::from_secs(6))
    }
}

#[derive(Default)]
pub(super) struct RequestProbe {
    pub urls: Vec<String>,
    headers: Vec<ObservedRequest>,
}

impl RequestProbe {
    pub fn has_auth(&self) -> bool {
        !self.headers.is_empty()
    }

    pub fn remember(&mut self, url: String, auth: String) {
        let Some(url) = normalize_url(&url).filter(|url| matches!(url.scheme(), "http" | "https"))
        else {
            return;
        };
        let url = url.to_string();
        if !self.urls.contains(&url) {
            if self.urls.len() >= 512 {
                self.urls.remove(0);
            }
            self.urls.push(url.clone());
        }
        if !auth.is_empty() {
            self.headers.retain(|request| request.url != url);
            if self.headers.len() >= 128 {
                self.headers.remove(0);
            }
            self.headers.push(ObservedRequest { url, auth });
        }
    }

    pub fn auth_for(&self, target: &str) -> Option<String> {
        auth_for(&self.headers, target)
    }
}

#[cfg(windows)]
pub(super) async fn install(
    window: &WebviewWindow,
    probe: Arc<Mutex<RequestProbe>>,
) -> Result<(), String> {
    use webview2_com::{
        take_pwstr,
        Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_22, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
            COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
        },
        WebResourceRequestedEventHandler,
    };
    use windows_core::{Interface, HSTRING, PWSTR};
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window
        .with_webview(move |platform| {
            let result = (|| unsafe {
                let webview = platform
                    .controller()
                    .CoreWebView2()
                    .map_err(|error| error.to_string())?;
                let mut token = 0;
                webview
                    .add_WebResourceRequested(
                        &WebResourceRequestedEventHandler::create(Box::new(
                            move |_sender, args| {
                                if let Some(args) = args {
                                    let request = args.Request()?;
                                    let mut uri = PWSTR::null();
                                    request.Uri(&mut uri)?;
                                    let uri = take_pwstr(uri);
                                    let headers = request.Headers()?;
                                    let mut value = PWSTR::null();
                                    let auth = if headers
                                        .GetHeader(&HSTRING::from("X-Nd-Auth"), &mut value)
                                        .is_ok()
                                    {
                                        take_pwstr(value)
                                    } else {
                                        String::new()
                                    };
                                    if let Ok(mut probe) = probe.lock() {
                                        probe.remember(uri, auth);
                                    }
                                }
                                Ok(())
                            },
                        )),
                        &mut token,
                    )
                    .map_err(|error| error.to_string())?;
                if let Ok(modern) = webview.cast::<ICoreWebView2_22>() {
                    return modern
                        .AddWebResourceRequestedFilterWithRequestSourceKinds(
                            &HSTRING::from("*"),
                            COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                            COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
                        )
                        .map_err(|error| error.to_string());
                }
                webview
                    .AddWebResourceRequestedFilter(
                        &HSTRING::from("*"),
                        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                    )
                    .map_err(|error| error.to_string())
            })();
            let _ = sender.send(result);
        })
        .map_err(|error| error.to_string())?;
    tokio::time::timeout(Duration::from_secs(5), receiver)
        .await
        .map_err(|_| "Timed out installing browser request observer".to_string())?
        .map_err(|_| "Browser closed before request observer was ready".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn authorization_is_bound_to_the_exact_request() {
        let mut probe = RequestProbe::default();
        probe.remember("https://cdn.example/a.pdf?version=1".into(), "first".into());
        probe.remember("https://api.example/profile".into(), "unrelated".into());
        assert_eq!(
            probe
                .auth_for("https://cdn.example/a.pdf?version=1")
                .as_deref(),
            Some("first")
        );
        assert_eq!(
            probe
                .auth_for("https://cdn.example/a.pdf?version=1#page=2")
                .as_deref(),
            Some("first")
        );
        assert!(probe
            .auth_for("https://cdn.example/a.pdf?version=2")
            .is_none());
        probe.remember(
            "https://cdn.example/a.pdf?version=1".into(),
            "renewed".into(),
        );
        assert_eq!(
            probe
                .auth_for("https://cdn.example/a.pdf?version=1")
                .as_deref(),
            Some("renewed")
        );
    }
    #[test]
    fn late_pdf_discovery_gets_its_own_authorization_grace_period() {
        let mut wait = CandidateWait::default();
        let pdf = "https://cdn.example/late.pdf";
        assert!(!wait.ready(pdf, Duration::from_secs(40), false));
        assert!(!wait.ready(pdf, Duration::from_secs(45), false));
        assert!(wait.ready(pdf, Duration::from_secs(46), false));
    }

    #[test]
    fn changed_or_disappeared_candidate_resets_the_wait() {
        let mut wait = CandidateWait::default();
        assert!(!wait.ready("https://cdn.example/a.pdf", Duration::ZERO, false));
        assert!(!wait.ready("https://cdn.example/b.pdf", Duration::from_secs(9), false));
        assert!(wait.ready(
            "https://cdn.example/b.pdf#page=2",
            Duration::from_secs(15),
            false
        ));
        wait.clear();
        assert!(!wait.ready("https://cdn.example/b.pdf", Duration::from_secs(16), false));
        assert!(wait.ready("https://cdn.example/b.pdf", Duration::from_secs(16), true));
    }
}
