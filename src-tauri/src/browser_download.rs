use super::*;

pub(super) async fn start_browser_download(
    window: &WebviewWindow,
    pdf_url: &str,
    auth: &str,
    referer: &str,
    target: PathBuf,
    finished_sender: BrowserDownloadSender,
    response_started: Arc<AtomicBool>,
    response_observation: Arc<Mutex<String>>,
) -> Result<(), String> {
    use std::io::Write;
    use webview2_com::{
        take_pwstr,
        Microsoft::Web::WebView2::Win32::{
            ICoreWebView2Environment9, ICoreWebView2_10, ICoreWebView2_2,
        },
        WebResourceResponseReceivedEventHandler, WebResourceResponseViewGetContentCompletedHandler,
    };
    use windows::Win32::System::Com::ISequentialStream;
    use windows_core::{Interface, HSTRING, PWSTR};

    let (sender, receiver) = tokio::sync::oneshot::channel();
    let sender = Mutex::new(Some(sender));
    let pdf_url = pdf_url.to_string();
    let auth = auth.to_string();
    let referer = referer.to_string();
    window
        .with_webview(move |platform| {
            let result = (|| unsafe {
                let environment: ICoreWebView2Environment9 = platform
                    .environment()
                    .cast()
                    .map_err(|error| error.to_string())?;
                let webview: ICoreWebView2_10 = platform
                    .controller()
                    .CoreWebView2()
                    .map_err(|error| error.to_string())?
                    .cast()
                    .map_err(|error| error.to_string())?;
                let response_webview: ICoreWebView2_2 =
                    webview.cast().map_err(|error| error.to_string())?;
                let route = Mutex::new(response_route::ResponseRoute::new(&pdf_url)?);
                let mut response_token = 0_i64;
                response_webview
                    .add_WebResourceResponseReceived(
                        &WebResourceResponseReceivedEventHandler::create(Box::new(
                            move |_sender, args| {
                                if !download_receiver_active(&finished_sender) {
                                    return Ok(());
                                }
                                let Some(args) = args else {
                                    return Ok(());
                                };
                                let request = args.Request()?;
                                let mut raw_uri = PWSTR::null();
                                request.Uri(&mut raw_uri)?;
                                let uri = take_pwstr(raw_uri);
                                if !route.lock().map(|route| route.matches(&uri)).unwrap_or(false) {
                                    return Ok(());
                                }
                                let response = args.Response()?;
                                let mut status = 0;
                                response.StatusCode(&mut status)?;
                                let headers = response.Headers()?;
                                let mut raw_content_type = PWSTR::null();
                                let content_type = if headers
                                    .GetHeader(
                                        &HSTRING::from("Content-Type"),
                                        &mut raw_content_type,
                                    )
                                    .is_ok()
                                {
                                    take_pwstr(raw_content_type)
                                } else {
                                    String::new()
                                };
                                let host = response_route::diagnostic_host(&uri);
                                if let Ok(mut observation) = response_observation.lock() {
                                    *observation = format!(
                                        "站点: {host}；HTTP {status}；Content-Type: {}",
                                        if content_type.is_empty() {
                                            "未提供"
                                        } else {
                                            &content_type
                                        }
                                    );
                                }
                                if (300..400).contains(&status) {
                                    let mut location = PWSTR::null();
                                    let redirect = headers.GetHeader(&HSTRING::from("Location"), &mut location)
                                        .map_err(|error| error.to_string())
                                        .and_then(|_| {
                                            route.lock().map_err(|error| error.to_string())?
                                                .redirect(&take_pwstr(location))
                                        });
                                    if let Err(error) = redirect {
                                        if let Ok(mut sender) = finished_sender.lock() {
                                            if let Some(sender) = sender.take() {
                                                let _ = sender.send(BrowserDownloadFinished {
                                                    path: None, success: false, error: Some(error),
                                                });
                                            }
                                        }
                                    }
                                    return Ok(());
                                }
                                if !(200..300).contains(&status) {
                                    if let Ok(mut sender) = finished_sender.lock() {
                                        if let Some(sender) = sender.take() {
                                            let _ = sender.send(BrowserDownloadFinished {
                                                path: None,
                                                success: false,
                                                error: Some(match status {
                                                    401 => "平台登录已失效或授权信息无效（HTTP 401），请重新登录后重试".into(),
                                                    403 => "平台拒绝访问该教材（HTTP 403），请确认账号权限后重试".into(),
                                                    _ => format!("WebView2 请求 PDF 失败：HTTP {status}"),
                                                }),
                                            });
                                        }
                                    }
                                    return Ok(());
                                }
                                let normalized_type = content_type.to_ascii_lowercase();
                                if normalized_type.contains("text/html")
                                    || normalized_type.contains("application/json")
                                    || normalized_type.contains("text/json")
                                {
                                    if let Ok(mut sender) = finished_sender.lock() {
                                        if let Some(sender) = sender.take() {
                                            let _ = sender.send(BrowserDownloadFinished {
                                                path: None, success: false,
                                                error: Some(format!("目标响应不是 PDF：HTTP {status}；Content-Type: {content_type}")),
                                            });
                                        }
                                    }
                                    return Ok(());
                                }
                                if response_started
                                    .compare_exchange(
                                        false,
                                        true,
                                        Ordering::Relaxed,
                                        Ordering::Relaxed,
                                    )
                                    .is_err()
                                {
                                    return Ok(());
                                }
                                let content_sender = finished_sender.clone();
                                let content_target = target.clone();
                                let content_started = response_started.clone();
                                let content_observation = response_observation.clone();
                                let content_host = host.clone();
                                let response_type = content_type.clone();
                                let read_start = response.GetContent(
                                    &WebResourceResponseViewGetContentCompletedHandler::create(
                                        Box::new(move |result, stream| {
                                            let save_result = (|| -> Result<(), String> {
                                                if !download_receiver_active(&content_sender) {
                                                    return Err("下载任务已结束".into());
                                                }
                                                result.map_err(|error| error.to_string())?;
                                                let stream = stream.ok_or_else(|| {
                                                    "WebView2 未返回 PDF 响应流".to_string()
                                                })?;
                                                let stream: ISequentialStream = stream
                                                    .cast()
                                                    .map_err(|error| error.to_string())?;
                                                let mut file =
                                                    std::fs::File::create(&content_target)
                                                        .map_err(|error| error.to_string())?;
                                                let mut buffer = vec![0_u8; 64 * 1024];
                                                let mut prefix = Vec::with_capacity(1024);
                                                loop {
                                                    if !download_receiver_active(&content_sender) {
                                                        return Err("下载任务已结束".into());
                                                    }
                                                    let mut read = 0_u32;
                                                    stream
                                                        .Read(
                                                            buffer.as_mut_ptr().cast(),
                                                            buffer.len() as u32,
                                                            Some(&mut read),
                                                        )
                                                        .ok()
                                                        .map_err(|error| error.to_string())?;
                                                    if read == 0 {
                                                        break;
                                                    }
                                                    if prefix.len() < 1024 {
                                                        let remaining = 1024 - prefix.len();
                                                        prefix.extend_from_slice(
                                                            &buffer[..(read as usize).min(remaining)],
                                                        );
                                                    }
                                                    file.write_all(&buffer[..read as usize])
                                                        .map_err(|error| error.to_string())?;
                                                }
                                                file.flush().map_err(|error| error.to_string())?;
                                                if !contains_pdf_header(&prefix) {
                                                    return Err(format!(
                                                        "响应不是 PDF；站点: {content_host}；Content-Type: {}；文件头: {}",
                                                        if response_type.is_empty() {
                                                            "未提供"
                                                        } else {
                                                            &response_type
                                                        },
                                                        byte_preview(&prefix)
                                                    ));
                                                }
                                                Ok(())
                                            })(
                                            );
                                            if let Err(error) = &save_result {
                                                let _ = std::fs::remove_file(&content_target);
                                                if let Ok(mut observation) =
                                                    content_observation.lock()
                                                {
                                                    *observation = error.clone();
                                                }
                                                content_started.store(false, Ordering::Relaxed);
                                            }
                                            if let Ok(mut sender) = content_sender.lock() {
                                                if let Some(sender) = sender.take() {
                                                    let _ = sender.send(BrowserDownloadFinished {
                                                        path: save_result
                                                            .as_ref()
                                                            .ok()
                                                            .map(|_| content_target.clone()),
                                                        success: save_result.is_ok(),
                                                        error: save_result.err(),
                                                    });
                                                }
                                            }
                                            Ok(())
                                        }),
                                    ),
                                );
                                if let Err(error) = read_start {
                                    response_started.store(false, Ordering::Relaxed);
                                    if let Ok(mut sender) = finished_sender.lock() {
                                        if let Some(sender) = sender.take() {
                                            let _ = sender.send(BrowserDownloadFinished {
                                                path: None,
                                                success: false,
                                                error: Some(format!("读取浏览器响应失败：{error}")),
                                            });
                                        }
                                    }
                                }
                                Ok(())
                            },
                        )),
                        &mut response_token,
                    )
                    .map_err(|error| error.to_string())?;
                let mut headers = format!("Referer: {referer}\r\nAccept: application/pdf,*/*\r\n");
                if !auth.is_empty() {
                    headers.push_str(&format!("X-Nd-Auth: {auth}\r\n"));
                }
                let request = environment
                    .CreateWebResourceRequest(
                        &HSTRING::from(pdf_url),
                        &HSTRING::from("GET"),
                        None,
                        &HSTRING::from(headers),
                    )
                    .map_err(|error| error.to_string())?;
                webview
                    .NavigateWithWebResourceRequest(&request)
                    .map_err(|error| error.to_string())
            })();
            if let Ok(mut sender) = sender.lock() {
                if let Some(sender) = sender.take() {
                    let _ = sender.send(result);
                }
            }
        })
        .map_err(|error| error.to_string())?;
    tokio::time::timeout(Duration::from_secs(5), receiver)
        .await
        .map_err(|_| "启动 WebView2 下载请求超时".to_string())?
        .map_err(|_| "教材详情窗口提前关闭".to_string())?
}
