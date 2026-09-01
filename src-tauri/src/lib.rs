use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashMap, fs, path::PathBuf, sync::Mutex, time::Duration};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

const VERSION_URL: &str =
    "https://s-file-2.ykt.cbern.com.cn/zxx/ndrs/resources/tch_material/version/data_version.json";

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

#[derive(Serialize, Deserialize)]
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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct QueueState {
    batch_id: Option<String>,
    status: String,
    tasks: Vec<Value>,
    history: Vec<Value>,
}

struct AppState {
    settings: Mutex<AppSettings>,
    settings_path: PathBuf,
    catalog_cache_path: PathBuf,
}

fn now_string() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
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
    let mut resources = Vec::new();
    for url in string_at(&version, &["urls"])
        .split(',')
        .map(str::trim)
        .filter(|url| !url.is_empty())
    {
        let part: Value = client
            .get(url)
            .send()
            .await
            .map_err(|error| error.to_string())?
            .error_for_status()
            .map_err(|error| error.to_string())?
            .json()
            .await
            .map_err(|error| error.to_string())?;
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
        tasks: vec![],
        history: vec![],
    }
}

#[tauri::command]
async fn load_catalog(state: tauri::State<'_, AppState>) -> Result<CatalogResponse, String> {
    match fetch_catalog().await {
        Ok(resources) => {
            let response = CatalogResponse {
                resources,
                source: "official".into(),
                cached_at: now_string(),
                warning: None,
            };
            if let Some(parent) = state.catalog_cache_path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            if let Ok(json) = serde_json::to_string(&response) {
                let _ = fs::write(&state.catalog_cache_path, json);
            }
            Ok(response)
        }
        Err(error) => {
            let cached =
                fs::read_to_string(&state.catalog_cache_path).map_err(|_| error.clone())?;
            let mut response: CatalogResponse =
                serde_json::from_str(&cached).map_err(|_| error.clone())?;
            response.source = "cache".into();
            response.warning = Some(error);
            Ok(response)
        }
    }
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
    let mut current = state.settings.lock().map_err(|error| error.to_string())?;
    if let Some(value) = settings.filename_template {
        current.filename_template = value;
    }
    if let Some(value) = settings.startup_filter_mode {
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
        current.default_view = value;
    }
    if let Some(value) = settings.download_notifications {
        current.download_notifications = value;
    }
    fs::write(
        &state.settings_path,
        serde_json::to_string_pretty(&*current).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    Ok(current.clone())
}

#[tauri::command]
fn session_status() -> SessionStatus {
    SessionStatus {
        has_saved_session: false,
        auto_closed: false,
    }
}

#[tauri::command]
async fn open_login(app: tauri::AppHandle) -> Result<SessionStatus, String> {
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
        .build()
        .map_err(|error| error.to_string())?;
    }
    while app.get_webview_window("smartedu-login").is_some() {
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    Ok(SessionStatus {
        has_saved_session: false,
        auto_closed: false,
    })
}

#[tauri::command]
fn clear_session() -> SessionStatus {
    session_status()
}
#[tauri::command]
fn download_state() -> QueueState {
    idle_queue()
}
#[tauri::command]
fn start_download(_resources: Vec<TextbookResource>) -> Result<QueueState, String> {
    Err("轻量版原型尚未完成登录 Cookie 接管和带凭据下载".into())
}
#[tauri::command]
fn pause_download() -> QueueState {
    idle_queue()
}
#[tauri::command]
fn resume_download() -> QueueState {
    idle_queue()
}
#[tauri::command]
fn cancel_download() -> QueueState {
    idle_queue()
}
#[tauri::command]
fn retry_task(_task_id: String) -> QueueState {
    idle_queue()
}
#[tauri::command]
fn retry_all_tasks() -> QueueState {
    idle_queue()
}
#[tauri::command]
fn clear_finished_tasks() -> QueueState {
    idle_queue()
}
#[tauri::command]
fn clear_download_history() -> QueueState {
    idle_queue()
}
#[tauri::command]
fn clear_all_task_records() -> QueueState {
    idle_queue()
}
#[tauri::command]
fn list_library() -> Vec<Value> {
    vec![]
}
#[tauri::command]
fn choose_download_directory(state: tauri::State<'_, AppState>) -> Result<AppSettings, String> {
    get_settings(state)
}
#[tauri::command]
fn reset_download_directory(state: tauri::State<'_, AppState>) -> Result<AppSettings, String> {
    get_settings(state)
}
#[tauri::command]
fn open_download_directory() -> Result<String, String> {
    Err("轻量版原型尚未接入系统目录打开能力".into())
}
#[tauri::command]
fn open_library_file(_file_path: String) -> Result<String, String> {
    Err("轻量版原型尚未接入系统文件打开能力".into())
}
#[tauri::command]
fn show_library_in_folder(_file_path: String) -> Result<Value, String> {
    Err("轻量版原型尚未接入文件定位能力".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            let settings = fs::read_to_string(&settings_path)
                .ok()
                .and_then(|json| serde_json::from_str(&json).ok())
                .unwrap_or_else(|| {
                    default_settings(default_download.to_string_lossy().into_owned())
                });
            app.manage(AppState {
                settings: Mutex::new(settings),
                settings_path,
                catalog_cache_path: data_dir.join("catalog-cache.json"),
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
