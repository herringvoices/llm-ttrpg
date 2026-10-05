use futures_util::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs::{File, OpenOptions as StandardOpenOptions},
    io::Read,
    net::TcpListener,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_sql::{Migration, MigrationKind};
use tokio::{
    fs::{self, OpenOptions},
    io::AsyncWriteExt,
    sync::Mutex as AsyncMutex,
    time::sleep,
};

const DATABASE_URL: &str = "sqlite:llm-ttrpg.db";
const MODEL_NAME: &str = "Qwen3-8B-Q4_K_M.gguf";
const MODEL_ID: &str = "llm-ttrpg-qwen3-8b";
const MODEL_SIZE: u64 = 5_027_783_488;
const MODEL_SHA256: &str = "d98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785";
const MODEL_URL: &str = "https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/6a569868d07d3bd59e8b97fb001bf8c0b254bb20/Qwen3-8B-Q4_K_M.gguf?download=true";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalModelProgress {
    phase: String,
    message: String,
    downloaded_bytes: u64,
    total_bytes: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalModelConnection {
    endpoint: String,
    api_key: String,
    model: String,
}

struct LocalModelProcess {
    child: Child,
    connection: LocalModelConnection,
}

#[derive(Default)]
struct LocalModelState {
    setup: AsyncMutex<()>,
    process: Mutex<Option<LocalModelProcess>>,
}

fn emit_progress(
    app: &AppHandle,
    phase: &str,
    message: &str,
    downloaded_bytes: u64,
) -> Result<(), String> {
    app.emit(
        "local-model-progress",
        LocalModelProgress {
            phase: phase.to_owned(),
            message: message.to_owned(),
            downloaded_bytes,
            total_bytes: MODEL_SIZE,
        },
    )
    .map_err(|error| format!("Unable to report local model setup progress: {error}"))
}

fn model_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let directory = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Unable to locate the application data directory: {error}"))?
        .join("models");
    Ok((
        directory.join(MODEL_NAME),
        directory.join(format!("{MODEL_NAME}.part")),
        directory.join(format!("{MODEL_NAME}.sha256")),
    ))
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|error| {
        format!("Unable to open the downloaded model for verification: {error}")
    })?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| format!("Unable to verify the downloaded model: {error}"))?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

async fn verified_model(app: &AppHandle) -> Result<PathBuf, String> {
    let (model_path, partial_path, verification_path) = model_paths(app)?;
    let model_directory = model_path
        .parent()
        .ok_or_else(|| "The local model path has no parent directory".to_owned())?;
    fs::create_dir_all(model_directory)
        .await
        .map_err(|error| format!("Unable to create the local model directory: {error}"))?;

    let model_length = fs::metadata(&model_path)
        .await
        .ok()
        .map(|metadata| metadata.len());
    let recorded_hash = fs::read_to_string(&verification_path)
        .await
        .ok()
        .map(|value| value.trim().to_owned());
    if model_length == Some(MODEL_SIZE) && recorded_hash.as_deref() == Some(MODEL_SHA256) {
        emit_progress(
            app,
            "ready",
            "The included local model is installed.",
            MODEL_SIZE,
        )?;
        return Ok(model_path);
    }

    if model_length == Some(MODEL_SIZE) {
        emit_progress(
            app,
            "verifying",
            "Verifying the installed local model...",
            MODEL_SIZE,
        )?;
        let path = model_path.clone();
        let hash = tauri::async_runtime::spawn_blocking(move || sha256_file(&path))
            .await
            .map_err(|error| format!("The model verification task failed: {error}"))??;
        if hash == MODEL_SHA256 {
            fs::write(&verification_path, MODEL_SHA256)
                .await
                .map_err(|error| format!("Unable to record model verification: {error}"))?;
            return Ok(model_path);
        }
        fs::remove_file(&model_path)
            .await
            .map_err(|error| format!("Unable to replace an invalid local model: {error}"))?;
    }

    let mut existing = fs::metadata(&partial_path)
        .await
        .ok()
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    if existing == MODEL_SIZE {
        emit_progress(
            app,
            "verifying",
            "Verifying the completed local model download...",
            MODEL_SIZE,
        )?;
        let path = partial_path.clone();
        let hash = tauri::async_runtime::spawn_blocking(move || sha256_file(&path))
            .await
            .map_err(|error| format!("The model verification task failed: {error}"))??;
        if hash == MODEL_SHA256 {
            if fs::metadata(&model_path).await.is_ok() {
                fs::remove_file(&model_path)
                    .await
                    .map_err(|error| format!("Unable to replace the old local model: {error}"))?;
            }
            fs::rename(&partial_path, &model_path)
                .await
                .map_err(|error| format!("Unable to install the verified local model: {error}"))?;
            fs::write(&verification_path, MODEL_SHA256)
                .await
                .map_err(|error| format!("Unable to record model verification: {error}"))?;
            return Ok(model_path);
        }
        fs::remove_file(&partial_path)
            .await
            .map_err(|error| format!("Unable to reset an invalid model download: {error}"))?;
        existing = 0;
    }
    if existing > MODEL_SIZE {
        fs::remove_file(&partial_path).await.map_err(|error| {
            format!("Unable to reset an invalid partial model download: {error}")
        })?;
        existing = 0;
    }

    emit_progress(
        app,
        "downloading",
        "Installing the included Qwen3 8B local model (about 5 GB)...",
        existing,
    )?;

    let client = reqwest::Client::builder()
        .user_agent("llm-ttrpg/0.1.5")
        .build()
        .map_err(|error| format!("Unable to initialize the model downloader: {error}"))?;
    let mut request = client.get(MODEL_URL);
    if existing > 0 {
        request = request.header(reqwest::header::RANGE, format!("bytes={existing}-"));
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("Unable to download the local model: {error}"))?;
    let append = existing > 0 && response.status() == reqwest::StatusCode::PARTIAL_CONTENT;
    if !response.status().is_success() {
        return Err(format!(
            "Model download failed with HTTP status {}",
            response.status()
        ));
    }
    if !append {
        existing = 0;
    }

    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .append(append)
        .truncate(!append)
        .open(&partial_path)
        .await
        .map_err(|error| format!("Unable to open the local model download: {error}"))?;
    let mut downloaded = existing;
    let mut last_reported = downloaded;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk =
            chunk.map_err(|error| format!("The local model download was interrupted: {error}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|error| format!("Unable to save the local model: {error}"))?;
        downloaded += chunk.len() as u64;
        if downloaded.saturating_sub(last_reported) >= 16 * 1024 * 1024 || downloaded == MODEL_SIZE
        {
            emit_progress(
                app,
                "downloading",
                "Installing the included Qwen3 8B local model (about 5 GB)...",
                downloaded.min(MODEL_SIZE),
            )?;
            last_reported = downloaded;
        }
    }
    file.flush()
        .await
        .map_err(|error| format!("Unable to finish saving the local model: {error}"))?;
    drop(file);

    if downloaded != MODEL_SIZE {
        return Err(format!("The local model download is incomplete: expected {MODEL_SIZE} bytes, received {downloaded}"));
    }
    emit_progress(
        app,
        "verifying",
        "Verifying the downloaded local model...",
        MODEL_SIZE,
    )?;
    let path = partial_path.clone();
    let hash = tauri::async_runtime::spawn_blocking(move || sha256_file(&path))
        .await
        .map_err(|error| format!("The model verification task failed: {error}"))??;
    if hash != MODEL_SHA256 {
        fs::remove_file(&partial_path).await.ok();
        return Err(format!(
            "The downloaded model failed verification. Expected {MODEL_SHA256}, got {hash}."
        ));
    }

    if fs::metadata(&model_path).await.is_ok() {
        fs::remove_file(&model_path)
            .await
            .map_err(|error| format!("Unable to replace the old local model: {error}"))?;
    }
    fs::rename(&partial_path, &model_path)
        .await
        .map_err(|error| format!("Unable to install the verified local model: {error}"))?;
    fs::write(&verification_path, MODEL_SHA256)
        .await
        .map_err(|error| format!("Unable to record model verification: {error}"))?;
    Ok(model_path)
}

fn runtime_directory(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .resource_dir()
        .map_err(|error| format!("Unable to locate bundled application resources: {error}"))?
        .join("resources")
        .join("llama"))
}

fn available_port() -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| format!("Unable to reserve a local model port: {error}"))?;
    listener
        .local_addr()
        .map(|address| address.port())
        .map_err(|error| format!("Unable to determine the local model port: {error}"))
}

fn stop_model(state: &LocalModelState) {
    if let Ok(mut process) = state.process.lock() {
        if let Some(mut running) = process.take() {
            let _ = running.child.kill();
            let _ = running.child.wait();
        }
    }
}

async fn start_model(
    app: &AppHandle,
    state: &LocalModelState,
    model_path: &Path,
) -> Result<LocalModelConnection, String> {
    {
        let mut process = state
            .process
            .lock()
            .map_err(|_| "The local model process lock is unavailable".to_owned())?;
        if let Some(running) = process.as_mut() {
            if running
                .child
                .try_wait()
                .map_err(|error| format!("Unable to inspect the local model process: {error}"))?
                .is_none()
            {
                return Ok(running.connection.clone());
            }
        }
        *process = None;
    }

    emit_progress(
        app,
        "starting",
        "Loading the local model into memory...",
        MODEL_SIZE,
    )?;
    let runtime_directory = runtime_directory(app)?;
    let server_path = runtime_directory.join("llama-server.exe");
    if !server_path.is_file() {
        return Err(format!(
            "The bundled llama.cpp runtime is missing at {}. Reinstall the application.",
            server_path.display()
        ));
    }

    let port = available_port()?;
    let endpoint = format!("http://127.0.0.1:{port}");
    let api_key = format!("llm-ttrpg-{}", uuid::Uuid::new_v4());
    let model_directory = model_path
        .parent()
        .ok_or_else(|| "The local model path has no parent directory".to_owned())?;
    let log_path = app
        .path()
        .app_log_dir()
        .map_err(|error| format!("Unable to locate the application log directory: {error}"))?
        .join("llama-server.log");
    if let Some(log_directory) = log_path.parent() {
        std::fs::create_dir_all(log_directory)
            .map_err(|error| format!("Unable to create the application log directory: {error}"))?;
    }
    let log = StandardOpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&log_path)
        .map_err(|error| format!("Unable to create the local model log: {error}"))?;
    let stderr = log
        .try_clone()
        .map_err(|error| format!("Unable to initialize local model logging: {error}"))?;

    let port_argument = port.to_string();
    let mut command = Command::new(&server_path);
    command
        .current_dir(&runtime_directory)
        .env("LLAMA_CACHE", model_directory)
        .arg("--model")
        .arg(model_path)
        .args([
            "--alias",
            MODEL_ID,
            "--host",
            "127.0.0.1",
            "--port",
            &port_argument,
            "--ctx-size",
            "16384",
            "--predict",
            "8192",
            "--parallel",
            "1",
            "--cache-ram",
            "512",
            "--reasoning",
            "off",
            "--no-webui",
            "--api-key",
            &api_key,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(stderr));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let child = command
        .spawn()
        .map_err(|error| format!("Unable to launch the bundled local model runtime: {error}"))?;
    let connection = LocalModelConnection {
        endpoint: endpoint.clone(),
        api_key: api_key.clone(),
        model: MODEL_ID.to_owned(),
    };
    state
        .process
        .lock()
        .map_err(|_| "The local model process lock is unavailable".to_owned())?
        .replace(LocalModelProcess {
            child,
            connection: connection.clone(),
        });

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|error| format!("Unable to initialize the local model health check: {error}"))?;
    for _ in 0..300 {
        let exited = {
            let mut process = state
                .process
                .lock()
                .map_err(|_| "The local model process lock is unavailable".to_owned())?;
            match process.as_mut() {
                Some(running) => running.child.try_wait().map_err(|error| {
                    format!("Unable to inspect the local model process: {error}")
                })?,
                None => return Err("The local model process stopped unexpectedly".to_owned()),
            }
        };
        if let Some(status) = exited {
            if let Ok(mut process) = state.process.lock() {
                process.take();
            }
            return Err(format!(
                "The local model runtime exited with {status}. See {} for details.",
                log_path.display()
            ));
        }
        if let Ok(response) = client
            .get(format!("{endpoint}/health"))
            .bearer_auth(&api_key)
            .send()
            .await
        {
            if response.status().is_success() {
                emit_progress(app, "ready", "The local model is ready.", MODEL_SIZE)?;
                return Ok(connection);
            }
        }
        sleep(Duration::from_secs(1)).await;
    }
    stop_model(state);
    Err(format!(
        "The local model did not become ready within five minutes. See {} for details.",
        log_path.display()
    ))
}

#[tauri::command]
async fn ensure_local_model(
    app: AppHandle,
    state: State<'_, LocalModelState>,
) -> Result<LocalModelConnection, String> {
    let _setup = state.setup.lock().await;
    let model_path = verified_model(&app).await?;
    start_model(&app, &state, &model_path).await
}

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "persistence_foundation",
            sql: include_str!("../migrations/0001_persistence_foundation.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "fictional_time_event_history",
            sql: include_str!("../migrations/0002_fictional_time_event_history.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "action_pressure",
            sql: include_str!("../migrations/0003_action_pressure.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "resolution_randomness",
            sql: include_str!("../migrations/0004_resolution_randomness.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "player_action_runs",
            sql: include_str!("../migrations/0005_player_action_runs.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "social_realization_generation",
            sql: include_str!("../migrations/0006_social_realization_generation.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "campaign_planning",
            sql: include_str!("../migrations/0007_campaign_planning.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "playable_loop",
            sql: include_str!("../migrations/0008_playable_loop.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let application = tauri::Builder::default()
        .manage(LocalModelState::default())
        .invoke_handler(tauri::generate_handler![ensure_local_model])
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DATABASE_URL, migrations())
                .build(),
        )
        .build(tauri::generate_context!())
        .expect("error while building desktop application");

    application.run(|app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            stop_model(&app.state::<LocalModelState>());
        }
    });
}
