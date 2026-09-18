#[cfg(windows)]
mod browser_download;
mod download_file;
mod request_probe;
mod response_route;
#[cfg(windows)]
use browser_download::start_browser_download;

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{
    webview::DownloadEvent, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

const VERSION_URL: &str =
    "https://s-file-2.ykt.cbern.com.cn/zxx/ndrs/resources/tch_material/version/data_version.json";
const DETAIL_PROBE_SCRIPT: &str = r#"
(() => {
  const state = window.__smarteduLiteProbe = window.__smarteduLiteProbe || { auth: '', urls: [] };
  const rememberUrl = (value) => {
    try {
      const url = typeof value === 'string' ? value : value && value.url;
      if (url && !state.urls.includes(url)) state.urls.push(url);
    } catch (_) {}
  };
  const rememberHeaders = (headers) => {
    try {
      new Headers(headers || {}).forEach((value, name) => {
        if (name.toLowerCase() === 'x-nd-auth' && value) state.auth = value;
      });
    } catch (_) {}
  };
  const originalFetch = window.fetch;
  if (originalFetch && !originalFetch.__smarteduLiteWrapped) {
    const wrappedFetch = function(input, init) {
      rememberUrl(input);
      rememberHeaders(input && input.headers);
      rememberHeaders(init && init.headers);
      return originalFetch.apply(this, arguments).then((response) => {
        rememberUrl(response && response.url);
        return response;
      });
    };
    wrappedFetch.__smarteduLiteWrapped = true;
    window.fetch = wrappedFetch;
  }
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function(method, url) {
    rememberUrl(url);
    return originalOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    if (String(name).toLowerCase() === 'x-nd-auth' && value) state.auth = String(value);
    return originalSetHeader.apply(this, arguments);
  };
})();
"#;

const READ_DETAIL_PROBE_SCRIPT: &str = r#"
(() => {
  const state = window.__smarteduLiteProbe || { auth: '', urls: [] };
  const performanceUrls = performance.getEntriesByType('resource').map((entry) => entry.name);
  return {
    html: document.documentElement ? document.documentElement.outerHTML : '',
    auth: state.auth || '',
    urls: Array.from(new Set([...(state.urls || []), ...performanceUrls]))
  };
})()
"#;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TextbookResource {
    content_id: String,
    title: String,
    stage: String,
    subject: String,
    grade: String,
    volume: String,
    edition: String,
    resource_year: String,
    online_time: String,
    update_time: String,
    size_bytes: u64,
    local_state: String,
}

struct BrowserDownloadFinished {
    path: Option<PathBuf>,
    success: bool,
    error: Option<String>,
}

type BrowserDownloadSender =
    Arc<Mutex<Option<tokio::sync::oneshot::Sender<BrowserDownloadFinished>>>>;

fn download_receiver_active(sender: &BrowserDownloadSender) -> bool {
    sender
        .lock()
        .map(|sender| sender.as_ref().is_some_and(|sender| !sender.is_closed()))
        .unwrap_or(false)
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogResponse {
    resources: Vec<TextbookResource>,
    source: String,
    cached_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    warning: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Filters {
    stage: String,
    subject: String,
    grade: String,
    volume: String,
    edition: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    download_directory: String,
    effective_download_directory: String,
    default_download_directory: String,
    filename_template: String,
    startup_filter_mode: String,
    default_filters: Filters,
    last_filters: Filters,
    default_skip_downloaded: bool,
    last_skip_downloaded: bool,
    default_view: String,
    download_notifications: bool,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SettingsPatch {
    filename_template: Option<String>,
    startup_filter_mode: Option<String>,
    default_filters: Option<Filters>,
    last_filters: Option<Filters>,
    default_skip_downloaded: Option<bool>,
    last_skip_downloaded: Option<bool>,
    default_view: Option<String>,
    download_notifications: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionStatus {
    has_saved_session: bool,
    auto_closed: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QueueTask {
    id: String,
    resource: TextbookResource,
    content_id: String,
    title: String,
    resource_year: String,
    size_bytes: u64,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    phase: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    received_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    total_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    updated_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    completed_at: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QueueState {
    batch_id: Option<String>,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    created_at: Option<String>,
    tasks: Vec<QueueTask>,
    history: Vec<Value>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LibraryItem {
    content_id: String,
    title: String,
    stage: String,
    subject: String,
    grade: String,
    volume: String,
    edition: String,
    resource_year: String,
    file_name: String,
    path: String,
    size: u64,
    completed_at: String,
    exists: bool,
}

#[derive(Deserialize)]
struct DetailProbe {
    html: String,
    auth: String,
    urls: Vec<String>,
}

struct AppState {
    settings: Mutex<AppSettings>,
    queue: Mutex<QueueState>,
    queue_runtime: Mutex<QueueRuntime>,
    settings_path: PathBuf,
    catalog_cache_path: PathBuf,
    library_path: PathBuf,
    queue_path: PathBuf,
}

#[derive(Default)]
struct QueueRuntime {
    worker_active: bool,
    active_signal: Option<Arc<AtomicU8>>,
}

const DOWNLOAD_RUNNING: u8 = 0;
const DOWNLOAD_PAUSED: u8 = 1;
const DOWNLOAD_CANCELED: u8 = 2;

enum DownloadFailure {
    Interrupted(u8),
    Failed(String),
}

fn now_string() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
}

fn attempt_id() -> String {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    format!(
        "{}-{}-{}",
        now_string(),
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    )
}

struct AttemptFile(PathBuf);
impl Drop for AttemptFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn ensure_worker_stopped(state: &AppState) -> Result<(), String> {
    if state
        .queue_runtime
        .lock()
        .map_err(|error| error.to_string())?
        .worker_active
    {
        return Err("上一项下载正在结束，请稍后重试".into());
    }
    Ok(())
}

fn iso_now() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| now_string())
}

fn default_settings(default_download_directory: String) -> AppSettings {
    AppSettings {
        download_directory: String::new(),
        effective_download_directory: default_download_directory.clone(),
        default_download_directory,
        filename_template: "{学段}_{学科}_{年级}_{册次}_{版本}_{年度}_{短ID}".into(),
        startup_filter_mode: "last".into(),
        default_filters: Filters::default(),
        last_filters: Filters::default(),
        default_skip_downloaded: true,
        last_skip_downloaded: true,
        default_view: "catalog".into(),
        download_notifications: true,
    }
}

fn string_at(value: &Value, path: &[&str]) -> String {
    let mut current = value;
    for key in path {
        current = &current[*key];
    }
    current.as_str().unwrap_or_default().to_string()
}

fn infer_from_title(title: &str, values: &[&str]) -> String {
    values
        .iter()
        .find(|value| title.contains(**value))
        .copied()
        .unwrap_or_default()
        .to_string()
}

fn normalize_resource(item: &Value) -> Option<TextbookResource> {
    let content_id = string_at(item, &["id"]);
    if content_id.is_empty() {
        return None;
    }
    let tags: HashMap<String, String> = item["tag_list"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|tag| {
            let id = string_at(tag, &["tag_dimension_id"]);
            let name = string_at(tag, &["tag_name"]);
            (!id.is_empty() && !name.is_empty()).then_some((id, name))
        })
        .collect();
    let title = match string_at(item, &["global_title", "zh-CN"]) {
        value if value.is_empty() => content_id.clone(),
        value => value,
    };
    let grade = tags.get("zxxnj").cloned().unwrap_or_else(|| {
        infer_from_title(
            &title,
            &[
                "一年级",
                "二年级",
                "三年级",
                "四年级",
                "五年级",
                "六年级",
                "七年级",
                "八年级",
                "九年级",
            ],
        )
    });
    let subject = tags.get("zxxxk").cloned().unwrap_or_else(|| {
        infer_from_title(
            &title,
            &[
                "语文",
                "数学",
                "英语",
                "物理",
                "化学",
                "生物",
                "历史",
                "地理",
                "道德与法治",
            ],
        )
    });
    let volume = tags
        .get("zxxcc")
        .cloned()
        .unwrap_or_else(|| infer_from_title(&title, &["上册", "下册", "全一册"]));
    let stage = tags.get("zxxxd").cloned().unwrap_or_else(|| {
        if ["一年级", "二年级", "三年级", "四年级", "五年级", "六年级"].contains(&grade.as_str())
        {
            "小学".into()
        } else if ["七年级", "八年级", "九年级"].contains(&grade.as_str()) {
            "初中".into()
        } else {
            String::new()
        }
    });
    Some(TextbookResource {
        content_id,
        title,
        stage,
        subject,
        grade,
        volume,
        edition: tags.get("zxxbb").cloned().unwrap_or_default(),
        resource_year: tags.get("bknd").cloned().unwrap_or_default(),
        online_time: string_at(item, &["online_time"]),
        update_time: string_at(item, &["update_time"]),
        size_bytes: item["custom_properties"]["size"]
            .as_u64()
            .unwrap_or_default(),
        local_state: "not-downloaded".into(),
    })
}

async fn fetch_catalog() -> Result<Vec<TextbookResource>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())?;
    let version: Value = client
        .get(VERSION_URL)
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json()
        .await
        .map_err(|error| error.to_string())?;
    let urls: Vec<String> = string_at(&version, &["urls"])
        .split(',')
        .map(str::trim)
        .filter(|url| !url.is_empty())
        .map(str::to_string)
        .collect();
    let parts = futures_util::future::try_join_all(urls.into_iter().map(|url| {
        let client = client.clone();
        async move {
            client
                .get(url)
                .send()
                .await
                .map_err(|error| error.to_string())?
                .error_for_status()
                .map_err(|error| error.to_string())?
                .json::<Value>()
                .await
                .map_err(|error| error.to_string())
        }
    }))
    .await?;
    let mut resources = Vec::new();
    for part in parts {
        if let Some(items) = part.as_array() {
            resources.extend(items.iter().filter_map(normalize_resource));
        }
    }
    Ok(resources)
}

fn idle_queue() -> QueueState {
    QueueState {
        batch_id: None,
        status: "idle".into(),
        created_at: None,
        tasks: vec![],
        history: vec![],
    }
}

fn persist_queue(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    let Ok(queue) = state.queue.lock().map(|queue| queue.clone()) else {
        return;
    };
    if let Ok(json) = serde_json::to_string_pretty(&queue) {
        let _ = fs::write(&state.queue_path, json);
    }
}

fn emit_queue(app: &tauri::AppHandle) -> QueueState {
    let queue = app
        .state::<AppState>()
        .queue
        .lock()
        .map(|queue| queue.clone())
        .unwrap_or_else(|_| idle_queue());
    let _ = app.emit("download:queue", queue.clone());
    queue
}

fn archive_current(queue: &mut QueueState) {
    if queue.tasks.is_empty() {
        return;
    }
    let archived = serde_json::json!({
        "id": queue.batch_id.clone(),
        "status": queue.status.clone(),
        "createdAt": queue.created_at.clone(),
        "updatedAt": iso_now(),
        "tasks": queue.tasks.clone(),
    });
    queue.history.insert(0, archived);
    queue.history.truncate(5);
}

fn part_path(resource: &TextbookResource, settings: &AppSettings) -> PathBuf {
    let target = PathBuf::from(&settings.effective_download_directory)
        .join(output_filename(resource, &settings.filename_template));
    PathBuf::from(format!("{}.part", target.to_string_lossy()))
}

fn mark_downloaded(resources: &mut [TextbookResource], library_path: &PathBuf) {
    let downloaded: std::collections::HashSet<String> = fs::read_to_string(library_path)
        .ok()
        .and_then(|json| serde_json::from_str::<Vec<LibraryItem>>(&json).ok())
        .unwrap_or_default()
        .into_iter()
        .filter(|item| PathBuf::from(&item.path).is_file())
        .map(|item| item.content_id)
        .collect();
    for resource in resources {
        resource.local_state = if downloaded.contains(&resource.content_id) {
            "downloaded"
        } else {
            "not-downloaded"
        }
        .into();
    }
}

fn is_credential_cookie_name(name: &str) -> bool {
    let name = name.to_ascii_uppercase();
    name == "UC_TOKEN"
        || name.starts_with("UC_TOKEN-")
        || name == "UC_SSO_TGC"
        || name.starts_with("UC_SSO_TGC-")
}

fn is_platform_domain(domain: Option<&str>) -> bool {
    domain.is_some_and(|value| {
        let value = value.trim_start_matches('.').to_ascii_lowercase();
        value == "smartedu.cn"
            || value.ends_with(".smartedu.cn")
            || value == "ykt.cbern.com.cn"
            || value.ends_with(".ykt.cbern.com.cn")
    })
}

fn is_platform_url(url: &tauri::Url) -> bool {
    url.host_str().is_some_and(|host| {
        let host = host.to_ascii_lowercase();
        host == "smartedu.cn"
            || host.ends_with(".smartedu.cn")
            || host == "ykt.cbern.com.cn"
            || host.ends_with(".ykt.cbern.com.cn")
    })
}

fn is_secure_url(url: &tauri::Url) -> bool {
    url.scheme() == "https"
}

fn session_cookie_values(window: &WebviewWindow) -> Result<HashMap<String, String>, String> {
    window
        .cookies()
        .map_err(|error| error.to_string())
        .map(|cookies| {
            cookies
                .into_iter()
                .filter(|cookie| {
                    is_platform_domain(cookie.domain())
                        && is_credential_cookie_name(cookie.name())
                        && !cookie.value().is_empty()
                        && cookie
                            .expires_datetime()
                            .map_or(true, |expires| expires > time::OffsetDateTime::now_utc())
                })
                .map(|cookie| {
                    let key = format!(
                        "{}:{}:{}",
                        cookie.domain().unwrap_or_default(),
                        cookie.path().unwrap_or_default(),
                        cookie.name()
                    );
                    (key, cookie.value().to_string())
                })
                .collect()
        })
}

fn cookie_window(app: &tauri::AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window("smartedu-login")
        .or_else(|| app.get_webview_window("main"))
        .ok_or_else(|| "未找到可用的应用窗口".to_string())
}

fn detail_url(resource: &TextbookResource) -> Result<tauri::Url, String> {
    let mut url = tauri::Url::parse("https://basic.smartedu.cn/tchMaterial/detail")
        .map_err(|error| error.to_string())?;
    url.query_pairs_mut()
        .append_pair("contentId", &resource.content_id)
        .append_pair("contentType", "assets_document")
        .append_pair("catalogType", "tchMaterial")
        .append_pair("subCatalog", "tchMaterial");
    Ok(url)
}

fn find_pdf_url(text: &str, content_id: &str) -> Option<String> {
    let normalized = text
        .replace("&amp;", "&")
        .replace("\\/", "/")
        .replace("\\u002F", "/")
        .replace("\\u002f", "/");
    let pattern = Regex::new(r#"https?://[^\s\"'<>\\]+"#).ok()?;
    let urls: Vec<&str> = pattern
        .find_iter(&normalized)
        .map(|item| item.as_str())
        .collect();
    let mut candidates = Vec::new();
    for raw in urls {
        let Ok(url) = reqwest::Url::parse(raw) else {
            continue;
        };
        let candidate = if url.path().to_ascii_lowercase().ends_with("viewer.html") {
            url.query_pairs()
                .find(|(name, _)| name == "file")
                .and_then(|(_, value)| url.join(&value).ok())
        } else if url.path().to_ascii_lowercase().ends_with(".pdf") {
            Some(url)
        } else {
            None
        };
        if let Some(candidate) = candidate.filter(is_secure_url) {
            candidates.push(candidate.to_string());
        }
    }
    // Rank actual PDF candidates, not every URL containing the content ID.
    candidates
        .iter()
        .find(|url| url.contains(content_id))
        .cloned()
        .or_else(|| candidates.into_iter().next())
}

fn contains_pdf_header(bytes: &[u8]) -> bool {
    download_file::has_pdf_signature(bytes)
}

fn byte_preview(bytes: &[u8]) -> String {
    bytes
        .iter()
        .take(16)
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(" ")
}

async fn read_detail_probe(window: &WebviewWindow) -> Result<DetailProbe, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let sender = Mutex::new(Some(sender));
    window
        .eval_with_callback(READ_DETAIL_PROBE_SCRIPT, move |result| {
            if let Ok(mut sender) = sender.lock() {
                if let Some(sender) = sender.take() {
                    let _ = sender.send(result);
                }
            }
        })
        .map_err(|error| error.to_string())?;
    let result = tokio::time::timeout(Duration::from_secs(5), receiver)
        .await
        .map_err(|_| "读取教材详情超时".to_string())?
        .map_err(|_| "教材详情窗口提前关闭".to_string())?;
    serde_json::from_str(&result).map_err(|error| format!("教材详情返回格式异常：{error}"))
}

async fn resolve_pdf(
    app: &tauri::AppHandle,
    resource: &TextbookResource,
    signal: &Arc<AtomicU8>,
    download_target: PathBuf,
) -> Result<
    (
        String,
        String,
        WebviewWindow,
        tokio::sync::oneshot::Receiver<BrowserDownloadFinished>,
        Arc<AtomicBool>,
        BrowserDownloadSender,
        Arc<Mutex<String>>,
    ),
    DownloadFailure,
> {
    let label = format!("smartedu-detail-{}", attempt_id());
    let detail = detail_url(resource).map_err(DownloadFailure::Failed)?;
    let (download_sender, download_receiver) = tokio::sync::oneshot::channel();
    let download_sender: BrowserDownloadSender = Arc::new(Mutex::new(Some(download_sender)));
    let callback_sender = download_sender.clone();
    let download_started = Arc::new(AtomicBool::new(false));
    let response_observation = Arc::new(Mutex::new(String::new()));
    let callback_started = download_started.clone();
    let callback_target = download_target.clone();
    let native_probe = Arc::new(Mutex::new(request_probe::RequestProbe::default()));
    // Install native request hooks before the first platform navigation.
    let window = WebviewWindowBuilder::new(
        app,
        &label,
        WebviewUrl::External("about:blank".parse().unwrap()),
    )
    .title("正在解析教材详情")
    .visible(false)
    .initialization_script(DETAIL_PROBE_SCRIPT)
    // The platform can redirect textbook PDFs to CDN hosts outside the
    // login-domain allowlist. This hidden window only follows HTTPS URLs
    // discovered from the authenticated textbook detail page.
    .on_navigation(|url| url.as_str() == "about:blank" || is_secure_url(url))
    .on_download(move |_webview, event| {
        if cfg!(windows) {
            // Windows response transport owns the file. Never allow a
            // second browser download to write to the same destination.
            return false;
        }
        match event {
            DownloadEvent::Requested { destination, .. } => {
                *destination = callback_target.clone();
                callback_started.store(true, Ordering::Relaxed);
            }
            DownloadEvent::Finished { path, success, .. } => {
                if let Ok(mut sender) = callback_sender.lock() {
                    if let Some(sender) = sender.take() {
                        let _ = sender.send(BrowserDownloadFinished {
                            path,
                            success,
                            error: None,
                        });
                    }
                }
            }
            _ => {}
        }
        true
    })
    .build()
    .map_err(|error| DownloadFailure::Failed(format!("创建教材详情窗口失败：{error}")))?;
    let result = async {
        #[cfg(windows)]
        request_probe::install(&window, native_probe.clone()).await.map_err(DownloadFailure::Failed)?;
        window.navigate(detail).map_err(|error| DownloadFailure::Failed(error.to_string()))?;
        let started = std::time::Instant::now();
        let mut last_auth = String::new();
        let mut last_url_count = 0;
        let mut saw_auth = false;
        while started.elapsed() < Duration::from_secs(30) {
            tokio::time::sleep(Duration::from_millis(500)).await;
            let directive = signal.load(Ordering::Relaxed);
            if directive != DOWNLOAD_RUNNING {
                return Err(DownloadFailure::Interrupted(directive));
            }
            let probe = match read_detail_probe(&window).await {
                Ok(value) => value,
                Err(_) => DetailProbe { html: String::new(), auth: String::new(), urls: Vec::new() },
            };
            if !probe.auth.is_empty() { last_auth = probe.auth.clone(); }
            saw_auth |= !last_auth.is_empty();
            let native_urls = native_probe.lock().map(|probe| probe.urls.clone()).unwrap_or_default();
            last_url_count = probe.urls.len() + native_urls.len();
            let mut searchable = probe.html;
            searchable.push('\n');
            searchable.push_str(&probe.urls.join("\n"));
            searchable.push('\n');
            searchable.push_str(&native_urls.join("\n"));
            if let Some(pdf_url) = find_pdf_url(&searchable, &resource.content_id) {
                let exact_auth = native_probe.lock().ok().and_then(|probe| probe.auth_for(&pdf_url));
                // A viewer URL can appear before its authenticated fetch runs.
                // Prefer the target request's header, including requests in frames.
                if let Some(auth) = exact_auth { return Ok((pdf_url, auth)); }
                if started.elapsed() >= Duration::from_secs(6) {
                    // Windows uses only a header observed on this exact request.
                    // Public/signed PDFs may legitimately use cookies without it.
                    #[cfg(windows)]
                    return Ok((pdf_url, String::new()));
                    #[cfg(not(windows))]
                    return Ok((pdf_url, last_auth.clone()));
                }
            }
        }
        Err(DownloadFailure::Failed(format!(
            "未能从教材详情解析到 PDF 地址（捕获请求 {last_url_count} 个，授权信息{}）；请确认登录状态和资源权限",
            if saw_auth { "已出现" } else { "未出现" }
        )))
    }
    .await;
    match result {
        Ok((pdf_url, auth)) => Ok((
            pdf_url,
            auth,
            window,
            download_receiver,
            download_started,
            download_sender,
            response_observation,
        )),
        Err(error) => {
            let _ = window.close();
            Err(error)
        }
    }
}

#[cfg(not(windows))]
async fn start_browser_download(
    window: &WebviewWindow,
    pdf_url: &str,
    auth: &str,
    _referer: &str,
    _target: PathBuf,
    _finished_sender: BrowserDownloadSender,
    _response_started: Arc<AtomicBool>,
    _response_observation: Arc<Mutex<String>>,
) -> Result<(), String> {
    let pdf_url = serde_json::to_string(pdf_url).map_err(|error| error.to_string())?;
    let auth = serde_json::to_string(auth).map_err(|error| error.to_string())?;
    let script = format!(
        r#"
(() => {{
  const state = window.__smarteduLiteDownload = {{
    status: 'fetching', loaded: 0, total: 0, error: ''
  }};
  const request = new XMLHttpRequest();
  request.open('GET', {pdf_url}, true);
  request.responseType = 'blob';
  request.withCredentials = true;
  const auth = {auth};
  if (auth) request.setRequestHeader('X-Nd-Auth', auth);
  request.onprogress = (event) => {{
    state.loaded = Number(event.loaded || 0);
    state.total = Number(event.lengthComputable ? event.total : 0);
  }};
  request.onerror = () => {{
    state.status = 'error';
    state.error = '浏览器请求 PDF 失败，请检查网络后重试';
  }};
  request.onabort = () => {{
    state.status = 'error';
    state.error = '浏览器下载已中断';
  }};
  request.onload = () => {{
    if (request.status < 200 || request.status >= 300) {{
      state.status = 'error';
      state.error = `浏览器请求 PDF 失败：HTTP ${{request.status}}`;
      return;
    }}
    state.loaded = request.response.size;
    if (!state.total) state.total = request.response.size;
    state.status = 'saving';
    const objectUrl = URL.createObjectURL(request.response);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = 'textbook.pdf';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  }};
  request.send();
  return true;
}})()
"#
    );
    window.eval(&script).map_err(|error| error.to_string())
}

fn sanitize_filename(value: &str) -> String {
    let invalid = Regex::new(r#"[\\/:*?\"<>|\x00-\x1f]"#).expect("valid filename regex");
    let repeated = Regex::new(r"_+").expect("valid underscore regex");
    repeated
        .replace_all(&invalid.replace_all(value, "_"), "_")
        .trim()
        .trim_end_matches(&['.', ' '][..])
        .to_string()
}

fn output_filename(resource: &TextbookResource, template: &str) -> String {
    let source = if template.trim().is_empty() {
        "{学段}_{学科}_{年级}_{册次}_{版本}_{年度}_{短ID}"
    } else {
        template
    };
    let short_id = resource.content_id.chars().take(8).collect::<String>();
    let replacements = [
        ("{教材名称}", resource.title.as_str()),
        ("{学段}", resource.stage.as_str()),
        ("{学科}", resource.subject.as_str()),
        ("{年级}", resource.grade.as_str()),
        ("{册次}", resource.volume.as_str()),
        ("{版本}", resource.edition.as_str()),
        ("{年度}", resource.resource_year.as_str()),
        ("{资源ID}", resource.content_id.as_str()),
        ("{短ID}", short_id.as_str()),
    ];
    let mut rendered = source.to_string();
    for (token, value) in replacements {
        rendered = rendered.replace(token, value);
    }
    rendered = Regex::new(r"\{[^{}]+\}")
        .expect("valid template regex")
        .replace_all(&rendered, "")
        .to_string();
    rendered = sanitize_filename(&rendered);
    if rendered.is_empty() {
        rendered = format!("教材_{short_id}");
    }
    rendered = Regex::new(r"(?i)\.pdf$")
        .expect("valid extension regex")
        .replace(&rendered, "")
        .to_string();
    if !source.contains("{短ID}") && !source.contains("{资源ID}") {
        rendered.push('_');
        rendered.push_str(&short_id);
    }
    format!("{rendered}.pdf")
}

fn update_task<F>(app: &tauri::AppHandle, task_id: &str, update: F)
where
    F: FnOnce(&mut QueueTask, &mut QueueState),
{
    let state = app.state::<AppState>();
    let snapshot = {
        let mut queue = match state.queue.lock() {
            Ok(value) => value,
            Err(_) => return,
        };
        let Some(index) = queue.tasks.iter().position(|task| task.id == task_id) else {
            return;
        };
        let mut task = queue.tasks.remove(index);
        update(&mut task, &mut queue);
        task.updated_at = Some(iso_now());
        queue.tasks.insert(index, task);
        queue.clone()
    };
    let _ = app.emit("download:queue", snapshot);
}

fn report_progress(
    app: &tauri::AppHandle,
    task_id: &str,
    phase: &str,
    message: &str,
    received_bytes: Option<u64>,
    total_bytes: Option<u64>,
) {
    update_task(app, task_id, |task, _queue| {
        task.phase = Some(phase.into());
        task.message = Some(message.into());
        task.received_bytes = received_bytes;
        task.total_bytes = total_bytes;
    });
    let state = app.state::<AppState>();
    if let Ok(queue) = state.queue.lock() {
        if let Some(task) = queue.tasks.iter().find(|task| task.id == task_id) {
            let _ = app.emit(
                "download:progress",
                serde_json::json!({
                    "taskId": task.id,
                    "contentId": task.content_id,
                    "phase": phase,
                    "message": message,
                    "receivedBytes": received_bytes,
                    "totalBytes": total_bytes,
                }),
            );
        }
    };
}

async fn save_library_item(app: &tauri::AppHandle, item: LibraryItem) -> Result<(), String> {
    let path = app.state::<AppState>().library_path.clone();
    let mut items: Vec<LibraryItem> = tokio::fs::read_to_string(&path)
        .await
        .ok()
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default();
    items.retain(|current| current.content_id != item.content_id);
    items.insert(0, item);
    tokio::fs::write(
        path,
        serde_json::to_vec_pretty(&items).map_err(|error| error.to_string())?,
    )
    .await
    .map_err(|error| error.to_string())
}

async fn download_single(
    app: tauri::AppHandle,
    resource: TextbookResource,
    task_id: String,
    signal: Arc<AtomicU8>,
) -> Result<(PathBuf, u64), DownloadFailure> {
    report_progress(
        &app,
        &task_id,
        "resolving",
        "正在验证登录并解析教材详情",
        None,
        None,
    );
    let settings = app
        .state::<AppState>()
        .settings
        .lock()
        .map_err(|error| DownloadFailure::Failed(error.to_string()))?
        .clone();
    let directory = PathBuf::from(&settings.effective_download_directory);
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(|error| DownloadFailure::Failed(error.to_string()))?;
    let target = directory.join(output_filename(&resource, &settings.filename_template));
    // A delayed callback must never overwrite or remove another attempt's file.
    let part = PathBuf::from(format!(
        "{}.{}.part",
        target.to_string_lossy(),
        attempt_id()
    ));
    let _attempt_file = AttemptFile(part.clone());
    let (
        pdf_url,
        auth,
        detail_window,
        mut download_receiver,
        download_started,
        download_sender,
        response_observation,
    ) = resolve_pdf(&app, &resource, &signal, part.clone()).await?;
    let referer = detail_url(&resource)
        .map_err(DownloadFailure::Failed)?
        .to_string();
    let directive = signal.load(Ordering::Relaxed);
    if directive != DOWNLOAD_RUNNING {
        download_receiver.close();
        let _ = detail_window.close();
        return Err(DownloadFailure::Interrupted(directive));
    }
    let start_result = start_browser_download(
        &detail_window,
        &pdf_url,
        &auth,
        &referer,
        part.clone(),
        download_sender,
        download_started.clone(),
        response_observation.clone(),
    )
    .await;
    if let Err(error) = start_result {
        download_receiver.close();
        let _ = detail_window.close();
        return Err(DownloadFailure::Failed(error));
    }
    report_progress(
        &app,
        &task_id,
        "downloading",
        "正在通过登录页面下载",
        Some(0),
        (resource.size_bytes > 0).then_some(resource.size_bytes),
    );
    let waiting_since = std::time::Instant::now();
    let finished = loop {
        let directive = signal.load(Ordering::Relaxed);
        if directive != DOWNLOAD_RUNNING {
            download_receiver.close();
            let _ = detail_window.close();
            if directive == DOWNLOAD_CANCELED {
                let _ = tokio::fs::remove_file(&part).await;
            }
            return Err(DownloadFailure::Interrupted(directive));
        }
        match download_receiver.try_recv() {
            Ok(finished) => break finished,
            Err(tokio::sync::oneshot::error::TryRecvError::Closed) => {
                let _ = detail_window.close();
                return Err(DownloadFailure::Failed("浏览器下载窗口提前关闭".into()));
            }
            Err(tokio::sync::oneshot::error::TryRecvError::Empty) => {}
        }
        let started = download_started.load(Ordering::Relaxed);
        if waiting_since.elapsed() > Duration::from_secs(300) {
            download_receiver.close();
            let _ = detail_window.close();
            return Err(DownloadFailure::Failed(
                "浏览器传输超过五分钟，任务已停止；可重试该教材".into(),
            ));
        }
        if !started && waiting_since.elapsed() > Duration::from_secs(30) {
            download_receiver.close();
            let _ = detail_window.close();
            let observation = response_observation
                .lock()
                .map(|value| value.clone())
                .unwrap_or_default();
            return Err(DownloadFailure::Failed(if observation.is_empty() {
                "WebView2 未捕获到 PDF 响应；详情页可能返回了不同的资源地址".into()
            } else {
                format!("WebView2 未能读取 PDF 响应（最后候选：{observation}）")
            }));
        }
        let received = tokio::fs::metadata(&part)
            .await
            .map(|metadata| metadata.len())
            .unwrap_or_default();
        report_progress(
            &app,
            &task_id,
            "downloading",
            if started {
                "正在通过登录页面下载"
            } else {
                "正在启动浏览器下载"
            },
            Some(received),
            (resource.size_bytes > 0).then_some(resource.size_bytes),
        );
        tokio::time::sleep(Duration::from_millis(500)).await;
    };
    let _ = detail_window.close();
    if !finished.success {
        let _ = tokio::fs::remove_file(&part).await;
        return Err(DownloadFailure::Failed(
            finished
                .error
                .unwrap_or_else(|| "浏览器未能完成 PDF 下载".into()),
        ));
    }
    let downloaded_path = finished.path.unwrap_or_else(|| part.clone());
    if downloaded_path != part && tokio::fs::metadata(&part).await.is_err() {
        tokio::fs::rename(&downloaded_path, &part)
            .await
            .map_err(|error| DownloadFailure::Failed(error.to_string()))?;
    }
    let received = tokio::fs::metadata(&part)
        .await
        .map_err(|error| DownloadFailure::Failed(format!("未找到浏览器下载文件：{error}")))?
        .len();
    let total = resource.size_bytes.max(received);
    let directive = signal.load(Ordering::Relaxed);
    if directive != DOWNLOAD_RUNNING {
        if directive == DOWNLOAD_CANCELED {
            let _ = tokio::fs::remove_file(&part).await;
        }
        return Err(DownloadFailure::Interrupted(directive));
    }
    report_progress(
        &app,
        &task_id,
        "verifying",
        "正在校验文件",
        Some(received),
        Some(total),
    );
    let commit_part = part.clone();
    let commit_target = target.clone();
    let expected_size = resource.size_bytes;
    let size = tauri::async_runtime::spawn_blocking(move || {
        download_file::validate_and_commit(&commit_part, &commit_target, expected_size)
    })
    .await
    .map_err(|error| DownloadFailure::Failed(error.to_string()))?
    .map_err(|error| DownloadFailure::Failed(format!("教材文件校验或保存失败：{error}")))?;
    save_library_item(
        &app,
        LibraryItem {
            content_id: resource.content_id.clone(),
            title: resource.title.clone(),
            stage: resource.stage.clone(),
            subject: resource.subject.clone(),
            grade: resource.grade.clone(),
            volume: resource.volume.clone(),
            edition: resource.edition.clone(),
            resource_year: resource.resource_year.clone(),
            file_name: target
                .file_name()
                .map(|value| value.to_string_lossy().into_owned())
                .unwrap_or_else(|| "教材.pdf".into()),
            path: target.to_string_lossy().into_owned(),
            size,
            completed_at: iso_now(),
            exists: true,
        },
    )
    .await
    .map_err(DownloadFailure::Failed)?;
    Ok((target, size))
}

#[tauri::command]
async fn load_catalog(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<CatalogResponse, String> {
    let cached = fs::read_to_string(&state.catalog_cache_path)
        .ok()
        .and_then(|json| serde_json::from_str::<CatalogResponse>(&json).ok())
        .filter(|response| !response.resources.is_empty());
    if let Some(mut response) = cached {
        response.source = "cache".into();
        response.warning = None;
        mark_downloaded(&mut response.resources, &state.library_path);
        let cache_path = state.catalog_cache_path.clone();
        let library_path = state.library_path.clone();
        tauri::async_runtime::spawn(async move {
            if let Ok(mut resources) = fetch_catalog().await {
                mark_downloaded(&mut resources, &library_path);
                let refreshed = CatalogResponse {
                    resources,
                    source: "official".into(),
                    cached_at: now_string(),
                    warning: None,
                };
                if let Ok(json) = serde_json::to_string(&refreshed) {
                    let _ = fs::write(cache_path, json);
                }
                let _ = app.emit("catalog:updated", refreshed);
            }
        });
        return Ok(response);
    }

    let mut resources = fetch_catalog().await?;
    mark_downloaded(&mut resources, &state.library_path);
    let response = CatalogResponse {
        resources,
        source: "official".into(),
        cached_at: now_string(),
        warning: None,
    };
    if let Ok(json) = serde_json::to_string(&response) {
        let _ = fs::write(&state.catalog_cache_path, json);
    }
    Ok(response)
}

#[tauri::command]
fn get_settings(state: tauri::State<'_, AppState>) -> Result<AppSettings, String> {
    state
        .settings
        .lock()
        .map(|settings| settings.clone())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn update_settings(
    settings: SettingsPatch,
    state: tauri::State<'_, AppState>,
) -> Result<AppSettings, String> {
    let queue = state.queue.lock().map_err(|error| error.to_string())?;
    if settings.filename_template.is_some()
        && (queue.status == "running" || queue.status == "paused")
    {
        return Err("下载任务进行中，不能修改文件名格式".into());
    }
    let mut saved = state.settings.lock().map_err(|error| error.to_string())?;
    let mut current = saved.clone();
    if let Some(value) = settings.filename_template {
        let value = value.trim();
        current.filename_template = if value.is_empty() {
            default_settings(current.default_download_directory.clone()).filename_template
        } else {
            value.chars().take(240).collect()
        };
    }
    if let Some(value) = settings.startup_filter_mode {
        if !matches!(value.as_str(), "defaults" | "last") {
            return Err("无效的启动筛选模式".into());
        }
        current.startup_filter_mode = value;
    }
    if let Some(value) = settings.default_filters {
        current.default_filters = value;
    }
    if let Some(value) = settings.last_filters {
        current.last_filters = value;
    }
    if let Some(value) = settings.default_skip_downloaded {
        current.default_skip_downloaded = value;
    }
    if let Some(value) = settings.last_skip_downloaded {
        current.last_skip_downloaded = value;
    }
    if let Some(value) = settings.default_view {
        if !matches!(value.as_str(), "catalog" | "tasks" | "library" | "settings") {
            return Err("无效的默认页面".into());
        }
        current.default_view = value;
    }
    if let Some(value) = settings.download_notifications {
        current.download_notifications = value;
    }
    fs::write(
        &state.settings_path,
        serde_json::to_string_pretty(&current).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    *saved = current.clone();
    Ok(current)
}

#[tauri::command]
async fn session_status(app: tauri::AppHandle) -> Result<SessionStatus, String> {
    let cookies = session_cookie_values(&cookie_window(&app)?)?;
    Ok(SessionStatus {
        has_saved_session: !cookies.is_empty(),
        auto_closed: false,
    })
}

#[tauri::command]
async fn open_login(app: tauri::AppHandle) -> Result<SessionStatus, String> {
    let baseline = session_cookie_values(&cookie_window(&app)?)?;
    if let Some(window) = app.get_webview_window("smartedu-login") {
        window.set_focus().map_err(|error| error.to_string())?;
    } else {
        WebviewWindowBuilder::new(
            &app,
            "smartedu-login",
            WebviewUrl::External(
                "https://basic.smartedu.cn/"
                    .parse()
                    .map_err(|error| format!("{error}"))?,
            ),
        )
        .title("登录国家智慧教育平台 - 轻量版原型")
        .inner_size(1080.0, 760.0)
        .min_inner_size(820.0, 600.0)
        .on_navigation(is_platform_url)
        .build()
        .map_err(|error| error.to_string())?;
    }
    let mut auto_closed = false;
    let mut stable_credentials = HashMap::new();
    let mut stable_since = std::time::Instant::now();
    while app.get_webview_window("smartedu-login").is_some() {
        tokio::time::sleep(Duration::from_secs(1)).await;
        let Some(window) = app.get_webview_window("smartedu-login") else {
            break;
        };
        let Ok(current) = session_cookie_values(&window) else {
            continue;
        };
        let has_new_credential = current
            .iter()
            .any(|(key, value)| baseline.get(key) != Some(value));
        // SSO tickets can arrive before the textbook application's token.
        // Keep the window alive until the redirect completes and cookies settle.
        if current != stable_credentials {
            stable_credentials = current.clone();
            stable_since = std::time::Instant::now();
        }
        let ready = window.url().ok().is_some_and(|url| {
            url.scheme() == "https" && url.host_str() == Some("basic.smartedu.cn")
        });
        let has_app_token = current.keys().any(|key| {
            let name = key
                .rsplit(':')
                .next()
                .unwrap_or_default()
                .to_ascii_uppercase();
            name == "UC_TOKEN" || name.starts_with("UC_TOKEN-")
        });
        if has_new_credential
            && has_app_token
            && ready
            && stable_since.elapsed() >= Duration::from_secs(3)
        {
            auto_closed = true;
            window.close().map_err(|error| error.to_string())?;
        }
    }
    let mut status = session_status(app).await?;
    status.auto_closed = auto_closed;
    Ok(status)
}

#[tauri::command]
async fn clear_session(app: tauri::AppHandle) -> Result<SessionStatus, String> {
    {
        let state = app.state::<AppState>();
        let queue = state.queue.lock().map_err(|error| error.to_string())?;
        if queue.status == "running" || queue.status == "paused" {
            return Err("请先取消下载任务，再清除登录状态".into());
        }
        ensure_worker_stopped(&state)?;
    }
    cookie_window(&app)?
        .clear_all_browsing_data()
        .map_err(|error| error.to_string())?;
    Ok(SessionStatus {
        has_saved_session: false,
        auto_closed: false,
    })
}
#[tauri::command]
fn download_state(state: tauri::State<'_, AppState>) -> Result<QueueState, String> {
    state
        .queue
        .lock()
        .map(|queue| queue.clone())
        .map_err(|error| error.to_string())
}

fn ensure_queue_worker(app: tauri::AppHandle) {
    let should_start = {
        let state = app.state::<AppState>();
        let Ok(mut runtime) = state.queue_runtime.lock() else {
            return;
        };
        if runtime.worker_active {
            false
        } else {
            runtime.worker_active = true;
            true
        }
    };
    if !should_start {
        return;
    }
    tauri::async_runtime::spawn(async move {
        run_queue_worker(app.clone()).await;
        {
            let state = app.state::<AppState>();
            if let Ok(mut runtime) = state.queue_runtime.lock() {
                runtime.worker_active = false;
                runtime.active_signal = None;
            };
        }
        let restart = app
            .state::<AppState>()
            .queue
            .lock()
            .map(|queue| {
                queue.status == "running" && queue.tasks.iter().any(|task| task.status == "queued")
            })
            .unwrap_or(false);
        if restart {
            ensure_queue_worker(app);
        }
    });
}

async fn run_queue_worker(app: tauri::AppHandle) {
    loop {
        let (next, completed_batch) = {
            let state = app.state::<AppState>();
            let Ok(mut queue) = state.queue.lock() else {
                return;
            };
            if queue.status != "running" {
                (None, false)
            } else if let Some(index) = queue.tasks.iter().position(|task| task.status == "queued")
            {
                let task = &mut queue.tasks[index];
                task.status = "running".into();
                task.phase = Some("resolving".into());
                task.message = Some("正在准备教材详情".into());
                task.error = None;
                task.started_at = Some(iso_now());
                task.completed_at = None;
                task.updated_at = Some(iso_now());
                let signal = Arc::new(AtomicU8::new(DOWNLOAD_RUNNING));
                if let Ok(mut runtime) = state.queue_runtime.lock() {
                    runtime.active_signal = Some(signal.clone());
                }
                (
                    Some((task.id.clone(), task.resource.clone(), signal)),
                    false,
                )
            } else {
                queue.status = "complete".into();
                (None, true)
            }
        };
        if completed_batch {
            persist_queue(&app);
            emit_queue(&app);
            return;
        }
        let Some((task_id, resource, signal)) = next else {
            return;
        };
        persist_queue(&app);
        emit_queue(&app);

        let result = download_single(app.clone(), resource, task_id.clone(), signal).await;
        if let Ok(mut runtime) = app.state::<AppState>().queue_runtime.lock() {
            runtime.active_signal = None;
        }
        {
            let state = app.state::<AppState>();
            let Ok(mut queue) = state.queue.lock() else {
                return;
            };
            let queue_status = queue.status.clone();
            let Some(task) = queue.tasks.iter_mut().find(|task| task.id == task_id) else {
                continue;
            };
            match result {
                Ok((_path, size)) if queue_status != "canceled" => {
                    task.status = "complete".into();
                    task.phase = Some("complete".into());
                    task.message = Some("下载完成".into());
                    task.received_bytes = Some(size);
                    task.total_bytes = Some(size);
                    task.error = None;
                    task.completed_at = Some(iso_now());
                }
                Ok(_) | Err(DownloadFailure::Interrupted(DOWNLOAD_CANCELED)) => {
                    task.status = "canceled".into();
                    task.phase = Some("canceled".into());
                    task.message = Some("已取消".into());
                    task.error = None;
                    task.completed_at = Some(iso_now());
                }
                Err(DownloadFailure::Interrupted(_)) => {
                    if queue_status == "running" {
                        task.status = "queued".into();
                        task.phase = Some("queued".into());
                        task.message = Some("等待继续下载".into());
                    } else {
                        task.status = "paused".into();
                        task.phase = Some("paused".into());
                        task.message = Some("已暂停，可继续下载".into());
                    }
                }
                Err(DownloadFailure::Failed(error)) => {
                    if queue_status == "paused" {
                        task.status = "paused".into();
                        task.phase = Some("paused".into());
                        task.message = Some("已暂停，可继续下载".into());
                    } else if queue_status == "canceled" {
                        task.status = "canceled".into();
                        task.phase = Some("canceled".into());
                        task.message = Some("已取消".into());
                    } else {
                        task.status = "error".into();
                        task.phase = Some("error".into());
                        task.message = Some(error.clone());
                        task.error = Some(error);
                        task.completed_at = Some(iso_now());
                    }
                }
            }
            task.updated_at = Some(iso_now());
        }
        persist_queue(&app);
        emit_queue(&app);
    }
}

#[tauri::command]
async fn start_download(
    resources: Vec<TextbookResource>,
    app: tauri::AppHandle,
) -> Result<QueueState, String> {
    if resources.is_empty() {
        return Err("请至少选择一本教材".into());
    }
    if !session_status(app.clone()).await?.has_saved_session {
        return Err("尚未检测到平台登录档案，请先登录".into());
    }
    let created_at = iso_now();
    let state = app.state::<AppState>();
    let mut queue = state.queue.lock().map_err(|error| error.to_string())?;
    ensure_worker_stopped(&state)?;
    if queue.status == "running" || queue.status == "paused" {
        return Err("已有正在进行的下载任务，请先暂停、取消或等待其完成".into());
    }
    archive_current(&mut queue);
    let history = std::mem::take(&mut queue.history);
    let batch_stamp = attempt_id();
    *queue = QueueState {
        batch_id: Some(format!("lite-batch-{batch_stamp}")),
        status: "running".into(),
        created_at: Some(created_at.clone()),
        tasks: resources
            .into_iter()
            .enumerate()
            .map(|(index, resource)| QueueTask {
                id: format!("lite-task-{batch_stamp}-{index}"),
                content_id: resource.content_id.clone(),
                title: resource.title.clone(),
                resource_year: resource.resource_year.clone(),
                size_bytes: resource.size_bytes,
                resource,
                status: "queued".into(),
                error: None,
                phase: Some("queued".into()),
                message: Some("等待下载".into()),
                received_bytes: None,
                total_bytes: None,
                updated_at: Some(created_at.clone()),
                started_at: None,
                completed_at: None,
            })
            .collect(),
        history,
    };
    let snapshot = queue.clone();
    drop(queue);
    persist_queue(&app);
    let _ = app.emit("download:queue", snapshot.clone());
    ensure_queue_worker(app);
    Ok(snapshot)
}
#[tauri::command]
fn pause_download(app: tauri::AppHandle) -> Result<QueueState, String> {
    let state = app.state::<AppState>();
    let snapshot = {
        let mut queue = state.queue.lock().map_err(|error| error.to_string())?;
        if queue.status != "running" {
            return Ok(queue.clone());
        }
        queue.status = "paused".into();
        for task in &mut queue.tasks {
            if task.status == "queued" || task.status == "running" {
                task.status = "paused".into();
                task.phase = Some("paused".into());
                task.message = Some("已暂停".into());
                task.updated_at = Some(iso_now());
            }
        }
        queue.clone()
    };
    if let Ok(runtime) = state.queue_runtime.lock() {
        if let Some(signal) = &runtime.active_signal {
            signal.store(DOWNLOAD_PAUSED, Ordering::Relaxed);
        }
    }
    persist_queue(&app);
    let _ = app.emit("download:queue", snapshot.clone());
    Ok(snapshot)
}
#[tauri::command]
fn resume_download(app: tauri::AppHandle) -> Result<QueueState, String> {
    let snapshot = {
        let state = app.state::<AppState>();
        let mut queue = state.queue.lock().map_err(|error| error.to_string())?;
        if queue.status != "paused" {
            return Ok(queue.clone());
        }
        queue.status = "running".into();
        for task in &mut queue.tasks {
            if task.status == "paused" {
                task.status = "queued".into();
                task.phase = Some("queued".into());
                task.message = Some("等待继续下载".into());
                task.updated_at = Some(iso_now());
            }
        }
        queue.clone()
    };
    persist_queue(&app);
    let _ = app.emit("download:queue", snapshot.clone());
    ensure_queue_worker(app);
    Ok(snapshot)
}
#[tauri::command]
async fn cancel_download(app: tauri::AppHandle) -> Result<QueueState, String> {
    let state = app.state::<AppState>();
    let (snapshot, resources, settings) = {
        let mut queue = state.queue.lock().map_err(|error| error.to_string())?;
        if queue.status != "running" && queue.status != "paused" {
            return Ok(queue.clone());
        }
        queue.status = "canceled".into();
        let resources = queue
            .tasks
            .iter_mut()
            .filter_map(|task| {
                if task.status == "queued" || task.status == "paused" || task.status == "running" {
                    task.status = "canceled".into();
                    task.phase = Some("canceled".into());
                    task.message = Some("已取消".into());
                    task.completed_at = Some(iso_now());
                    task.updated_at = Some(iso_now());
                    Some(task.resource.clone())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();
        let settings = state
            .settings
            .lock()
            .map_err(|error| error.to_string())?
            .clone();
        (queue.clone(), resources, settings)
    };
    if let Ok(runtime) = state.queue_runtime.lock() {
        if let Some(signal) = &runtime.active_signal {
            signal.store(DOWNLOAD_CANCELED, Ordering::Relaxed);
        }
    }
    for resource in resources {
        let _ = tokio::fs::remove_file(part_path(&resource, &settings)).await;
    }
    persist_queue(&app);
    let _ = app.emit("download:queue", snapshot.clone());
    Ok(snapshot)
}
#[tauri::command]
fn retry_task(task_id: String, app: tauri::AppHandle) -> Result<QueueState, String> {
    let snapshot = {
        let state = app.state::<AppState>();
        let mut queue = state.queue.lock().map_err(|error| error.to_string())?;
        ensure_worker_stopped(&state)?;
        if queue.status == "running" || queue.status == "paused" {
            return Err("当前批次正在运行，无法重试".into());
        }
        let Some(task) = queue.tasks.iter_mut().find(|task| task.id == task_id) else {
            return Ok(queue.clone());
        };
        if task.status != "error" && task.status != "canceled" {
            return Ok(queue.clone());
        }
        task.status = "queued".into();
        task.phase = Some("queued".into());
        task.message = Some("等待重试".into());
        task.error = None;
        task.completed_at = None;
        task.updated_at = Some(iso_now());
        queue.status = "running".into();
        queue.clone()
    };
    persist_queue(&app);
    let _ = app.emit("download:queue", snapshot.clone());
    ensure_queue_worker(app);
    Ok(snapshot)
}
#[tauri::command]
fn retry_all_tasks(app: tauri::AppHandle) -> Result<QueueState, String> {
    let snapshot = {
        let state = app.state::<AppState>();
        let mut queue = state.queue.lock().map_err(|error| error.to_string())?;
        ensure_worker_stopped(&state)?;
        if queue.status == "running" || queue.status == "paused" {
            return Err("当前批次正在运行，无法重试".into());
        }
        let mut changed = false;
        for task in &mut queue.tasks {
            if task.status == "error" || task.status == "canceled" || task.status == "paused" {
                task.status = "queued".into();
                task.phase = Some("queued".into());
                task.message = Some("等待重试".into());
                task.error = None;
                task.completed_at = None;
                task.updated_at = Some(iso_now());
                changed = true;
            }
        }
        if !changed {
            return Ok(queue.clone());
        }
        queue.status = "running".into();
        queue.clone()
    };
    persist_queue(&app);
    let _ = app.emit("download:queue", snapshot.clone());
    ensure_queue_worker(app);
    Ok(snapshot)
}
#[tauri::command]
fn clear_finished_tasks(app: tauri::AppHandle) -> Result<QueueState, String> {
    let state = app.state::<AppState>();
    let mut queue = state.queue.lock().map_err(|error| error.to_string())?;
    ensure_worker_stopped(&state)?;
    if queue.status == "complete" || queue.status == "canceled" {
        queue.tasks.retain(|task| {
            task.status != "complete" && task.status != "error" && task.status != "canceled"
        });
        if queue.tasks.is_empty() {
            let history = std::mem::take(&mut queue.history);
            *queue = idle_queue();
            queue.history = history;
        }
    }
    let snapshot = queue.clone();
    drop(queue);
    persist_queue(&app);
    let _ = app.emit("download:queue", snapshot.clone());
    Ok(snapshot)
}
#[tauri::command]
fn clear_download_history(app: tauri::AppHandle) -> Result<QueueState, String> {
    let state = app.state::<AppState>();
    let mut queue = state.queue.lock().map_err(|error| error.to_string())?;
    queue.history.clear();
    let snapshot = queue.clone();
    drop(queue);
    persist_queue(&app);
    let _ = app.emit("download:queue", snapshot.clone());
    Ok(snapshot)
}
#[tauri::command]
async fn clear_all_task_records(app: tauri::AppHandle) -> Result<QueueState, String> {
    let state = app.state::<AppState>();
    let (resources, settings) = {
        let mut queue = state.queue.lock().map_err(|error| error.to_string())?;
        ensure_worker_stopped(&state)?;
        if queue.status == "running" || queue.status == "paused" {
            return Err("下载任务进行中，无法清除任务记录".into());
        }
        let resources = queue
            .tasks
            .iter()
            .map(|task| task.resource.clone())
            .collect::<Vec<_>>();
        let settings = state
            .settings
            .lock()
            .map_err(|error| error.to_string())?
            .clone();
        *queue = idle_queue();
        (resources, settings)
    };
    for resource in resources {
        let _ = tokio::fs::remove_file(part_path(&resource, &settings)).await;
    }
    persist_queue(&app);
    Ok(emit_queue(&app))
}
#[tauri::command]
fn list_library(state: tauri::State<'_, AppState>) -> Vec<LibraryItem> {
    let mut items: Vec<LibraryItem> = fs::read_to_string(&state.library_path)
        .ok()
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default();
    for item in &mut items {
        item.exists = PathBuf::from(&item.path).is_file();
    }
    items
}
fn save_download_directory(state: &AppState, directory: String) -> Result<AppSettings, String> {
    let queue = state.queue.lock().map_err(|error| error.to_string())?;
    if queue.status == "running" || queue.status == "paused" {
        return Err("下载任务进行中，不能修改下载目录".into());
    }
    ensure_worker_stopped(state)?;
    let mut saved = state.settings.lock().map_err(|error| error.to_string())?;
    let mut current = saved.clone();
    current.download_directory = directory;
    current.effective_download_directory = if current.download_directory.is_empty() {
        current.default_download_directory.clone()
    } else {
        current.download_directory.clone()
    };
    fs::create_dir_all(&current.effective_download_directory).map_err(|error| error.to_string())?;
    fs::write(
        &state.settings_path,
        serde_json::to_vec_pretty(&current).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    *saved = current.clone();
    Ok(current)
}

#[tauri::command]
async fn choose_download_directory(app: tauri::AppHandle) -> Result<AppSettings, String> {
    use tauri_plugin_dialog::DialogExt;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |folder| {
        let _ = sender.send(folder);
    });
    let folder = receiver.await.map_err(|error| error.to_string())?;
    let state = app.state::<AppState>();
    match folder {
        Some(folder) => save_download_directory(
            &state,
            folder
                .into_path()
                .map_err(|error| error.to_string())?
                .to_string_lossy()
                .into_owned(),
        ),
        None => get_settings(state),
    }
}

#[tauri::command]
fn reset_download_directory(state: tauri::State<'_, AppState>) -> Result<AppSettings, String> {
    save_download_directory(&state, String::new())
}

#[tauri::command]
fn open_download_directory(app: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_opener::OpenerExt;
    let settings = get_settings(app.state::<AppState>())?;
    fs::create_dir_all(&settings.effective_download_directory)
        .map_err(|error| error.to_string())?;
    app.opener()
        .open_path(&settings.effective_download_directory, None::<&str>)
        .map_err(|error| error.to_string())?;
    Ok(String::new())
}

fn library_file(state: &AppState, file_path: &str) -> Result<PathBuf, String> {
    let items: Vec<LibraryItem> = serde_json::from_str(
        &fs::read_to_string(&state.library_path).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    if !items.iter().any(|item| item.path == file_path) {
        return Err("文件不在本地教材库中".into());
    }
    let path = PathBuf::from(file_path);
    if !path.is_file() {
        return Err("教材文件已不存在，请刷新教材库".into());
    }
    Ok(path)
}

#[tauri::command]
fn open_library_file(file_path: String, app: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_opener::OpenerExt;
    let path = library_file(&app.state::<AppState>(), &file_path)?;
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|error| error.to_string())?;
    Ok(String::new())
}

#[tauri::command]
fn show_library_in_folder(file_path: String, app: tauri::AppHandle) -> Result<Value, String> {
    use tauri_plugin_opener::OpenerExt;
    let path = library_file(&app.state::<AppState>(), &file_path)?;
    app.opener()
        .reveal_item_in_dir(path)
        .map_err(|error| error.to_string())?;
    Ok(serde_json::json!({"ok": true}))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            let data_dir = app.path().app_data_dir()?;
            fs::create_dir_all(&data_dir)?;
            let default_download = app
                .path()
                .download_dir()?
                .join("SmartEdu Textbook Library Lite");
            let settings_path = data_dir.join("settings.json");
            let queue_path = data_dir.join("queue.json");
            let mut settings: AppSettings = fs::read_to_string(&settings_path)
                .ok()
                .and_then(|json| serde_json::from_str(&json).ok())
                .unwrap_or_else(|| {
                    default_settings(default_download.to_string_lossy().into_owned())
                });
            settings.default_download_directory = default_download.to_string_lossy().into_owned();
            settings.effective_download_directory = if settings.download_directory.is_empty() {
                settings.default_download_directory.clone()
            } else {
                settings.download_directory.clone()
            };
            let mut queue = fs::read_to_string(&queue_path)
                .ok()
                .and_then(|json| serde_json::from_str::<QueueState>(&json).ok())
                .unwrap_or_else(idle_queue);
            if queue.status == "running" {
                queue.status = "paused".into();
                for task in &mut queue.tasks {
                    if task.status == "running" || task.status == "queued" {
                        task.status = "paused".into();
                        task.phase = Some("paused".into());
                        task.message = Some("上次运行被中断，可继续下载".into());
                    }
                }
            }
            app.manage(AppState {
                settings: Mutex::new(settings),
                queue: Mutex::new(queue),
                queue_runtime: Mutex::new(QueueRuntime::default()),
                settings_path,
                catalog_cache_path: data_dir.join("catalog-cache.json"),
                library_path: data_dir.join("library.json"),
                queue_path,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_catalog,
            get_settings,
            update_settings,
            session_status,
            open_login,
            clear_session,
            download_state,
            start_download,
            pause_download,
            resume_download,
            cancel_download,
            retry_task,
            retry_all_tasks,
            clear_finished_tasks,
            clear_download_history,
            clear_all_task_records,
            list_library,
            choose_download_directory,
            reset_download_directory,
            open_download_directory,
            open_library_file,
            show_library_in_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}

#[cfg(test)]
mod tests {
    use super::{
        contains_pdf_header, find_pdf_url, is_credential_cookie_name, is_platform_domain,
        output_filename, TextbookResource,
    };

    fn resource() -> TextbookResource {
        TextbookResource {
            content_id: "abcdefgh-1234-5678-90ab-cdef01234567".into(),
            title: "数学/教材".into(),
            stage: "高中".into(),
            subject: "数学".into(),
            grade: "高中年级".into(),
            volume: "必修 第一册".into(),
            edition: "人教版（B版）".into(),
            resource_year: "2026年度".into(),
            online_time: String::new(),
            update_time: String::new(),
            size_bytes: 100,
            local_state: "not-downloaded".into(),
        }
    }

    #[test]
    fn recognizes_only_platform_credential_cookie_names() {
        assert!(is_credential_cookie_name("UC_TOKEN"));
        assert!(is_credential_cookie_name("UC_TOKEN-abc-product"));
        assert!(is_credential_cookie_name("UC_SSO_TGC"));
        assert!(is_credential_cookie_name("UC_SSO_TGC-login"));
        assert!(!is_credential_cookie_name("UC_TOKENIZED"));
        assert!(!is_credential_cookie_name("session_id"));
    }

    #[test]
    fn recognizes_only_smartedu_platform_domains() {
        assert!(is_platform_domain(Some(".smartedu.cn")));
        assert!(is_platform_domain(Some("basic.smartedu.cn")));
        assert!(is_platform_domain(Some("s-file-2.ykt.cbern.com.cn")));
        assert!(!is_platform_domain(Some("smartedu.cn.example.com")));
        assert!(!is_platform_domain(None));
    }

    #[test]
    fn finds_pdf_in_viewer_and_direct_urls() {
        let id = "abcdefgh-1234-5678-90ab-cdef01234567";
        let viewer = format!(
            "https://example.com/viewer.html?file=https%3A%2F%2Fcdn.example.com%2F{id}%2Fbook.pdf"
        );
        assert_eq!(
            find_pdf_url(&viewer, id).as_deref(),
            Some("https://cdn.example.com/abcdefgh-1234-5678-90ab-cdef01234567/book.pdf")
        );
        assert_eq!(
            find_pdf_url("https:\\/\\/cdn.example.com\\/book.pdf", id).as_deref(),
            Some("https://cdn.example.com/book.pdf")
        );
    }

    #[test]
    fn recognizes_pdf_header_within_initial_bytes() {
        assert!(contains_pdf_header(b"%PDF-1.7\n"));
        assert!(!contains_pdf_header(b"\xef\xbb\xbf%PDF-1.7\n"));
        assert!(!contains_pdf_header(b"<!doctype html>"));
    }

    #[test]
    fn renders_safe_unique_pdf_filename() {
        assert_eq!(
            output_filename(&resource(), "{教材名称}_{年度}"),
            "数学_教材_2026年度_abcdefgh.pdf"
        );
        assert_eq!(
            output_filename(&resource(), "{学科}_{短ID}.pdf"),
            "数学_abcdefgh.pdf"
        );
    }
    struct TestDirectory(std::path::PathBuf);
    impl TestDirectory {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("lite-regression-{}", super::attempt_id()));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn state(&self) -> super::AppState {
            super::AppState {
                settings: std::sync::Mutex::new(super::default_settings(
                    self.0.join("default").to_string_lossy().into_owned(),
                )),
                queue: std::sync::Mutex::new(super::idle_queue()),
                queue_runtime: std::sync::Mutex::new(super::QueueRuntime::default()),
                settings_path: self.0.join("settings.json"),
                catalog_cache_path: self.0.join("catalog.json"),
                library_path: self.0.join("library.json"),
                queue_path: self.0.join("queue.json"),
            }
        }
    }
    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn old_attempt_cleanup_preserves_retry_and_completed_book() {
        let dir = TestDirectory::new();
        let old = dir.0.join(format!("book.{}.part", super::attempt_id()));
        let retry = dir.0.join(format!("book.{}.part", super::attempt_id()));
        let target = dir.0.join("book.pdf");
        assert_ne!(old, retry);
        std::fs::write(&old, b"old attempt").unwrap();
        std::fs::write(&retry, b"new attempt").unwrap();
        std::fs::write(&target, b"completed book").unwrap();
        drop(super::AttemptFile(old.clone()));
        assert!(!old.exists());
        assert_eq!(std::fs::read(retry).unwrap(), b"new attempt");
        assert_eq!(std::fs::read(target).unwrap(), b"completed book");
    }

    #[test]
    fn cached_downloaded_flag_is_cleared_when_library_file_is_gone() {
        let dir = TestDirectory::new();
        let mut book = resource();
        book.local_state = "downloaded".into();
        let mut books = vec![book];
        super::mark_downloaded(&mut books, &dir.0.join("missing-library.json"));
        assert_eq!(books[0].local_state, "not-downloaded");
    }

    #[test]
    fn directory_selection_and_reset_persist_and_respect_active_worker() {
        let dir = TestDirectory::new();
        let state = dir.state();
        let custom = dir.0.join("custom").to_string_lossy().into_owned();
        let saved = super::save_download_directory(&state, custom.clone()).unwrap();
        assert_eq!(saved.effective_download_directory, custom);
        assert!(std::path::Path::new(&custom).is_dir());
        let persisted: super::AppSettings =
            serde_json::from_str(&std::fs::read_to_string(&state.settings_path).unwrap()).unwrap();
        assert_eq!(persisted.download_directory, custom);
        state.queue.lock().unwrap().status = "paused".into();
        assert!(super::save_download_directory(&state, String::new()).is_err());
        state.queue.lock().unwrap().status = "canceled".into();
        state.queue_runtime.lock().unwrap().worker_active = true;
        assert!(super::save_download_directory(&state, String::new()).is_err());
        assert!(super::ensure_worker_stopped(&state).is_err());
        state.queue_runtime.lock().unwrap().worker_active = false;
        let reset = super::save_download_directory(&state, String::new()).unwrap();
        assert!(reset.download_directory.is_empty());
        assert_eq!(
            reset.effective_download_directory,
            reset.default_download_directory
        );
    }
    #[test]
    fn detail_link_does_not_hide_a_pdf_without_content_id() {
        let text =
            "https://basic.smartedu.cn/detail?contentId=book-id https://cdn.example/book.pdf";
        assert_eq!(
            find_pdf_url(text, "book-id").as_deref(),
            Some("https://cdn.example/book.pdf")
        );
    }

    #[test]
    fn viewer_resolves_relative_pdf_and_rejects_unsafe_scheme() {
        assert_eq!(
            find_pdf_url(
                "https://cdn.example/viewer.html?file=%2Fbooks%2Fbook.pdf",
                "id"
            )
            .as_deref(),
            Some("https://cdn.example/books/book.pdf")
        );
        assert!(find_pdf_url(
            "https://cdn.example/viewer.html?file=javascript%3Aalert(1)",
            "id"
        )
        .is_none());
    }
}
