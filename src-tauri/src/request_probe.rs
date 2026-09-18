use super::*;

// In-memory only. Never persist authorization headers or signed resource URLs.
#[derive(Default)]
pub(super) struct RequestProbe {
    pub urls: Vec<String>,
    headers: Vec<(String, String)>,
}

impl RequestProbe {
    pub fn has_auth(&self) -> bool {
        !self.headers.is_empty()
    }

    pub fn remember(&mut self, url: String, auth: String) {
        if !self.urls.contains(&url) {
            if self.urls.len() >= 512 {
                self.urls.remove(0);
            }
            self.urls.push(url.clone());
        }
        if !auth.is_empty() {
            self.headers.retain(|(known, _)| known != &url);
            if self.headers.len() >= 128 {
                self.headers.remove(0);
            }
            self.headers.push((url, auth));
        }
    }

    pub fn auth_for(&self, target: &str) -> Option<String> {
        let mut target = tauri::Url::parse(target).ok()?;
        target.set_fragment(None);
        self.headers.iter().rev().find_map(|(url, auth)| {
            let mut url = tauri::Url::parse(url).ok()?;
            url.set_fragment(None);
            (url == target).then(|| auth.clone())
        })
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
}
