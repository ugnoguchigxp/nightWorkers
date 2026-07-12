#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::{
    env,
    fs::OpenOptions,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};
use tauri::{Manager, State};

struct SidecarState {
    child: Mutex<Option<Child>>,
    config: Mutex<Option<DesktopConfig>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopConfig {
    api_origin: String,
    runtime_dir: String,
    logs_dir: String,
}

#[tauri::command]
fn get_desktop_config(
    app: tauri::AppHandle,
    state: State<'_, SidecarState>,
) -> Result<DesktopConfig, String> {
    let config = state
        .config
        .lock()
        .map_err(|_| "desktop config lock poisoned".to_string())?
        .clone()
        .ok_or_else(|| "desktop backend is not ready".to_string())?;
    desktop_log(
        &app,
        &format!("desktop config requested: {}", config.api_origin),
    );
    Ok(config)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(SidecarState {
            child: Mutex::new(None),
            config: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![get_desktop_config])
        .setup(|app| {
            let app_handle = app.handle().clone();
            desktop_log(&app_handle, "setup started");
            if let Err(error) = start_backend_sidecar(app_handle.clone()) {
                desktop_log(
                    &app_handle,
                    &format!("backend sidecar startup failed: {error}"),
                );
                return Err(error);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                let state = window.state::<SidecarState>();
                let app_handle = window.app_handle().clone();
                desktop_log(&app_handle, "close requested");
                stop_backend_sidecar(state.inner());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running NightWorkers desktop shell");
}

fn start_backend_sidecar(app: tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let state = app.state::<SidecarState>();
    let port = pick_free_port()?;
    let api_origin = format!("http://127.0.0.1:{port}");
    let resource_root = resolve_resource_root(&app)?;
    let runtime_dir = resolve_runtime_dir(&app)?;
    let logs_dir = runtime_dir.join("logs");
    std::fs::create_dir_all(&logs_dir)?;
    desktop_log(
        &app,
        &format!("runtime dir resolved: {}", runtime_dir.display()),
    );

    let backend_entry = resolve_backend_entry(&resource_root)?;
    let node_binary = resolve_node_binary(&resource_root);
    let frontend_dist = resolve_frontend_dist(&resource_root);
    let staged_node_modules = resource_root.join("scripts/desktop/staged/node_modules");
    desktop_log(
        &app,
        &format!(
            "starting sidecar: node={} entry={} resources={} frontend={} port={}",
            node_binary.display(),
            backend_entry.display(),
            resource_root.display(),
            frontend_dist.display(),
            port
        ),
    );

    let sidecar_log_path = logs_dir.join("sidecar.log");
    let sidecar_stdout = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&sidecar_log_path)?;
    let sidecar_stderr = sidecar_stdout.try_clone()?;
    append_file_line(&sidecar_log_path, "sidecar process starting");

    let cors_origins = desktop_cors_origins(&api_origin, cfg!(debug_assertions));

    let mut command = Command::new(&node_binary);
    command
        .arg(&backend_entry)
        .env("DOTENV_CONFIG_QUIET", "true")
        .env("NIGHTWORKERS_DESKTOP", "1")
        .env("NIGHTWORKERS_RUNTIME_DIR", &runtime_dir)
        .env("NIGHTWORKERS_RESOURCE_DIR", &resource_root)
        .env("NIGHTWORKERS_FRONTEND_DIST", &frontend_dist)
        .env("NODE_PATH", &staged_node_modules)
        .env("NIGHTWORKERS_API_ORIGIN", &api_origin)
        .env("PORT", port.to_string())
        .env("APP_URL", &api_origin)
        .env("CORS_ORIGIN", cors_origins.join(","))
        .env("API_AUTH_REQUIRED", "false")
        .env("AUTH_MODE", "local")
        .env(
            "NODE_ENV",
            if cfg!(debug_assertions) {
                "development"
            } else {
                "production"
            },
        )
        .current_dir(&resource_root)
        .stdin(Stdio::null())
        .stdout(Stdio::from(sidecar_stdout))
        .stderr(Stdio::from(sidecar_stderr));

    let child = command.spawn().map_err(|error| {
        format!(
            "failed to start Node sidecar: binary={} entry={} error={error}",
            node_binary.display(),
            backend_entry.display()
        )
    })?;
    desktop_log(&app, &format!("sidecar spawned pid={}", child.id()));

    {
        let mut child_slot = state.child.lock().map_err(|_| "sidecar lock poisoned")?;
        *child_slot = Some(child);
    }

    wait_for_ready(
        state.inner(),
        &api_origin,
        Duration::from_secs(30),
        &sidecar_log_path,
    )
    .map_err(|error| {
        desktop_log(&app, &format!("sidecar readiness failed: {error}"));
        stop_backend_sidecar(state.inner());
        error
    })?;
    desktop_log(&app, &format!("sidecar ready: {api_origin}"));

    let config = DesktopConfig {
        api_origin,
        runtime_dir: runtime_dir.to_string_lossy().into_owned(),
        logs_dir: logs_dir.to_string_lossy().into_owned(),
    };
    let mut config_slot = state
        .config
        .lock()
        .map_err(|_| "desktop config lock poisoned")?;
    *config_slot = Some(config);

    Ok(())
}

fn desktop_cors_origins(api_origin: &str, debug: bool) -> Vec<String> {
    let mut origins = vec![
        api_origin.to_string(),
        "http://tauri.localhost".to_string(),
        "tauri://localhost".to_string(),
    ];
    if debug {
        origins.push("http://127.0.0.1:39174".to_string());
        origins.push("http://localhost:39174".to_string());
    }
    origins
}

fn stop_backend_sidecar(state: &SidecarState) {
    let Ok(mut child_slot) = state.child.lock() else {
        return;
    };
    let Some(mut child) = child_slot.take() else {
        return;
    };

    #[cfg(unix)]
    {
        let _ = Command::new("kill")
            .arg("-TERM")
            .arg(child.id().to_string())
            .status();
    }

    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) if started.elapsed() < Duration::from_secs(10) => {
                thread::sleep(Duration::from_millis(100));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return;
            }
        }
    }
}

fn desktop_log(app: &tauri::AppHandle, message: &str) {
    if let Ok(log_path) = desktop_log_path(app) {
        append_file_line(&log_path, message);
    }
}

fn desktop_log_path(app: &tauri::AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let logs_dir = resolve_runtime_dir(app)?.join("logs");
    std::fs::create_dir_all(&logs_dir)?;
    Ok(logs_dir.join("desktop.log"))
}

fn append_file_line(path: &Path, message: &str) {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string());
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "[{timestamp}] {message}");
    }
}

fn pick_free_port() -> std::io::Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    Ok(listener.local_addr()?.port())
}

fn wait_for_ready(
    state: &SidecarState,
    api_origin: &str,
    timeout: Duration,
    sidecar_log_path: &Path,
) -> Result<(), String> {
    let started = Instant::now();
    while started.elapsed() < timeout {
        if health_ready(api_origin).unwrap_or(false) {
            return Ok(());
        }
        if let Some(status) = sidecar_exit_status(state)? {
            return Err(format!(
                "backend sidecar exited before readiness: status={status}; log_tail={}",
                read_log_tail(sidecar_log_path, 40)
            ));
        }
        thread::sleep(Duration::from_millis(250));
    }
    Err(format!(
        "backend did not become ready within {:?}; log_tail={}",
        timeout,
        read_log_tail(sidecar_log_path, 40)
    ))
}

fn sidecar_exit_status(state: &SidecarState) -> Result<Option<ExitStatus>, String> {
    let mut child_slot = state
        .child
        .lock()
        .map_err(|_| "sidecar lock poisoned".to_string())?;
    let Some(child) = child_slot.as_mut() else {
        return Ok(None);
    };
    child
        .try_wait()
        .map_err(|error| format!("failed to inspect sidecar process: {error}"))
}

fn read_log_tail(path: &Path, max_lines: usize) -> String {
    let Ok(content) = std::fs::read_to_string(path) else {
        return "<unavailable>".to_string();
    };
    let lines = content.lines().collect::<Vec<_>>();
    let start = lines.len().saturating_sub(max_lines);
    lines[start..].join("\\n")
}

fn health_ready(api_origin: &str) -> std::io::Result<bool> {
    let address = api_origin.trim_start_matches("http://");
    let mut stream = TcpStream::connect(address)?;
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    write!(
        stream,
        "GET /api/health/ready HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\n\r\n"
    )?;
    let mut response = String::new();
    stream.read_to_string(&mut response)?;
    Ok(response.starts_with("HTTP/1.1 200") || response.starts_with("HTTP/1.0 200"))
}

fn resolve_resource_root(app: &tauri::AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    if let Ok(value) = env::var("NIGHTWORKERS_RESOURCE_DIR") {
        return Ok(PathBuf::from(value));
    }
    if cfg!(debug_assertions) {
        return Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."));
    }
    let resource_dir = app.path().resource_dir()?;
    let up_dir = resource_dir.join("_up_");
    if up_dir.exists() {
        return Ok(up_dir);
    }
    Ok(resource_dir)
}

fn resolve_runtime_dir(app: &tauri::AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    if let Ok(value) = env::var("NIGHTWORKERS_RUNTIME_DIR") {
        if !value.trim().is_empty() {
            return Ok(PathBuf::from(value));
        }
    }
    if !cfg!(debug_assertions) {
        return Ok(app.path().app_data_dir()?);
    }
    Ok(resolve_resource_root(app)?.join(".nightworkers"))
}

fn resolve_backend_entry(resource_root: &Path) -> Result<PathBuf, String> {
    let candidates = [
        resource_root.join("scripts/desktop/staged/dist-api-desktop/index.js"),
        resource_root.join("scripts/desktop/staged/dist-api-desktop/index.cjs"),
        resource_root.join("dist-api-desktop/index.js"),
        resource_root.join("dist-api-desktop/index.cjs"),
        resource_root.join("dist-api/index.js"),
    ];
    candidates
        .into_iter()
        .find(|path| path.exists())
        .ok_or_else(|| format!("backend entry not found under {}", resource_root.display()))
}

fn resolve_frontend_dist(resource_root: &Path) -> PathBuf {
    let staged = resource_root.join("scripts/desktop/staged/dist");
    if staged.exists() {
        return staged;
    }
    resource_root.join("dist")
}

#[cfg(test)]
mod tests {
    use super::desktop_cors_origins;

    #[test]
    fn packaged_origins_exclude_vite_development_hosts() {
        assert_eq!(
            desktop_cors_origins("http://127.0.0.1:40123", false),
            vec![
                "http://127.0.0.1:40123",
                "http://tauri.localhost",
                "tauri://localhost",
            ]
        );
    }

    #[test]
    fn debug_origins_include_both_vite_loopback_hosts() {
        assert_eq!(
            desktop_cors_origins("http://127.0.0.1:40123", true),
            vec![
                "http://127.0.0.1:40123",
                "http://tauri.localhost",
                "tauri://localhost",
                "http://127.0.0.1:39174",
                "http://localhost:39174",
            ]
        );
    }
}

fn resolve_node_binary(resource_root: &Path) -> PathBuf {
    if let Ok(value) = env::var("NIGHTWORKERS_NODE_BINARY") {
        return PathBuf::from(value);
    }
    let candidates = if cfg!(windows) {
        vec![
            resource_root.join("scripts/desktop/staged/node/bin/node.exe"),
            resource_root.join("scripts/desktop/staged/node/bin/node"),
        ]
    } else {
        vec![
            resource_root.join("scripts/desktop/staged/node/bin/node"),
            resource_root.join("scripts/desktop/staged/node/bin/node.exe"),
        ]
    };
    for candidate in candidates {
        if candidate.exists() {
            return candidate;
        }
    }
    if cfg!(windows) {
        PathBuf::from("node.exe")
    } else {
        PathBuf::from("node")
    }
}
